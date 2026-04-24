// Pushover Chrome Extension - Storage Abstraction
// Handles session, devices, and pending state using Chrome Storage API
// Settings are handled by settingsStore.js
// Message storage is handled by messageStore.js using IndexedDB

import {
  getMessages,
  getMessage,
  getVisibleMessages,
  getVisibleMessagesPaginated,
  getVisibleMessagesCount,
  searchMessages,
  saveMessages,
  putMessage,
  putMessages,
  deleteMessage,
  softDeleteMessage,
  clearMessages,
  appendMessages,
  applyMessageLimit,
  getUnreadCount,
  markMessageRead,
  markAllRead,
  purgeDeletedMessages,
  deleteDatabase as deleteMessageDatabase
} from './messageStore.js';

import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings
} from './settingsStore.js';

export {
  getMessages,
  getMessage,
  getVisibleMessages,
  getVisibleMessagesPaginated,
  getVisibleMessagesCount,
  searchMessages,
  saveMessages,
  putMessage,
  putMessages,
  deleteMessage,
  softDeleteMessage,
  clearMessages,
  appendMessages,
  applyMessageLimit,
  getUnreadCount,
  markMessageRead,
  markAllRead,
  purgeDeletedMessages,
  deleteMessageDatabase,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings
};

const STORAGE_KEYS = {
  SESSION: 'session',
  PENDING_LOGIN: 'pendingLogin',
  DEVICES: 'devices',
  SEND_PREFERENCES: 'sendPreferences',
  ERROR_STATE: 'errorState',
  SCROLL_POSITION: 'scrollPosition',
  SOUNDS_CACHE: 'soundsCache'
};

// =============================================================================
// Session Storage (chrome.storage.local - sensitive data)
// =============================================================================

export async function getSession() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
  return result[STORAGE_KEYS.SESSION] || null;
}

export async function saveSession(session) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSION]: session });
}

export async function clearSession() {
  await chrome.storage.local.remove(STORAGE_KEYS.SESSION);
}

export async function isLoggedIn() {
  const session = await getSession();
  return !!(session?.secret && session?.deviceId);
}

export async function isSendOnlyMode() {
  const settings = await getSettings();
  return !!(settings?.apiToken && settings?.userKey);
}

// =============================================================================
// Device List (chrome.storage.local)
// =============================================================================

export async function getDevices() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.DEVICES);
  return result[STORAGE_KEYS.DEVICES] || [];
}

export async function saveDevices(devices) {
  await chrome.storage.local.set({ [STORAGE_KEYS.DEVICES]: devices });
}

// =============================================================================
// Send Preferences (chrome.storage.local - last used send settings)
// =============================================================================

export async function getSendPreferences() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SEND_PREFERENCES);
  return result[STORAGE_KEYS.SEND_PREFERENCES] || { device: '', priority: '0', sound: '' };
}

export async function saveSendPreferences(prefs) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SEND_PREFERENCES]: prefs });
}

// =============================================================================
// Pending Login State (chrome.storage.session - browser session only)
// Used to preserve auth state if user closes popup before completing device registration
// =============================================================================

export async function getPendingLogin() {
  const result = await chrome.storage.session.get(STORAGE_KEYS.PENDING_LOGIN);
  return result[STORAGE_KEYS.PENDING_LOGIN] || null;
}

export async function savePendingLogin(loginResult) {
  await chrome.storage.session.set({ [STORAGE_KEYS.PENDING_LOGIN]: loginResult });
}

export async function clearPendingLogin() {
  await chrome.storage.session.remove(STORAGE_KEYS.PENDING_LOGIN);
}

export async function getPendingEmail() {
  const result = await chrome.storage.session.get('pendingEmail');
  return result.pendingEmail || '';
}

export async function savePendingEmail(email) {
  await chrome.storage.session.set({ pendingEmail: email });
}

export async function clearPendingEmail() {
  await chrome.storage.session.remove('pendingEmail');
}

// =============================================================================
// Error State (chrome.storage.local - tracks credential/connection errors)
// =============================================================================

export async function getErrorState() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.ERROR_STATE);
  return result[STORAGE_KEYS.ERROR_STATE] || null;
}

export async function setErrorState(errorState) {
  if (!errorState) {
    await clearErrorState();
    return;
  }
  
  await chrome.storage.local.set({
    [STORAGE_KEYS.ERROR_STATE]: {
      type: errorState.type,
      message: errorState.message,
      timestamp: Date.now(),
      recoverable: errorState.recoverable ?? false
    }
  });
}

export async function clearErrorState(prefix = null) {
  if (prefix) {
    const current = await getErrorState();
    if (current?.type?.startsWith(prefix)) {
      await chrome.storage.local.remove(STORAGE_KEYS.ERROR_STATE);
    }
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.ERROR_STATE);
  }
}

// =============================================================================
// Scroll Position (chrome.storage.local - remembers scroll position)
// =============================================================================

export async function getScrollPosition(maxAgeSeconds = 600) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SCROLL_POSITION);
  const data = result[STORAGE_KEYS.SCROLL_POSITION];
  
  if (!data || typeof data.position !== 'number') return 0;
  
  const ageSeconds = (Date.now() - (data.timestamp || 0)) / 1000;
  if (ageSeconds > maxAgeSeconds) return 0;
  
  return data.position;
}

export async function saveScrollPosition(position) {
  await chrome.storage.local.set({ 
    [STORAGE_KEYS.SCROLL_POSITION]: { position, timestamp: Date.now() } 
  });
}

// =============================================================================
// Sounds Cache (chrome.storage.local - cached API sound list)
// =============================================================================

const SOUNDS_CACHE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

export async function getCachedSounds(token) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SOUNDS_CACHE);
  const entry = result[STORAGE_KEYS.SOUNDS_CACHE];
  if (entry && entry.token === token && (Date.now() - entry.timestamp) < SOUNDS_CACHE_MAX_AGE) {
    return entry.sounds;
  }
  return null;
}

export async function saveCachedSounds(token, sounds) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SOUNDS_CACHE]: { sounds, token, timestamp: Date.now() }
  });
}

// =============================================================================
// Full Clear (for logout)
// =============================================================================

export async function clearAll() {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await deleteMessageDatabase();
}
