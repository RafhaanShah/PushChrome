// Message synchronization with Pushover server

import { getSession, appendMessages, getErrorState, setErrorState, clearErrorState } from '../lib/storage.js';
import { fetchMessages, deleteMessages, validateCredentials, ERROR_TYPES } from '../lib/api.js';
import { getSettings, saveDevices } from '../lib/storage.js';
import { updateBadge } from './badge.js';
import { showNotificationsForNewMessages, showCriticalErrorNotification } from './notifications.js';

const DEBOUNCE_MS = 60000; // 1 minute

let lastRefreshTime = 0;
let disconnectWebSocketCallback = null;

export function setMessageSyncCallbacks({ onDisconnectWebSocket }) {
  disconnectWebSocketCallback = onDisconnectWebSocket;
}

export async function refreshMessages(options = {}) {
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
    console.info('Refreshing messages from server...');
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

      console.info(`Fetched ${messages.length} messages, ${newCount} new`);

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
      if (disconnectWebSocketCallback) {
        await disconnectWebSocketCallback();
      }
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
      if (disconnectWebSocketCallback) {
        await disconnectWebSocketCallback();
      }
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

export async function refreshDevices() {
  try {
    const settings = await getSettings();

    if (!settings.apiToken || !settings.userKey) {
      return { success: false, error: 'Send credentials not configured' };
    }

    console.info('Refreshing devices from server...');
    const result = await validateCredentials(settings.apiToken, settings.userKey);
    console.info(`Device refresh result: valid=${result.valid}, devices=${result.devices.length}`);

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
