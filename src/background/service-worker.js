// Pushover Chrome Extension - Service Worker
// Background script for handling alarms, notifications, and message sync

import { purgeDeletedMessages, clearErrorState, getSettings } from '../lib/storage.js';
import { validateCredentials } from '../lib/api.js';
import { Page, getPagePath, openPageInWindow } from '../lib/navigation.js';
import { cleanupIconCache } from './icon-cache.js';
import { updateBadge } from './badge.js';
import { setupAlarms, ALARM_NAMES } from './alarms.js';
import { connectWebSocket, disconnectWebSocket, ensureWebSocketConnected } from './websocket.js';
import { setupNotificationListeners, handleAcknowledgeEmergency, clearAllMessageNotifications } from './notifications.js';
import { buildContextMenus, setupContextMenuListener, setContextMenuCallbacks } from './context-menus.js';
import { refreshMessages, refreshDevices, setMessageSyncCallbacks } from './message-sync.js';
import { handleSendMessage } from './send-message.js';

// =============================================================================
// Always-pop-out mode
// =============================================================================

async function syncPopupMode() {
  const settings = await getSettings();
  const defaultPopup = getPagePath(Page.ROOT);
  await chrome.action.setPopup({ popup: settings.alwaysPopOut ? '' : defaultPopup });
}

chrome.action.onClicked.addListener(() => {
  openPageInWindow(Page.ROOT);
});

// =============================================================================
// Initialization
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.info('Browser extension installed/updated:', details.reason);
  if (details.reason === 'install') {
    openPageInWindow(Page.ROOT);
  }

  await syncPopupMode();
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
  await buildContextMenus();
  await connectWebSocket(refreshMessages);
});

chrome.runtime.onStartup.addListener(async () => {
  console.info('Browser started, initializing extension');

  await syncPopupMode();
  await setupAlarms();
  await purgeDeletedMessages();
  await updateBadge();
  await refreshMessages();
  await refreshDevices();
  await connectWebSocket(refreshMessages);
});

// =============================================================================
// Set up callbacks for cross-module communication
// =============================================================================

setContextMenuCallbacks({
  onRefreshMessages: refreshMessages,
  onRefreshDevices: refreshDevices,
  onSendMessage: handleSendMessage
});

setMessageSyncCallbacks({
  onDisconnectWebSocket: disconnectWebSocket
});

// =============================================================================
// Alarm Listener
// =============================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.MESSAGE_REFRESH) {
    console.debug('Message refresh alarm triggered');
    await refreshMessages();
  } else if (alarm.name === ALARM_NAMES.DEVICE_REFRESH) {
    console.debug('Device refresh alarm triggered');
    await refreshDevices();
  } else if (alarm.name === ALARM_NAMES.CLEANUP) {
    console.debug('Cleanup alarm triggered');
    const purged = await purgeDeletedMessages();
    const iconsCleaned = await cleanupIconCache();
    console.debug(`Purged ${purged} deleted messages, ${iconsCleaned} expired icons`);
  } else if (alarm.name === ALARM_NAMES.WEBSOCKET_KEEPALIVE) {
    // Service worker woke up - ensure WebSocket is connected
    await ensureWebSocketConnected(refreshMessages);
  }
});

// =============================================================================
// Storage Change Listener
// =============================================================================

chrome.storage.onChanged.addListener(async (changes, area) => {
  // Update badge when messages change
  if (area === 'local' && changes.messages) {
    console.debug('Storage change detected: messages');
    await updateBadge();
  }

  // Update badge when error state changes
  if (area === 'local' && changes.errorState) {
    console.debug('Storage change detected: error state');
    await updateBadge();
    // Notify popup/pages of error state change
    chrome.runtime.sendMessage({ action: 'errorStateChanged' }).catch(() => { });
  }

  // Reconfigure alarms and WebSocket when settings change
  if (area === 'local' && changes.settings) {
    console.debug('Storage change detected: settings');
    await syncPopupMode();
    await setupAlarms();
    // Connect or disconnect WebSocket based on new refresh interval setting
    await connectWebSocket(refreshMessages);
    // Rebuild context menus if credentials changed
    await buildContextMenus();
  }

  // Set up alarms and WebSocket when user logs in/out
  if (area === 'local' && changes.session) {
    console.debug('Storage change detected: session');
    await setupAlarms();
    if (changes.session.newValue?.deviceId) {
      // User just logged in, clear any previous errors and connect WebSocket
      await clearErrorState();
      await connectWebSocket(refreshMessages);
    } else if (!changes.session.newValue) {
      // User logged out, disconnect WebSocket and clear errors
      await disconnectWebSocket();
      await clearErrorState();
    }
    await updateBadge();
  }

  // Rebuild context menus when devices change
  if (area === 'local' && changes.devices) {
    console.debug('Storage change detected: devices');
    await buildContextMenus();
  }
});

// =============================================================================
// Message Listener (for communication with popup/pages)
// =============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.debug('Received runtime message:', request.action);

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

  if (request.action === 'validateCredentials') {
    validateCredentials(request.apiToken, request.userKey).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ valid: false, error: error.message });
    });
    return true;
  }
});

// =============================================================================
// Set up event listeners
// =============================================================================

setupNotificationListeners();
setupContextMenuListener();

console.info('Service worker loaded');
