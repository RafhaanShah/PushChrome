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
  getDevices
} from '../lib/storage.js';
import { fetchMessages, deleteMessages, getIconUrl, sendMessage, createWebSocketConnection } from '../lib/api.js';

const ALARM_NAME = 'refreshMessages';
const CLEANUP_ALARM_NAME = 'cleanupMessages';
const WEBSOCKET_KEEPALIVE_ALARM = 'websocketKeepalive';
const DEBOUNCE_MS = 60000; // 1 minute
const WEBSOCKET_RECONNECT_DELAY = 30000; // 30 seconds

let lastRefreshTime = 0;
let websocket = null;
let websocketReconnectTimeout = null;

// =============================================================================
// Initialization
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Pushover extension installed/updated:', details.reason);
  
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
  await buildContextMenus();
  await connectWebSocket();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Browser started, initializing Pushover extension');
  
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
  await connectWebSocket();
  
  // Refresh messages on browser startup
  await refreshMessages();
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
    console.log(`Refresh alarm set for every ${settings.refreshInterval} minutes`);
  } else if (settings.refreshInterval === -1) {
    console.log('Using WebSocket for instant refresh');
  } else if (settings.refreshInterval === 0) {
    console.log('Auto-refresh disabled (manual only)');
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
    console.log('Refresh alarm triggered');
    await refreshMessages();
  } else if (alarm.name === CLEANUP_ALARM_NAME) {
    console.log('Cleanup alarm triggered');
    const purged = await purgeDeletedMessages();
    console.log(`Purged ${purged} deleted messages`);
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
    console.log('WebSocket disabled (not using instant refresh mode)');
    await disconnectWebSocket();
    return;
  }
  
  const session = await getSession();
  
  if (!session?.secret || !session?.deviceId) {
    console.log('Not logged in, skipping WebSocket connection');
    return;
  }
  
  await disconnectWebSocket();
  
  console.log('Connecting to Pushover WebSocket...');
  
  // Enable keepalive alarm to handle service worker restarts
  await setupWebSocketKeepalive(true);
  
  websocket = createWebSocketConnection(session.deviceId, session.secret, {
    onOpen: async () => {
      console.log('WebSocket connected and logged in');
    },
    
    onMessage: async () => {
      console.log('WebSocket: New message notification received');
      await refreshMessages();
    },
    
    onReload: () => {
      console.log('WebSocket: Reload requested, reconnecting...');
      scheduleWebSocketReconnect();
    },
    
    onError: async (type, message) => {
      console.error(`WebSocket error (${type}):`, message);
      if (type === 'permanent' || type === 'session_conflict') {
        // Don't auto-reconnect for permanent errors
        await disconnectWebSocket();
      }
    },
    
    onClose: (code, reason) => {
      console.log(`WebSocket closed: ${code} ${reason}`);
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
  
  console.log(`Scheduling WebSocket reconnect in ${WEBSOCKET_RECONNECT_DELAY / 1000}s`);
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

  console.log('Checking WebSocket status: ', websocket ? websocket.readyState : 'not connected');
  
  // If WebSocket is not connected, reconnect
  if (!websocket || (websocket.readyState !== WebSocket.OPEN && websocket.readyState !== WebSocket.CONNECTING)) {
    console.log('WebSocket not connected, reconnecting...');
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
    console.log('WebSocket keepalive alarm enabled');
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
    console.log('Context menus not created: missing send credentials');
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
    chrome.contextMenus.create({
      id: `${parent}-all`,
      parentId: parent,
      title: 'All devices'
    });
    
    if (devices.length > 0) {
      chrome.contextMenus.create({
        id: `${parent}-separator`,
        parentId: parent,
        type: 'separator'
      });
      
      for (const device of devices) {
        chrome.contextMenus.create({
          id: `${parent}-${device}`,
          parentId: parent,
          title: device
        });
      }
    }
  }
  
  console.log(`Context menus created with ${devices.length} devices`);
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
  } else if (isSelection) {
    params.message = info.selectionText;
    params.url = info.pageUrl;
    params.urlTitle = tab.title;
  }
  
  try {
    await sendMessage(params);
    showToastNotification('Message Sent', `Sent to ${device === 'all' ? 'all devices' : device}`);
  } catch (error) {
    showToastNotification('Send Failed', error.message || 'Failed to send message');
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
      console.log('Refresh debounced');
      return { debounced: true };
    }
  }
  
  const session = await getSession();
  
  if (!session?.secret || !session?.deviceId) {
    console.log('Not logged in, skipping refresh');
    return { error: 'not_logged_in' };
  }
  
  try {
    const messages = await fetchMessages(session.secret, session.deviceId);
    lastRefreshTime = Date.now();
    
    let newCount = 0;
    if (messages.length > 0) {
      newCount = await appendMessages(messages);
      
      // Delete messages from server after caching locally
      const highestId = Math.max(...messages.map(m => m.id));
      await deleteMessages(session.secret, session.deviceId, highestId);
      
      console.log(`Fetched ${messages.length} messages, ${newCount} new`);
      
      // Show notifications for new messages (unless popup is open)
      if (newCount > 0 && !skipNotifications) {
        const popupOpen = await isMessagesPageOpen();
        if (!popupOpen) {
          await showNotificationsForNewMessages(newCount);
        }
      }
      
      // Notify any open popup to refresh display
      if (newCount > 0) {
        notifyPopupOfNewMessages();
      }
    }
    
    // Only update badge if popup is not open (popup handles its own badge)
    if (!skipNotifications) {
      const popupOpen = await isMessagesPageOpen();
      if (!popupOpen) {
        await updateBadge();
      }
    }
    
    return { success: true, newCount };
  } catch (error) {
    console.error('Failed to refresh messages:', error);
    return { error: error.message };
  }
}

async function isMessagesPageOpen() {
  const views = await chrome.runtime.getContexts({
    contextTypes: ['TAB', 'POPUP']
  });
  
  return views.some(v => v.documentUrl?.includes('messages.html'));
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
  
  const count = await getUnreadCount();
  
  if (count > 0) {
    await chrome.action.setBadgeText({ 
      text: count > 99 ? '99+' : String(count) 
    });
    await chrome.action.setBadgeBackgroundColor({ color: '#E53935' });
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
  
  const options = {
    type: 'basic',
    title: message.title || message.app || 'Pushover',
    message: message.message || '',
    iconUrl: getIconUrl(message.icon) || fallbackIcon,
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
          console.error('Failed to acknowledge emergency:', error);
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
      // User just logged in, connect WebSocket
      await connectWebSocket();
    } else if (!changes.session.newValue) {
      // User logged out, disconnect WebSocket
      await disconnectWebSocket();
    }
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
});

// =============================================================================
// Send Message
// =============================================================================

async function handleSendMessage(params) {
  try {
    const result = await sendMessage(params);
    
    // Check if send page is still open
    const sendPageOpen = await isSendPageOpen();
    
    if (!sendPageOpen) {
      // Show toast notification for success
      showToastNotification('Message Sent', `Sent to ${params.device || 'all devices'}`);
    }
    
    return { success: true, ...result };
  } catch (error) {
    // Check if send page is still open
    const sendPageOpen = await isSendPageOpen();
    
    if (!sendPageOpen) {
      // Show toast notification for error
      showToastNotification('Send Failed', error.message || 'Failed to send message');
    }
    
    return { success: false, error: error.message };
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

console.log('Pushover service worker loaded');
