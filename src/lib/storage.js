// Pushover Chrome Extension - Storage Abstraction
// Handles session, settings, and message cache using Chrome Storage API

const STORAGE_KEYS = {
  SESSION: 'session',
  MESSAGES: 'messages',
  LAST_READ_ID: 'lastReadId',
  SETTINGS: 'settings'
};

const DEFAULT_SETTINGS = {
  apiToken: '',
  userKey: '',
  refreshInterval: 5,
  notificationsEnabled: true,
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
// Full Clear (for logout)
// =============================================================================

export async function clearAll() {
  await chrome.storage.local.clear();
}
