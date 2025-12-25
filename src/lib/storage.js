// Pushover Chrome Extension - Storage Abstraction
// Handles session, settings, and message cache using Chrome Storage API

const STORAGE_KEYS = {
  SESSION: 'session',
  MESSAGES: 'messages',
  SETTINGS: 'settings',
  PENDING_LOGIN: 'pendingLogin',
  DEVICES: 'devices',
  SEND_PREFERENCES: 'sendPreferences'
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
// Message Cache (chrome.storage.local)
// =============================================================================

export async function getMessages() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.MESSAGES);
  return result[STORAGE_KEYS.MESSAGES] || [];
}

export async function saveMessages(messages) {
  await chrome.storage.local.set({ [STORAGE_KEYS.MESSAGES]: messages });
}

export async function softDeleteMessage(messageId) {
  const messages = await getMessages();
  const updated = messages.map(m => 
    m.id === messageId ? { ...m, _deletedAt: Date.now() } : m
  );
  await saveMessages(updated);
}

export async function getVisibleMessages() {
  const messages = await getMessages();
  return messages.filter(m => !m._deletedAt);
}

export async function purgeDeletedMessages(olderThanMs = 24 * 60 * 60 * 1000) {
  const messages = await getMessages();
  const cutoff = Date.now() - olderThanMs;
  const filtered = messages.filter(m => !m._deletedAt || m._deletedAt > cutoff);
  await saveMessages(filtered);
  return messages.length - filtered.length;
}

export async function appendMessages(newMessages) {
  if (!newMessages || newMessages.length === 0) return 0;
  
  const existing = await getMessages();
  const existingIds = new Set(existing.map(m => m.id));
  
  const uniqueNew = newMessages
    .filter(m => !existingIds.has(m.id))
    .map(m => ({ ...m, _seen: false }));
  
  if (uniqueNew.length === 0) return 0;
  
  const combined = [...existing, ...uniqueNew];
  combined.sort((a, b) => b.date - a.date);
  
  const settings = await getSettings();
  const trimmed = combined.slice(0, settings.maxMessages);
  
  await saveMessages(trimmed);
  return uniqueNew.length;
}

export async function clearMessages() {
  await chrome.storage.local.remove(STORAGE_KEYS.MESSAGES);
}

// =============================================================================
// Read State Tracking (per-message _seen flag)
// =============================================================================

export async function getUnreadCount() {
  const messages = await getVisibleMessages();
  return messages.filter(m => !m._seen).length;
}

export async function markAllRead() {
  const messages = await getMessages();
  const updated = messages.map(m => m._seen ? m : { ...m, _seen: true });
  await saveMessages(updated);
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
