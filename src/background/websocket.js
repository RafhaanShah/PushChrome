// WebSocket connection management for instant message delivery

import { getSession, getSettings, getErrorState, setErrorState, clearErrorState } from '../lib/storage.js';
import { createWebSocketConnection } from '../lib/api.js';
import { setupWebSocketKeepalive } from './alarms.js';
import { updateBadge } from './badge.js';
import { showCriticalErrorNotification } from './notifications.js';

const WEBSOCKET_RECONNECT_DELAY = 30000; // 30 seconds

let websocket = null;
let websocketReconnectTimeout = null;

export async function connectWebSocket(onMessageCallback) {
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
      console.info('WebSocket: New message notification received');
      if (onMessageCallback) {
        await onMessageCallback();
      }
    },

    onReload: () => {
      console.info('WebSocket: Reload requested, reconnecting...');
      scheduleWebSocketReconnect(onMessageCallback);
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
        const isNewError = existingError?.type !== 'session_conflict';
        await setErrorState({
          type: 'session_conflict',
          message: 'Another device is using this session. Please re-login.',
          recoverable: false
        });
        await disconnectWebSocket();
        await updateBadge();
        if (isNewError) {
          showCriticalErrorNotification('session_conflict', 'Session conflict detected. Please re-login.');
        }
      } else {
        // Temporary error, schedule reconnect
        scheduleWebSocketReconnect(onMessageCallback);
      }
    },

    onClose: () => {
      console.info('WebSocket closed');
      websocket = null;
    }
  });
}

export async function disconnectWebSocket() {
  if (websocketReconnectTimeout) {
    clearTimeout(websocketReconnectTimeout);
    websocketReconnectTimeout = null;
  }

  if (websocket) {
    websocket.close();
    websocket = null;
  }

  await setupWebSocketKeepalive(false);
}

function scheduleWebSocketReconnect(onMessageCallback) {
  if (websocketReconnectTimeout) {
    return; // Already scheduled
  }

  console.info(`Scheduling WebSocket reconnect in ${WEBSOCKET_RECONNECT_DELAY / 1000} seconds`);
  websocketReconnectTimeout = setTimeout(async () => {
    websocketReconnectTimeout = null;
    await connectWebSocket(onMessageCallback);
  }, WEBSOCKET_RECONNECT_DELAY);
}

export async function ensureWebSocketConnected(onMessageCallback) {
  const settings = await getSettings();

  if (settings.refreshInterval !== -1) {
    return; // Not using WebSocket mode
  }

  // console.debug('Ensuring WebSocket is connected...');
  if (!websocket || (websocket.readyState !== WebSocket.OPEN && websocket.readyState !== WebSocket.CONNECTING)) {
    console.debug('WebSocket not connected, reconnecting...');
    await connectWebSocket(onMessageCallback);
  }
}

export function isWebSocketConnected() {
  return websocket && websocket.readyState === WebSocket.OPEN;
}
