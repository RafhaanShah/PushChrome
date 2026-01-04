// Pushover Chrome Extension - Settings Storage
// Handles user settings using Chrome Storage API

const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS = {
  apiToken: '',
  userKey: '',
  refreshInterval: -1,
  deviceRefreshInterval: 60,
  notificationsEnabled: true,
  badgeEnabled: true,
  maxMessages: 100,
  markAsReadOnOpen: true,
  alwaysPopOut: false,
  darkMode: false
};

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return updated;
}
