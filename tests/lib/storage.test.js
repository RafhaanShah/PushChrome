// Pushover Chrome Extension - Storage Tests
// Run: node --import ./tests/loader.js --test tests/lib/storage.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// =============================================================================
// Chrome Storage Mock
// =============================================================================

const localStore = {};
const sessionStore = {};

function clearStores() {
  for (const key of Object.keys(localStore)) delete localStore[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
}

function makeStorageArea(store) {
  return {
    async get(key) {
      if (typeof key === 'string') return { [key]: store[key] };
      return {};
    },
    async set(items) {
      Object.assign(store, items);
    },
    async remove(key) {
      delete store[key];
    },
    async clear() {
      for (const k of Object.keys(store)) delete store[k];
    }
  };
}

globalThis.chrome = {
  storage: {
    local: makeStorageArea(localStore),
    session: makeStorageArea(sessionStore)
  }
};

const storage = await import('../../src/lib/storage.js');

// =============================================================================
// isLoggedIn
// =============================================================================

describe('isLoggedIn', () => {
  beforeEach(() => clearStores());

  it('returns false when no session exists', async () => {
    assert.equal(await storage.isLoggedIn(), false);
  });

  it('returns false when session has no secret', async () => {
    localStore.session = { deviceId: 'dev123' };
    assert.equal(await storage.isLoggedIn(), false);
  });

  it('returns false when session has no deviceId', async () => {
    localStore.session = { secret: 'sec123' };
    assert.equal(await storage.isLoggedIn(), false);
  });

  it('returns true when session has both secret and deviceId', async () => {
    localStore.session = { secret: 'sec123', deviceId: 'dev123' };
    assert.equal(await storage.isLoggedIn(), true);
  });
});

// =============================================================================
// isSendOnlyMode
// =============================================================================

describe('isSendOnlyMode', () => {
  beforeEach(() => clearStores());

  it('returns false when no settings exist', async () => {
    assert.equal(await storage.isSendOnlyMode(), false);
  });

  it('returns false when only apiToken is set', async () => {
    localStore.settings = { apiToken: 'tok123' };
    assert.equal(await storage.isSendOnlyMode(), false);
  });

  it('returns false when only userKey is set', async () => {
    localStore.settings = { userKey: 'usr123' };
    assert.equal(await storage.isSendOnlyMode(), false);
  });

  it('returns true when both apiToken and userKey are set', async () => {
    localStore.settings = { apiToken: 'tok123', userKey: 'usr123' };
    assert.equal(await storage.isSendOnlyMode(), true);
  });
});

// =============================================================================
// Session CRUD
// =============================================================================

describe('session', () => {
  beforeEach(() => clearStores());

  it('getSession returns null when empty', async () => {
    assert.equal(await storage.getSession(), null);
  });

  it('saveSession + getSession round-trips', async () => {
    const session = { secret: 's', userId: 'u', deviceId: 'd', deviceName: 'n' };
    await storage.saveSession(session);
    assert.deepEqual(await storage.getSession(), session);
  });

  it('clearSession removes session', async () => {
    await storage.saveSession({ secret: 's' });
    await storage.clearSession();
    assert.equal(await storage.getSession(), null);
  });
});

// =============================================================================
// Devices
// =============================================================================

describe('devices', () => {
  beforeEach(() => clearStores());

  it('getDevices returns empty array when none stored', async () => {
    assert.deepEqual(await storage.getDevices(), []);
  });

  it('saveDevices + getDevices round-trips', async () => {
    await storage.saveDevices(['phone', 'tablet']);
    assert.deepEqual(await storage.getDevices(), ['phone', 'tablet']);
  });
});

// =============================================================================
// Send Preferences
// =============================================================================

describe('sendPreferences', () => {
  beforeEach(() => clearStores());

  it('returns defaults when none stored', async () => {
    const prefs = await storage.getSendPreferences();
    assert.deepEqual(prefs, { device: '', priority: '0', sound: '' });
  });

  it('round-trips saved preferences', async () => {
    const prefs = { device: 'phone', priority: '1', sound: 'pushover' };
    await storage.saveSendPreferences(prefs);
    assert.deepEqual(await storage.getSendPreferences(), prefs);
  });
});

// =============================================================================
// Pending Login (session storage)
// =============================================================================

describe('pendingLogin', () => {
  beforeEach(() => clearStores());

  it('returns null when none stored', async () => {
    assert.equal(await storage.getPendingLogin(), null);
  });

  it('round-trips pending login', async () => {
    const login = { secret: 'sec', userId: 'uid' };
    await storage.savePendingLogin(login);
    assert.deepEqual(await storage.getPendingLogin(), login);
  });

  it('clearPendingLogin removes it', async () => {
    await storage.savePendingLogin({ secret: 's' });
    await storage.clearPendingLogin();
    assert.equal(await storage.getPendingLogin(), null);
  });
});

// =============================================================================
// Pending Email (session storage)
// =============================================================================

describe('pendingEmail', () => {
  beforeEach(() => clearStores());

  it('returns empty string when none stored', async () => {
    assert.equal(await storage.getPendingEmail(), '');
  });

  it('round-trips email', async () => {
    await storage.savePendingEmail('test@example.com');
    assert.equal(await storage.getPendingEmail(), 'test@example.com');
  });

  it('clearPendingEmail removes it', async () => {
    await storage.savePendingEmail('test@example.com');
    await storage.clearPendingEmail();
    assert.equal(await storage.getPendingEmail(), '');
  });
});

// =============================================================================
// Error State
// =============================================================================

describe('errorState', () => {
  beforeEach(() => clearStores());

  it('getErrorState returns null when empty', async () => {
    assert.equal(await storage.getErrorState(), null);
  });

  it('setErrorState stores error with timestamp', async () => {
    const before = Date.now();
    await storage.setErrorState({ type: 'receive_auth', message: 'Session expired', recoverable: false });
    const state = await storage.getErrorState();

    assert.equal(state.type, 'receive_auth');
    assert.equal(state.message, 'Session expired');
    assert.equal(state.recoverable, false);
    assert(state.timestamp >= before);
  });

  it('setErrorState defaults recoverable to false', async () => {
    await storage.setErrorState({ type: 'send_auth', message: 'bad token' });
    const state = await storage.getErrorState();
    assert.equal(state.recoverable, false);
  });

  it('setErrorState with null clears the error', async () => {
    await storage.setErrorState({ type: 'receive_auth', message: 'err' });
    await storage.setErrorState(null);
    assert.equal(await storage.getErrorState(), null);
  });

  it('clearErrorState without prefix clears any error', async () => {
    await storage.setErrorState({ type: 'receive_auth', message: 'err' });
    await storage.clearErrorState();
    assert.equal(await storage.getErrorState(), null);
  });

  it('clearErrorState with matching prefix clears error', async () => {
    await storage.setErrorState({ type: 'receive_auth', message: 'err' });
    await storage.clearErrorState('receive');
    assert.equal(await storage.getErrorState(), null);
  });

  it('clearErrorState with non-matching prefix does NOT clear error', async () => {
    await storage.setErrorState({ type: 'receive_auth', message: 'err' });
    await storage.clearErrorState('send');
    const state = await storage.getErrorState();
    assert.equal(state.type, 'receive_auth');
  });

  it('clearErrorState with prefix when no error is a no-op', async () => {
    await storage.clearErrorState('receive');
    assert.equal(await storage.getErrorState(), null);
  });
});

// =============================================================================
// Scroll Position (expiry logic)
// =============================================================================

describe('scrollPosition', () => {
  beforeEach(() => clearStores());

  it('returns 0 when nothing stored', async () => {
    assert.equal(await storage.getScrollPosition(), 0);
  });

  it('returns stored position when fresh', async () => {
    await storage.saveScrollPosition(350);
    const pos = await storage.getScrollPosition();
    assert.equal(pos, 350);
  });

  it('returns 0 when position is expired (default 600s)', async () => {
    localStore.scrollPosition = { position: 200, timestamp: Date.now() - 601_000 };
    assert.equal(await storage.getScrollPosition(), 0);
  });

  it('returns position when within custom maxAge', async () => {
    localStore.scrollPosition = { position: 100, timestamp: Date.now() - 5_000 };
    assert.equal(await storage.getScrollPosition(10), 100);
  });

  it('returns 0 when exceeding custom maxAge', async () => {
    localStore.scrollPosition = { position: 100, timestamp: Date.now() - 15_000 };
    assert.equal(await storage.getScrollPosition(10), 0);
  });

  it('returns 0 when data has no position field', async () => {
    localStore.scrollPosition = { timestamp: Date.now() };
    assert.equal(await storage.getScrollPosition(), 0);
  });

  it('returns 0 when data has no timestamp (treated as ancient)', async () => {
    localStore.scrollPosition = { position: 100 };
    assert.equal(await storage.getScrollPosition(), 0);
  });
});

// =============================================================================
// Sounds Cache
// =============================================================================

describe('soundsCache', () => {
  beforeEach(() => clearStores());

  it('getCachedSounds returns null when nothing cached', async () => {
    assert.equal(await storage.getCachedSounds('tok123'), null);
  });

  it('saveCachedSounds + getCachedSounds round-trips', async () => {
    const sounds = { pushover: 'Pushover (default)', bike: 'Bike' };
    await storage.saveCachedSounds('tok123', sounds);
    assert.deepEqual(await storage.getCachedSounds('tok123'), sounds);
  });

  it('returns null when cached with a different token', async () => {
    await storage.saveCachedSounds('tok123', { pushover: 'Pushover' });
    assert.equal(await storage.getCachedSounds('tok456'), null);
  });

  it('returns null when cache is expired (>10 minutes)', async () => {
    localStore.soundsCache = {
      sounds: { pushover: 'Pushover' },
      token: 'tok123',
      timestamp: Date.now() - (11 * 60 * 1000)
    };
    assert.equal(await storage.getCachedSounds('tok123'), null);
  });

  it('returns sounds when cache is fresh (<10 minutes)', async () => {
    const sounds = { pushover: 'Pushover' };
    localStore.soundsCache = {
      sounds,
      token: 'tok123',
      timestamp: Date.now() - (5 * 60 * 1000)
    };
    assert.deepEqual(await storage.getCachedSounds('tok123'), sounds);
  });
});

// =============================================================================
// clearAll
// =============================================================================

describe('clearAll', () => {
  beforeEach(() => clearStores());

  it('clears both local and session storage', async () => {
    localStore.session = { secret: 's' };
    localStore.settings = { apiToken: 'tok' };
    sessionStore.pendingLogin = { secret: 's' };

    await storage.clearAll();

    assert.deepEqual(Object.keys(localStore), []);
    assert.deepEqual(Object.keys(sessionStore), []);
  });
});
