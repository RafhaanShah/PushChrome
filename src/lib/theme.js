// Pushover Chrome Extension - Theme Management
// Handles dark mode toggling with system preference detection

import { getSettings } from './settingsStore.js';

const systemQuery = window.matchMedia('(prefers-color-scheme: dark)');

function setDark(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
}

export function applyTheme(mode) {
  // Migrate legacy boolean values
  if (mode === true) mode = 'dark';
  if (mode === false) mode = 'light';

  if (mode === 'dark') {
    setDark(true);
  } else if (mode === 'light') {
    setDark(false);
  } else {
    // 'system' — follow OS preference
    setDark(systemQuery.matches);
  }
}

export async function initTheme() {
  const settings = await getSettings();
  applyTheme(settings.darkMode);

  // Live-update when OS preference changes (only matters in 'system' mode)
  systemQuery.addEventListener('change', async () => {
    const s = await getSettings();
    if (s.darkMode === 'system') {
      setDark(systemQuery.matches);
    }
  });
}
