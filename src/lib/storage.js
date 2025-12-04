// Pushover Chrome Extension - Storage Abstraction
// Handles session, settings, and message cache using Chrome Storage API

const STORAGE_KEYS = {
  SESSION: 'session',
  MESSAGES: 'messages',
  LAST_READ_ID: 'lastReadId',
  SETTINGS: 'settings',
  PENDING_LOGIN: 'pendingLogin',
  DEVICES: 'devices'
};

const DEFAULT_SETTINGS = {
  apiToken: '',
  userKey: '',
  refreshInterval: 5,
  notificationsEnabled: true,
  badgeEnabled: true,
  maxMessages: 50
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

// =============================================================================
// Settings Storage (chrome.storage.sync - synced across devices)
// =============================================================================

export async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
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
// Message Cache (chrome.storage.local)
// =============================================================================

export async function getMessages() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.MESSAGES);
  return result[STORAGE_KEYS.MESSAGES] || [];
}

export async function saveMessages(messages) {
  await chrome.storage.local.set({ [STORAGE_KEYS.MESSAGES]: messages });
}

export async function appendMessages(newMessages) {
  if (!newMessages || newMessages.length === 0) return;
  
  const existing = await getMessages();
  const existingIds = new Set(existing.map(m => m.id));
  
  const uniqueNew = newMessages.filter(m => !existingIds.has(m.id));
  if (uniqueNew.length === 0) return;
  
  const combined = [...existing, ...uniqueNew];
  combined.sort((a, b) => b.date - a.date);
  
  const settings = await getSettings();
  const trimmed = combined.slice(0, settings.maxMessages);
  
  await saveMessages(trimmed);
  return uniqueNew.length;
}

export async function clearMessages() {
  await chrome.storage.local.remove([STORAGE_KEYS.MESSAGES, STORAGE_KEYS.LAST_READ_ID]);
}

// =============================================================================
// Read State Tracking
// =============================================================================

export async function getLastReadId() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_READ_ID);
  return result[STORAGE_KEYS.LAST_READ_ID] || null;
}

export async function setLastReadId(messageId) {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_READ_ID]: messageId });
}

export async function getUnreadCount() {
  const messages = await getMessages();
  const lastReadId = await getLastReadId();
  
  if (!lastReadId) {
    return messages.length;
  }
  
  let count = 0;
  for (const msg of messages) {
    if (String(msg.id) === String(lastReadId)) break;
    count++;
  }
  return count;
}

export async function markAllRead() {
  const messages = await getMessages();
  if (messages.length > 0) {
    await setLastReadId(messages[0].id);
  }
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

// =============================================================================
// Full Clear (for logout)
// =============================================================================

export async function clearAll() {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
}
