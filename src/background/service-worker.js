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
  saveMessages
} from '../lib/storage.js';
import { fetchMessages, deleteMessages, getIconUrl, sendMessage } from '../lib/api.js';

const ALARM_NAME = 'refreshMessages';
const CLEANUP_ALARM_NAME = 'cleanupMessages';
const DEBOUNCE_MS = 60000; // 1 minute

let lastRefreshTime = 0;

// =============================================================================
// Initialization
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Pushover extension installed/updated:', details.reason);
  
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Browser started, initializing Pushover extension');
  
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
  
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
  
  // Only set up refresh alarm if logged in AND auto-refresh is enabled (interval > 0)
  if (session?.secret && session?.deviceId && settings.refreshInterval > 0) {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: settings.refreshInterval
    });
    console.log(`Refresh alarm set for every ${settings.refreshInterval} minutes`);
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
  
  const options = {
    type: 'basic',
    title: message.title || message.app || 'Pushover',
    message: message.message || '',
    iconUrl: getIconUrl(message.icon) || 'src/icons/icon-128.png',
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
    options.iconUrl = 'src/icons/icon-128.png';
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
  
  // Reconfigure alarms when settings change
  if (area === 'sync' && changes.settings) {
    await setupAlarms();
  }
  
  // Set up alarms when user logs in
  if (area === 'local' && changes.session) {
    await setupAlarms();
    if (changes.session.newValue?.deviceId) {
      // User just logged in, refresh messages
      await refreshMessages();
    }
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
    iconUrl: 'src/icons/icon-128.png',
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
