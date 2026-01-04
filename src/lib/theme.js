// Pushover Chrome Extension - Theme Management
// Handles dark mode toggling and persistence

import { getSettings } from './settingsStore.js';

export function applyTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

export async function initTheme() {
  const settings = await getSettings();
  applyTheme(settings.darkMode);
}
