// Alarm management for periodic tasks

import { getSession, getSettings } from '../lib/storage.js';

export const ALARM_NAMES = {
  MESSAGE_REFRESH: 'refreshMessages',
  DEVICE_REFRESH: 'refreshDevices',
  CLEANUP: 'cleanupMessages',
  WEBSOCKET_KEEPALIVE: 'websocketKeepalive'
};

export async function setupAlarms() {
  const settings = await getSettings();
  const session = await getSession();

  // Clear existing refresh alarm
  await chrome.alarms.clear(ALARM_NAMES.MESSAGE_REFRESH);

  // Only set up refresh alarm if logged in AND periodic refresh is enabled (interval > 0)
  // WebSocket mode (interval = -1) and manual mode (interval = 0) don't use alarms
  if (session?.secret && session?.deviceId && settings.refreshInterval > 0) {
    chrome.alarms.create(ALARM_NAMES.MESSAGE_REFRESH, {
      periodInMinutes: settings.refreshInterval
    });
    console.info(`Message refresh alarm set for every ${settings.refreshInterval} minutes`);
  } else if (settings.refreshInterval === -1) {
    console.info('Using WebSocket for instant refresh');
  } else if (settings.refreshInterval === 0) {
    console.info('Auto-refresh disabled (manual only)');
  }

  // Clear existing device refresh alarm
  await chrome.alarms.clear(ALARM_NAMES.DEVICE_REFRESH);

  // Set up device refresh alarm if send credentials are configured and interval > 0
  if (settings.apiToken && settings.userKey && settings.deviceRefreshInterval > 0) {
    chrome.alarms.create(ALARM_NAMES.DEVICE_REFRESH, {
      periodInMinutes: settings.deviceRefreshInterval
    });
    console.info(`Device refresh alarm set for every ${settings.deviceRefreshInterval} minutes`);
  } else if (settings.deviceRefreshInterval === 0) {
    console.info('Device auto-refresh disabled (manual only)');
  }

  // Daily cleanup alarm for soft-deleted messages (always enabled)
  chrome.alarms.get(ALARM_NAMES.CLEANUP, (existing) => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAMES.CLEANUP, {
        periodInMinutes: 60 * 24 // Once per day
      });
    }
  });
}

export async function setupWebSocketKeepalive(enabled) {
  await chrome.alarms.clear(ALARM_NAMES.WEBSOCKET_KEEPALIVE);

  if (enabled) {
    chrome.alarms.create(ALARM_NAMES.WEBSOCKET_KEEPALIVE, {
      periodInMinutes: 1 // Every minute to keep service worker alive
    });
    console.debug('WebSocket keepalive alarm enabled');
  } else {
    console.debug('WebSocket keepalive alarm disabled');
  }
}
