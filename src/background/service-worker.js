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
  clearErrorState,
  markAllRead
} from '../lib/storage.js';
import { acknowledgeEmergency, fetchMessages, deleteMessages, sendMessage, createWebSocketConnection, validateCredentials, ERROR_TYPES } from '../lib/api.js';
import { Page, openPageInWindow, openUrlInTab, createOffscreenDocument, closeOffscreenDocument } from '../lib/navigation.js';

const MESSAGE_REFRESH_ALARM_NAME = 'refreshMessages';
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
      console.debug('Icon cache hit:', iconName);
      return iconUrl;
    }

    // Fetch and cache the icon
    console.debug('Icon cache miss, fetching:', iconName);
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
    console.warn('Icon cache error:', error);
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
      console.info(`Cleaned ${cleaned} expired icons from cache`);
    }
    return cleaned;
  } catch (error) {
    console.warn('Icon cache cleanup error:', error);
    return 0;
  }
}

// =============================================================================
// Initialization
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.info('Extension installed/updated:', details.reason);
  if (details.reason === 'install') {
    openPageInWindow(Page.ROOT);
  }

  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
  await buildContextMenus();
  await connectWebSocket();
});

chrome.runtime.onStartup.addListener(async () => {
  console.info('Browser started, initializing extension');

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
  await chrome.alarms.clear(MESSAGE_REFRESH_ALARM_NAME);

  // Only set up refresh alarm if logged in AND periodic refresh is enabled (interval > 0)
  // WebSocket mode (interval = -1) and manual mode (interval = 0) don't use alarms
  if (session?.secret && session?.deviceId && settings.refreshInterval > 0) {
    chrome.alarms.create(MESSAGE_REFRESH_ALARM_NAME, {
      periodInMinutes: settings.refreshInterval
    });
    console.info(`Refresh alarm set for every ${settings.refreshInterval} minutes`);
  } else if (settings.refreshInterval === -1) {
    console.info('Using WebSocket for instant refresh');
  } else if (settings.refreshInterval === 0) {
    console.info('Auto-refresh disabled (manual only)');
  }

  // Clear existing device refresh alarm
  await chrome.alarms.clear(DEVICE_REFRESH_ALARM_NAME);

  // Set up device refresh alarm if send credentials are configured and interval > 0
  if (settings.apiToken && settings.userKey && settings.deviceRefreshInterval > 0) {
    chrome.alarms.create(DEVICE_REFRESH_ALARM_NAME, {
      periodInMinutes: settings.deviceRefreshInterval
    });
    console.info(`Device refresh alarm set for every ${settings.deviceRefreshInterval} minutes`);
  } else if (settings.deviceRefreshInterval === 0) {
    console.info('Device auto-refresh disabled (manual only)');
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
  if (alarm.name === MESSAGE_REFRESH_ALARM_NAME) {
    console.debug('Refresh alarm triggered');
    await refreshMessages();
  } else if (alarm.name === DEVICE_REFRESH_ALARM_NAME) {
    console.debug('Device refresh alarm triggered');
    await refreshDevices();
  } else if (alarm.name === CLEANUP_ALARM_NAME) {
    console.debug('Cleanup alarm triggered');
    const purged = await purgeDeletedMessages();
    const iconsCleaned = await cleanupIconCache();
    console.debug(`Purged ${purged} deleted messages, ${iconsCleaned} expired icons`);
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
    console.debug('WebSocket disabled (not using instant refresh mode)');
    await disconnectWebSocket();
    return;
  }

  const session = await getSession();

  if (!session?.secret || !session?.deviceId) {
    console.debug('Not logged in, skipping WebSocket connection');
    return;
  }

  await disconnectWebSocket();

  console.info('Connecting to Pushover WebSocket...');

  // Enable keepalive alarm to handle service worker restarts
  await setupWebSocketKeepalive(true);

  websocket = createWebSocketConnection(session.deviceId, session.secret, {
    onOpen: async () => {
      console.info('WebSocket connected and logged in');
    },

    onMessage: async () => {
      console.debug('WebSocket: New message notification received');
      await refreshMessages();
    },

    onReload: () => {
      console.info('WebSocket: Reload requested, reconnecting...');
      scheduleWebSocketReconnect();
    },

    onError: async (type, message) => {
      console.error(`WebSocket error (${type}):`, message);
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
      console.info(`WebSocket closed: ${code} ${reason}`);
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

  console.debug(`Scheduling WebSocket reconnect in ${WEBSOCKET_RECONNECT_DELAY / 1000}s`);
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

  console.debug('Checking WebSocket status:', websocket ? websocket.readyState : 'not connected');

  // If WebSocket is not connected, reconnect
  if (!websocket || (websocket.readyState !== WebSocket.OPEN && websocket.readyState !== WebSocket.CONNECTING)) {
    console.debug('WebSocket not connected, reconnecting...');
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
    console.debug('WebSocket keepalive alarm enabled');
  }
}

// =============================================================================
// Context Menu
// =============================================================================

async function buildContextMenus() {
  await chrome.contextMenus.removeAll();

  const session = await getSession();
  const settings = await getSettings();
  const devices = await getDevices();

  // Browser action context menu items (right-click on extension icon)
  // Only show pop-out option if alwaysPopOut is not enabled
  if (!settings.alwaysPopOut) {
    chrome.contextMenus.create({
      id: 'pop-out',
      title: 'Pop-Out',
      contexts: ['action']
    });
  }
  if (session?.secret && session?.deviceId) {
    chrome.contextMenus.create({
      id: 'mark-all-read',
      title: 'Mark All as Read',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'refresh-messages',
      title: 'Refresh Messages',
      contexts: ['action']
    });
  }

  if (settings.apiToken && settings.userKey) {
    chrome.contextMenus.create({
      id: 'refresh-devices',
      title: 'Refresh Devices',
      contexts: ['action']
    });
  }

  chrome.contextMenus.create({
    id: 'open-settings',
    title: 'Settings',
    contexts: ['action']
  });

  // Only show send menus if send credentials are configured
  if (!settings.apiToken || !settings.userKey) {
    console.debug('Send context menus not created: missing send credentials');
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

  // Parent menu for links
  chrome.contextMenus.create({
    id: 'send-link',
    title: 'Send Link to Pushover',
    contexts: ['link']
  });

  // Parent menu for images
  chrome.contextMenus.create({
    id: 'send-image',
    title: 'Send Image to Pushover',
    contexts: ['image']
  });

  // Add device options under each parent
  for (const parent of ['send-page', 'send-selection', 'send-link', 'send-image']) {
    const contextsMap = { 'send-selection': ['selection'], 'send-link': ['link'], 'send-image': ['image'], 'send-page': ['page'] };
    const contexts = contextsMap[parent];

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

  console.debug(`Context menus created with ${devices.length} devices`);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = info.menuItemId;

  // Handle browser action context menu items
  if (menuId === 'refresh-messages') {
    console.debug('Manual message refresh triggered from context menu');
    await showRefreshingBadge();
    const result = await refreshMessages();
    await updateBadge();
    if (result.error && result.error !== 'not_logged_in') {
      showToastNotification('Refresh Failed', result.error);
    }
    return;
  }

  if (menuId === 'refresh-devices') {
    console.debug('Manual device refresh triggered from context menu');
    await showRefreshingBadge();
    const result = await refreshDevices();
    await updateBadge();
    if (!result.success) {
      showToastNotification('Refresh Failed', result.error || 'Unknown error');
    }
    return;
  }

  if (menuId === 'mark-all-read') {
    console.debug('Mark all as read triggered from context menu');
    await markAllRead();
    await clearAllMessageNotifications();
    await updateBadge();
    return;
  }

  if (menuId === 'pop-out') {
    console.debug('Pop-out triggered from context menu');
    openPageInWindow(Page.ROOT);
    return;
  }

  if (menuId === 'open-settings') {
    console.debug('Settings triggered from context menu');
    chrome.windows.create({ url: chrome.runtime.getURL('src/pages/settings.html'), type: 'popup' });
    return;
  }

  const settings = await getSettings();

  // Parse menu ID: "send-{type}-{device}"
  const match = String(menuId).match(/^send-(page|selection|link|image)-(.+)$/);
  if (!match) return;

  const [, type, device] = match;

  const params = {
    token: settings.apiToken,
    user: settings.userKey,
    device: device === 'all' ? undefined : device
  };

  switch (type) {
    case 'page':
      params.message = tab.title || info.pageUrl;
      params.url = info.pageUrl;
      params.urlTitle = info.pageUrl;
      break;
    case 'link':
      params.message = info.selectionText || 'Link';
      params.url = info.linkUrl;
      params.urlTitle = info.linkUrl;
      break;
    case 'image':
      params.message = 'Image';
      params.url = info.srcUrl;
      params.urlTitle = info.srcUrl;
      try {
        const response = await fetch(info.srcUrl);
        if (response.ok) {
          params.attachmentBuffer = await response.arrayBuffer();
          params.attachmentType = response.headers.get('Content-Type') || 'image/png';
        }
      } catch { }
      break;
    case 'selection':
      params.message = info.selectionText;
      break;
  }

  await handleSendMessage(params);
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
      console.debug('Refresh debounced');
      return { debounced: true };
    }
  }

  const session = await getSession();

  if (!session?.secret || !session?.deviceId) {
    console.debug('Not logged in, skipping refresh');
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

      console.debug(`Fetched ${messages.length} messages, ${newCount} new`);

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
    console.error('Failed to refresh messages:', error);

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
      console.warn('Temporary error, will retry on next refresh:', error.message);
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

async function showRefreshingBadge() {
  await chrome.action.setBadgeText({ text: '↻' });
  await chrome.action.setBadgeBackgroundColor({ color: '#2196F3' }); // Blue for refreshing
}

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

  // max 2 buttons
  options.buttons = [
    { title: 'Dismiss' },
    { title: 'Copy' }
  ];

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

    // Open URL if present (in new tab, not window)
    if (message?.url) {
      openUrlInTab(message.url);
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

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (!notificationId.startsWith('pushover-msg-')) return;
  console.debug('Notification clicked:', notificationId, ', Button index:', buttonIndex);

  const messageId = parseInt(notificationId.replace('pushover-msg-', ''), 10);
  const messages = await getVisibleMessages();
  const message = messages.find(m => m.id === messageId);
  if (!message) return;

  const isEmergency = message.priority === 2 && message.acked === 0 && message.receipt;

  switch (buttonIndex) {
    case 0:
      if (isEmergency) {
        await handleAcknowledgeEmergency(message.receipt, message.id);
      } else {
        await markMessageAsReadFromNotification(notificationId);
        chrome.notifications.clear(notificationId);
      }
      return;
    case 1:
      await handleCopyToClipboard(message.message || '');
      await markMessageAsReadFromNotification(notificationId);
      chrome.notifications.clear(notificationId);
      return;
  }
});

async function handleAcknowledgeEmergency(receipt, messageId) {
  const session = await getSession();
  if (!session?.secret) {
    return { success: false, error: 'Not logged in' };
  }

  try {
    await acknowledgeEmergency(session.secret, receipt);

    // Update message in storage to mark as acknowledged
    const messages = await getMessages();
    const updated = messages.map(m =>
      m.receipt === receipt ? { ...m, acked: 1 } : m
    );
    await saveMessages(updated);

    // Mark as read and clear notification if present
    if (messageId) {
      const notificationId = `pushover-msg-${messageId}`;
      await markMessageAsReadFromNotification(notificationId);
      chrome.notifications.clear(notificationId);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to acknowledge emergency:', error);
    return { success: false, error: error.message };
  }
}

async function handleCopyToClipboard(text) {
  // Use offscreen document API for clipboard access in service worker
  console.info('Copying text to clipboard:', text);
  await createOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ action: 'copyToClipboard', text: text });
  console.info('Offscreen document copy result:', result?.success);
  await closeOffscreenDocument();
}

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
    chrome.runtime.sendMessage({ action: 'errorStateChanged' }).catch(() => { });
  }

  // Reconfigure alarms and WebSocket when settings change
  if (area === 'local' && changes.settings) {
    const newSettings = changes.settings.newValue;
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

  if (request.action === 'acknowledgeEmergency') {
    handleAcknowledgeEmergency(request.receipt, request.messageId).then((result) => {
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
    console.error('Failed to refresh devices:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// Send Message
// =============================================================================

async function handleSendMessage(params) {
  const result = await trySendMessage(params);
  await notifySendResult(result, params.device);
  return result;
}

async function trySendMessage(params) {
  try {
    const result = await sendMessage(params);
    await clearErrorState('send');
    return { success: true, ...result };
  } catch (error) {
    console.error('Send message failed:', error);
    await handleSendError(error);
    return { success: false, error: error.message, errorType: error.errorType };
  }
}

async function handleSendError(error) {
  switch (error.errorType) {
    case ERROR_TYPES.VALIDATION:
    case ERROR_TYPES.AUTH:
      await setErrorState({
        type: 'send_auth',
        message: 'Send credentials invalid. Check your API token and user key in Settings.',
        recoverable: false
      });
      await updateBadge();
      break;
  }
}

async function notifySendResult(result, device) {
  if (await isSendPageOpen()) return;

  if (result.success) {
    showToastNotification('Message Sent', `Sent to ${device || 'all devices'}`);
    return;
  }

  switch (result.errorType) {
    case ERROR_TYPES.VALIDATION:
    case ERROR_TYPES.AUTH:
      showCriticalErrorNotification('send_auth', 'Unable to send messages. Your API credentials are invalid. Please check Settings.');
      break;
    case ERROR_TYPES.RATE_LIMIT:
      showToastNotification('Rate Limited', 'Message limit reached. Try again later.');
      break;
    default:
      showToastNotification('Send Failed', result.error || 'Failed to send message');
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

console.info('Service worker loaded');
