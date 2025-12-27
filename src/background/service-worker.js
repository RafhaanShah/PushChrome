// Pushover Chrome Extension - Service Worker
// Background script for handling alarms, notifications, and message sync

import { 
  getSession, 
  getSettings, 
  getUnreadCount, 
  appendMessages, 
  purgeDeletedMessages,
  getVisibleMessages,
  getMessages,
  saveMessages,
  getDevices,
  saveDevices,
  getErrorState,
  setErrorState,
  clearErrorState
} from '../lib/storage.js';
import { fetchMessages, deleteMessages, sendMessage, createWebSocketConnection, validateCredentials, ERROR_TYPES } from '../lib/api.js';
import { logger } from '../lib/logger.js';

const ALARM_NAME = 'refreshMessages';
const DEVICE_REFRESH_ALARM_NAME = 'refreshDevices';
const CLEANUP_ALARM_NAME = 'cleanupMessages';
const WEBSOCKET_KEEPALIVE_ALARM = 'websocketKeepalive';
const DEBOUNCE_MS = 60000; // 1 minute
const WEBSOCKET_RECONNECT_DELAY = 30000; // 30 seconds
const ICON_CACHE_NAME = 'pushover-icons';
const ICON_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let lastRefreshTime = 0;
let websocket = null;
let websocketReconnectTimeout = null;

// =============================================================================
// Icon Caching
// =============================================================================

async function getCachedIconUrl(iconName) {
  if (!iconName) return null;
  
  const iconUrl = `https://api.pushover.net/icons/${iconName}.png`;
  
  try {
    const cache = await caches.open(ICON_CACHE_NAME);
    const cached = await cache.match(iconUrl);
    
    if (cached) {
      logger.debug('Icon cache hit:', iconName);
      return iconUrl;
    }
    
    // Fetch and cache the icon
    logger.debug('Icon cache miss, fetching:', iconName);
    const response = await fetch(iconUrl);
    if (response.ok) {
      // Clone response and add timestamp header for cache cleanup
      const headers = new Headers(response.headers);
      headers.set('X-Cached-At', Date.now().toString());
      const cachedResponse = new Response(await response.blob(), { headers });
      await cache.put(iconUrl, cachedResponse);
    }
    return iconUrl;
  } catch (error) {
    logger.warn('Icon cache error:', error);
    return iconUrl; // Return URL anyway, let notification handle failure
  }
}

async function cleanupIconCache() {
  try {
    const cache = await caches.open(ICON_CACHE_NAME);
    const keys = await cache.keys();
    const now = Date.now();
    let cleaned = 0;
    
    for (const request of keys) {
      const response = await cache.match(request);
      const cachedAt = response?.headers.get('X-Cached-At');
      
      if (cachedAt && (now - parseInt(cachedAt, 10)) > ICON_CACHE_MAX_AGE_MS) {
        await cache.delete(request);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} expired icons from cache`);
    }
    return cleaned;
  } catch (error) {
    logger.warn('Icon cache cleanup error:', error);
    return 0;
  }
}

// =============================================================================
// Initialization
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info('Extension installed/updated:', details.reason);
  
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
  await buildContextMenus();
  await connectWebSocket();
});

chrome.runtime.onStartup.addListener(async () => {
  logger.info('Browser started, initializing extension');
  
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();

  await refreshMessages();
  await refreshDevices();

  await connectWebSocket();
});

// =============================================================================
// Alarm Management
// =============================================================================

async function setupAlarms() {
  const settings = await getSettings();
  const session = await getSession();
  
  // Clear existing refresh alarm
  await chrome.alarms.clear(ALARM_NAME);
  
  // Only set up refresh alarm if logged in AND periodic refresh is enabled (interval > 0)
  // WebSocket mode (interval = -1) and manual mode (interval = 0) don't use alarms
  if (session?.secret && session?.deviceId && settings.refreshInterval > 0) {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: settings.refreshInterval
    });
    logger.info(`Refresh alarm set for every ${settings.refreshInterval} minutes`);
  } else if (settings.refreshInterval === -1) {
    logger.info('Using WebSocket for instant refresh');
  } else if (settings.refreshInterval === 0) {
    logger.info('Auto-refresh disabled (manual only)');
  }
  
  // Clear existing device refresh alarm
  await chrome.alarms.clear(DEVICE_REFRESH_ALARM_NAME);
  
  // Set up device refresh alarm if send credentials are configured and interval > 0
  if (settings.apiToken && settings.userKey && settings.deviceRefreshInterval > 0) {
    chrome.alarms.create(DEVICE_REFRESH_ALARM_NAME, {
      periodInMinutes: settings.deviceRefreshInterval
    });
    logger.info(`Device refresh alarm set for every ${settings.deviceRefreshInterval} minutes`);
  } else if (settings.deviceRefreshInterval === 0) {
    logger.info('Device auto-refresh disabled (manual only)');
  }
  
  // Daily cleanup alarm for soft-deleted messages (always enabled)
  chrome.alarms.get(CLEANUP_ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(CLEANUP_ALARM_NAME, {
        periodInMinutes: 60 * 24 // Once per day
      });
    }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    logger.debug('Refresh alarm triggered');
    await refreshMessages();
  } else if (alarm.name === DEVICE_REFRESH_ALARM_NAME) {
    logger.debug('Device refresh alarm triggered');
    await refreshDevices();
  } else if (alarm.name === CLEANUP_ALARM_NAME) {
    logger.debug('Cleanup alarm triggered');
    const purged = await purgeDeletedMessages();
    const iconsCleaned = await cleanupIconCache();
    logger.debug(`Purged ${purged} deleted messages, ${iconsCleaned} expired icons`);
  } else if (alarm.name === WEBSOCKET_KEEPALIVE_ALARM) {
    // Service worker woke up - ensure WebSocket is connected
    await ensureWebSocketConnected();
  }
});

// =============================================================================
// WebSocket Management
// =============================================================================

async function connectWebSocket() {
  const settings = await getSettings();
  
  // Only use WebSocket if instant refresh is enabled
  if (settings.refreshInterval !== -1) {
    logger.debug('WebSocket disabled (not using instant refresh mode)');
    await disconnectWebSocket();
    return;
  }
  
  const session = await getSession();
  
  if (!session?.secret || !session?.deviceId) {
    logger.debug('Not logged in, skipping WebSocket connection');
    return;
  }
  
  await disconnectWebSocket();
  
  logger.info('Connecting to Pushover WebSocket...');
  
  // Enable keepalive alarm to handle service worker restarts
  await setupWebSocketKeepalive(true);
  
  websocket = createWebSocketConnection(session.deviceId, session.secret, {
    onOpen: async () => {
      logger.info('WebSocket connected and logged in');
    },
    
    onMessage: async () => {
      logger.debug('WebSocket: New message notification received');
      await refreshMessages();
    },
    
    onReload: () => {
      logger.info('WebSocket: Reload requested, reconnecting...');
      scheduleWebSocketReconnect();
    },
    
    onError: async (type, message) => {
      logger.error(`WebSocket error (${type}):`, message);
      const existingError = await getErrorState();
      
      if (type === 'permanent') {
        const isNewError = existingError?.type !== 'receive_auth';
        await setErrorState({
          type: 'receive_auth',
          message: 'Permanent error occurred. Please re-login.',
          recoverable: false
        });
        await disconnectWebSocket();
        await updateBadge();
        if (isNewError) {
          showCriticalErrorNotification('websocket', 'Connection error. Please re-login to continue receiving messages.');
        }
      } else if (type === 'session_conflict') {
        const isNewError = existingError?.type !== 'receive_device';
        await setErrorState({
          type: 'receive_device',
          message: 'Device logged in from another session.',
          recoverable: false
        });
        await disconnectWebSocket();
        await updateBadge();
        if (isNewError) {
          showCriticalErrorNotification('session_conflict', 'Your device is now logged in from another session. Only one session per device is allowed.');
        }
      }
    },
    
    onClose: (code, reason) => {
      logger.info(`WebSocket closed: ${code} ${reason}`);
      websocket = null;
      // Auto-reconnect unless it was a clean close
      if (code !== 1000) {
        scheduleWebSocketReconnect();
      }
    }
  });
}

async function disconnectWebSocket() {
  if (websocketReconnectTimeout) {
    clearTimeout(websocketReconnectTimeout);
    websocketReconnectTimeout = null;
  }
  
  // Disable keepalive alarm
  await setupWebSocketKeepalive(false);
  
  if (websocket) {
    websocket.close(1000);
    websocket = null;
  }
}

function scheduleWebSocketReconnect() {
  if (websocketReconnectTimeout) {
    return; // Already scheduled
  }
  
  logger.debug(`Scheduling WebSocket reconnect in ${WEBSOCKET_RECONNECT_DELAY / 1000}s`);
  websocketReconnectTimeout = setTimeout(async () => {
    websocketReconnectTimeout = null;
    await connectWebSocket();
  }, WEBSOCKET_RECONNECT_DELAY);
}

async function ensureWebSocketConnected() {
  const settings = await getSettings();
  
  if (settings.refreshInterval !== -1) {
    return; // WebSocket mode not enabled
  }

  logger.debug('Checking WebSocket status:', websocket ? websocket.readyState : 'not connected');
  
  // If WebSocket is not connected, reconnect
  if (!websocket || (websocket.readyState !== WebSocket.OPEN && websocket.readyState !== WebSocket.CONNECTING)) {
    logger.debug('WebSocket not connected, reconnecting...');
    await connectWebSocket();
  }
}

async function setupWebSocketKeepalive(enabled) {
  await chrome.alarms.clear(WEBSOCKET_KEEPALIVE_ALARM);
  
  if (enabled) {
    // Check every 1 minute to ensure WebSocket stays connected
    // This handles service worker restarts after sleep/idle
    chrome.alarms.create(WEBSOCKET_KEEPALIVE_ALARM, {
      periodInMinutes: 1
    });
    logger.debug('WebSocket keepalive alarm enabled');
  }
}

// =============================================================================
// Context Menu
// =============================================================================

async function buildContextMenus() {
  await chrome.contextMenus.removeAll();
  
  const settings = await getSettings();
  const devices = await getDevices();
  
  // Only show menus if send credentials are configured
  if (!settings.apiToken || !settings.userKey) {
    logger.debug('Context menus not created: missing send credentials');
    return;
  }
  
  // Parent menu for page URL
  chrome.contextMenus.create({
    id: 'send-page',
    title: 'Pushover',
    contexts: ['page']
  });
  
  // Parent menu for selected text
  chrome.contextMenus.create({
    id: 'send-selection',
    title: 'Send "%s" to Pushover',
    contexts: ['selection']
  });
  
  // Add device options under each parent
  for (const parent of ['send-page', 'send-selection']) {
    const contexts = parent === 'send-selection' ? ['selection'] : ['page'];
    
    chrome.contextMenus.create({
      id: `${parent}-all`,
      parentId: parent,
      title: 'All devices',
      contexts
    });
    
    if (devices.length > 0) {
      chrome.contextMenus.create({
        id: `${parent}-separator`,
        parentId: parent,
        type: 'separator',
        contexts
      });
      
      for (const device of devices) {
        chrome.contextMenus.create({
          id: `${parent}-${device}`,
          parentId: parent,
          title: device,
          contexts
        });
      }
    }
  }
  
  logger.debug(`Context menus created with ${devices.length} devices`);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await getSettings();
  const menuId = info.menuItemId;
  
  // Parse menu ID: "send-page-deviceName" or "send-selection-all"
  const isPage = menuId.startsWith('send-page-');
  const isSelection = menuId.startsWith('send-selection-');
  
  if (!isPage && !isSelection) return;
  
  const device = String(menuId).replace(/^send-(page|selection)-/, '');
  
  const params = {
    token: settings.apiToken,
    user: settings.userKey,
    device: device === 'all' ? undefined : device
  };
  
  if (isPage) {
    params.message = tab.title || info.pageUrl;
    params.url = info.pageUrl;
    params.urlTitle = info.pageUrl;
  } else if (isSelection) {
    params.message = info.selectionText;
  }
  
  try {
    await sendMessage(params);
    
    // Clear any previous send errors on success
    await clearErrorState('send');
    
    showToastNotification('Message Sent', `Sent to ${device === 'all' ? 'all devices' : device}`);
  } catch (error) {
    logger.error('Context menu send failed:', error);
    
    // Handle auth/validation errors for send credentials
    // Always show notification for send errors since they result from user action
    if (error.errorType === ERROR_TYPES.VALIDATION || error.errorType === ERROR_TYPES.AUTH) {
      await setErrorState({
        type: 'send_auth',
        message: 'Send credentials invalid. Check your API token and user key in Settings.',
        recoverable: false
      });
      await updateBadge();
      showCriticalErrorNotification('send_auth', 'Unable to send messages. Your API credentials are invalid. Please check Settings.');
    } else if (error.errorType === ERROR_TYPES.RATE_LIMIT) {
      showToastNotification('Rate Limited', 'Message limit reached. Try again later.');
    } else {
      showToastNotification('Send Failed', error.message || 'Failed to send message');
    }
  }
});

// =============================================================================
// Message Refresh
// =============================================================================

async function refreshMessages(options = {}) {
  const { skipNotifications = false, checkDebounce = false } = options;
  
  // Debounce check (only when checkDebounce is true, i.e., popup auto-refresh)
  if (checkDebounce) {
    const now = Date.now();
    if ((now - lastRefreshTime) < DEBOUNCE_MS) {
      logger.debug('Refresh debounced');
      return { debounced: true };
    }
  }
  
  const session = await getSession();
  
  if (!session?.secret || !session?.deviceId) {
    logger.debug('Not logged in, skipping refresh');
    return { error: 'not_logged_in' };
  }
  
  try {
    const messages = await fetchMessages(session.secret, session.deviceId);
    lastRefreshTime = Date.now();
    
    // Clear any previous receive errors on successful fetch
    await clearErrorState('receive');
    
    let newCount = 0;
    if (messages.length > 0) {
      newCount = await appendMessages(messages);
      
      // Delete messages from server after caching locally
      const highestId = Math.max(...messages.map(m => m.id));
      await deleteMessages(session.secret, session.deviceId, highestId);
      
      logger.debug(`Fetched ${messages.length} messages, ${newCount} new`);
      
      // Show notifications for new messages
      if (newCount > 0 && !skipNotifications) {
        await showNotificationsForNewMessages(newCount);
      }
      
      // Notify any open popup to refresh display
      if (newCount > 0) {
        notifyPopupOfNewMessages();
      }
    }
    
    // Update badge
    if (!skipNotifications) {
      await updateBadge();
    }
    
    return { success: true, newCount };
  } catch (error) {
    logger.error('Failed to refresh messages:', error);
    
    // Handle different error types - only show OS notification if this is a new error
    const existingError = await getErrorState();
    
    if (error.errorType === ERROR_TYPES.AUTH) {
      const isNewError = existingError?.type !== 'receive_auth';
      await setErrorState({
        type: 'receive_auth',
        message: 'Session expired or invalid. Please re-login.',
        recoverable: false
      });
      await disconnectWebSocket();
      if (isNewError) {
        showCriticalErrorNotification('receive_auth', 'Unable to receive messages. Your session has expired. Please re-login.');
      }
    } else if (error.errorType === ERROR_TYPES.DEVICE) {
      const isNewError = existingError?.type !== 'receive_device';
      await setErrorState({
        type: 'receive_device',
        message: 'Device not found. It may have been deleted.',
        recoverable: false
      });
      await disconnectWebSocket();
      if (isNewError) {
        showCriticalErrorNotification('receive_device', 'Your device was not found. It may have been deleted from your Pushover account.');
      }
    } else if (error.errorType === ERROR_TYPES.SERVER || error.errorType === ERROR_TYPES.NETWORK) {
      // Transient errors - don't set persistent error state, just log
      logger.warn('Temporary error, will retry on next refresh:', error.message);
    }
    
    // Always update badge to reflect any error state
    await updateBadge();
    
    return { error: error.message, errorType: error.errorType };
  }
}



function notifyPopupOfNewMessages() {
  // Send message to any open messages page to refresh
  chrome.runtime.sendMessage({ action: 'messagesUpdated' }).catch(() => {
    // No listeners, ignore
  });
}

// =============================================================================
// Badge Management
// =============================================================================

async function updateBadge() {
  const settings = await getSettings();
  
  if (!settings.badgeEnabled) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  
  // Check for non-recoverable errors that require user action (auth/device issues)
  // Transient errors (network, server) don't show warning badge - we'll retry automatically
  const errorState = await getErrorState();
  if (errorState?.type && !errorState.recoverable) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF9800' }); // Orange for warning
    return;
  }
  
  const count = await getUnreadCount();
  
  if (count > 0) {
    await chrome.action.setBadgeText({ 
      text: count > 99 ? '99+' : String(count) 
    });
    await chrome.action.setBadgeBackgroundColor({ color: '#E53935' }); // Red for unread
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// =============================================================================
// Notifications
// =============================================================================

async function showNotificationsForNewMessages(newCount) {
  const settings = await getSettings();
  
  if (!settings.notificationsEnabled) {
    return;
  }
  
  // Get the newest unseen messages
  const messages = await getVisibleMessages();
  const unseenMessages = messages.filter(m => !m._seen).slice(0, newCount);
  
  for (const message of unseenMessages) {
    await showNotification(message);
  }
}

async function showNotification(message) {
  const notificationId = `pushover-msg-${message.id}`;
  const fallbackIcon = chrome.runtime.getURL('src/icons/icon-128.png');
  
  // Pre-cache icon for notification (ensures it's available offline too)
  const iconUrl = await getCachedIconUrl(message.icon) || fallbackIcon;
  
  const options = {
    type: 'basic',
    title: message.title || message.app || 'Pushover',
    message: message.message || '',
    iconUrl,
    priority: getPriorityForNotification(message.priority),
    requireInteraction: message.priority >= 2 // Emergency messages stay visible
  };
  
  // Add buttons for emergency messages that need acknowledgment
  if (message.priority === 2 && message.acked === 0 && message.receipt) {
    options.buttons = [
      { title: 'Acknowledge' }
    ];
  }
  
  try {
    await chrome.notifications.create(notificationId, options);
  } catch (error) {
    // Fallback without custom icon if it fails
    options.iconUrl = fallbackIcon;
    await chrome.notifications.create(notificationId, options);
  }
}

function getPriorityForNotification(pushoverPriority) {
  // Chrome notification priority: -2 to 2
  // Pushover priority: -2 to 2
  // Map: -2,-1 → 0 (low), 0 → 1 (default), 1,2 → 2 (high)
  if (pushoverPriority <= -1) return 0;
  if (pushoverPriority === 0) return 1;
  return 2;
}

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('pushover-msg-')) {
    const messageId = parseInt(notificationId.replace('pushover-msg-', ''), 10);
    
    // Find message to check for URL
    const messages = await getMessages();
    const message = messages.find(m => m.id === messageId);
    
    // Open URL if present
    if (message?.url) {
      await chrome.tabs.create({ url: message.url });
    }
    
    // Mark as read and dismiss
    await markMessageAsReadFromNotification(notificationId);
    chrome.notifications.clear(notificationId);
  }
});

// Handle notification dismissal (user closes from OS tray)
chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  if (notificationId.startsWith('pushover-msg-') && byUser) {
    await markMessageAsReadFromNotification(notificationId);
  }
});

async function markMessageAsReadFromNotification(notificationId) {
  const messageId = parseInt(notificationId.replace('pushover-msg-', ''), 10);
  
  // Get messages and mark this specific one as read
  const messages = await getMessages();
  const updated = messages.map(m => 
    m.id === messageId ? { ...m, _seen: true } : m
  );
  
  await saveMessages(updated);
  await updateBadge();
}

// Handle notification button clicks (for emergency acknowledgment)
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId.startsWith('pushover-msg-') && buttonIndex === 0) {
    const messageId = parseInt(notificationId.replace('pushover-msg-', ''), 10);
    
    // Find the message and acknowledge it
    const messages = await getVisibleMessages();
    const message = messages.find(m => m.id === messageId);
    
    if (message?.receipt) {
      const session = await getSession();
      if (session?.secret) {
        try {
          const { acknowledgeEmergency } = await import('../lib/api.js');
          await acknowledgeEmergency(session.secret, message.receipt);
          chrome.notifications.clear(notificationId);
        } catch (error) {
          logger.error('Failed to acknowledge emergency:', error);
        }
      }
    }
  }
});

// =============================================================================
// Storage Change Listener
// =============================================================================

chrome.storage.onChanged.addListener(async (changes, area) => {
  // Update badge when messages change
  if (area === 'local' && changes.messages) {
    await updateBadge();
  }
  
  // Update badge when error state changes
  if (area === 'local' && changes.errorState) {
    await updateBadge();
    // Notify popup/pages of error state change
    chrome.runtime.sendMessage({ action: 'errorStateChanged' }).catch(() => {});
  }
  
  // Reconfigure alarms and WebSocket when settings change
  if (area === 'sync' && changes.settings) {
    await setupAlarms();
    // Connect or disconnect WebSocket based on new refresh interval setting
    await connectWebSocket();
    // Rebuild context menus if credentials changed
    await buildContextMenus();
  }
  
  // Set up alarms and WebSocket when user logs in/out
  if (area === 'local' && changes.session) {
    await setupAlarms();
    if (changes.session.newValue?.deviceId) {
      // User just logged in, clear any previous errors and connect WebSocket
      await clearErrorState();
      await connectWebSocket();
    } else if (!changes.session.newValue) {
      // User logged out, disconnect WebSocket and clear errors
      await disconnectWebSocket();
      await clearErrorState();
    }
    await updateBadge();
  }
  
  // Rebuild context menus when devices change
  if (area === 'local' && changes.devices) {
    await buildContextMenus();
  }
});

// =============================================================================
// Message Listener (for communication with popup/pages)
// =============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refreshMessages') {
    const options = {
      skipNotifications: request.skipNotifications || false,
      checkDebounce: request.checkDebounce || false
    };
    refreshMessages(options).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'updateBadge') {
    updateBadge().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'clearNotifications') {
    clearAllMessageNotifications().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'sendMessage') {
    handleSendMessage(request.params).then((result) => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'rebuildContextMenus') {
    buildContextMenus().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'refreshDevices') {
    refreshDevices().then((result) => {
      sendResponse(result);
    });
    return true;
  }
});

// =============================================================================
// Refresh Devices
// =============================================================================

async function refreshDevices() {
  try {
    const settings = await getSettings();
    
    if (!settings.apiToken || !settings.userKey) {
      return { success: false, error: 'Send credentials not configured' };
    }
    
    const result = await validateCredentials(settings.apiToken, settings.userKey);
    
    if (!result.valid) {
      return { success: false, error: 'Invalid credentials' };
    }
    
    await saveDevices(result.devices);
    return { success: true, devices: result.devices };
  } catch (error) {
    logger.error('Failed to refresh devices:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// Send Message
// =============================================================================

async function handleSendMessage(params) {
  try {
    const result = await sendMessage(params);
    
    // Clear any previous send errors on success
    await clearErrorState('send');
    
    // Check if send page is still open
    const sendPageOpen = await isSendPageOpen();
    
    if (!sendPageOpen) {
      // Show toast notification for success
      showToastNotification('Message Sent', `Sent to ${params.device || 'all devices'}`);
    }
    
    return { success: true, ...result };
  } catch (error) {
    logger.error('Send message failed:', error);
    
    // Handle auth/validation errors for send credentials
    if (error.errorType === ERROR_TYPES.VALIDATION || error.errorType === ERROR_TYPES.AUTH) {
      await setErrorState({
        type: 'send_auth',
        message: 'Send credentials invalid. Check your API token and user key in Settings.',
        recoverable: false
      });
      await updateBadge();
    } else if (error.errorType === ERROR_TYPES.RATE_LIMIT) {
      // Rate limit is temporary - show notification but don't set persistent error
      showToastNotification('Rate Limited', 'Message limit reached. Try again later.');
      return { success: false, error: error.message, errorType: error.errorType };
    }
    
    // Check if send page is still open
    const sendPageOpen = await isSendPageOpen();
    
    if (!sendPageOpen) {
      // Show toast notification for error
      showToastNotification('Send Failed', error.message || 'Failed to send message');
    }
    
    return { success: false, error: error.message, errorType: error.errorType };
  }
}

async function isSendPageOpen() {
  try {
    const views = await chrome.runtime.getContexts({
      contextTypes: ['TAB', 'POPUP']
    });
    return views.some(v => v.documentUrl?.includes('send.html'));
  } catch {
    return false;
  }
}

function showToastNotification(title, message) {
  const notificationId = `pushover-toast-${Date.now()}`;
  
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
    title: title,
    message: message,
    priority: 0
  });
  
  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    chrome.notifications.clear(notificationId);
  }, 5000);
}

function showCriticalErrorNotification(type, message) {
  const notificationId = `pushover-error-${type}`;
  
  // Clear any existing error notification of this type first
  chrome.notifications.clear(notificationId);
  
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
    title: 'Pushover: Action Required',
    message: message,
    priority: 2,
    requireInteraction: true // Stay visible until dismissed
  });
}

// =============================================================================
// Clear Notifications
// =============================================================================

async function clearAllMessageNotifications() {
  const notifications = await chrome.notifications.getAll();
  
  for (const notificationId of Object.keys(notifications)) {
    if (notificationId.startsWith('pushover-msg-')) {
      await chrome.notifications.clear(notificationId);
    }
  }
}

logger.info('Service worker loaded');
