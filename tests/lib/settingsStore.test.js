// Pushover Chrome Extension - Settings Store Tests
// Run: node --test tests/lib/settingsStore.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// =============================================================================
// Chrome Storage Mock
// =============================================================================

const store = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') {
          return { [key]: store[key] };
        }
        return {};
      },
      async set(items) {
        Object.assign(store, items);
      }
    }
  }
};

function clearStore() {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}

// Import after mock is set up
const { getSettings, saveSettings, DEFAULT_SETTINGS } = await import('../../src/lib/settingsStore.js');

// =============================================================================
// Tests
// =============================================================================

describe('DEFAULT_SETTINGS', () => {
  it('has expected default values', () => {
    assert.equal(DEFAULT_SETTINGS.apiToken, '');
    assert.equal(DEFAULT_SETTINGS.userKey, '');
    assert.equal(DEFAULT_SETTINGS.refreshInterval, -1);
    assert.equal(DEFAULT_SETTINGS.notificationsEnabled, true);
    assert.equal(DEFAULT_SETTINGS.badgeEnabled, true);
    assert.equal(DEFAULT_SETTINGS.maxMessages, 100);
    assert.equal(DEFAULT_SETTINGS.markAsReadOnOpen, true);
    assert.equal(DEFAULT_SETTINGS.alwaysPopOut, false);
    assert.equal(DEFAULT_SETTINGS.darkMode, 'system');
  });
});

describe('getSettings', () => {
  beforeEach(() => clearStore());

  it('returns defaults when nothing is stored', async () => {
    const settings = await getSettings();
    assert.deepEqual(settings, DEFAULT_SETTINGS);
  });

  it('merges stored values over defaults', async () => {
    store.settings = { apiToken: 'my-token', maxMessages: 50 };

    const settings = await getSettings();
    assert.equal(settings.apiToken, 'my-token');
    assert.equal(settings.maxMessages, 50);
    // Other defaults preserved
    assert.equal(settings.notificationsEnabled, true);
    assert.equal(settings.darkMode, 'system');
  });

  it('stored values fully override defaults', async () => {
    store.settings = { notificationsEnabled: false, badgeEnabled: false };

    const settings = await getSettings();
    assert.equal(settings.notificationsEnabled, false);
    assert.equal(settings.badgeEnabled, false);
  });
});

describe('saveSettings', () => {
  beforeEach(() => clearStore());

  it('persists new settings', async () => {
    await saveSettings({ apiToken: 'abc123' });

    assert.equal(store.settings.apiToken, 'abc123');
  });

  it('merges with existing settings', async () => {
    store.settings = { apiToken: 'old-token', maxMessages: 25 };

    await saveSettings({ apiToken: 'new-token' });

    assert.equal(store.settings.apiToken, 'new-token');
    assert.equal(store.settings.maxMessages, 25);
  });

  it('fills in defaults for missing keys', async () => {
    const result = await saveSettings({ apiToken: 'tok' });

    assert.equal(result.apiToken, 'tok');
    assert.equal(result.refreshInterval, -1);
    assert.equal(result.notificationsEnabled, true);
  });

  it('returns the full merged settings', async () => {
    const result = await saveSettings({ darkMode: 'dark', maxMessages: 200 });

    assert.equal(result.darkMode, 'dark');
    assert.equal(result.maxMessages, 200);
    assert.equal(result.apiToken, '');
  });

  it('overwrites previous saves', async () => {
    await saveSettings({ apiToken: 'first' });
    await saveSettings({ apiToken: 'second' });

    const settings = await getSettings();
    assert.equal(settings.apiToken, 'second');
  });

  it('preserves keys not included in update', async () => {
    await saveSettings({ apiToken: 'tok', userKey: 'usr' });
    await saveSettings({ apiToken: 'new-tok' });

    const settings = await getSettings();
    assert.equal(settings.apiToken, 'new-tok');
    assert.equal(settings.userKey, 'usr');
  });
});
