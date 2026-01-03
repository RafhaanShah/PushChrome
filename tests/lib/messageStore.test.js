// Pushover Chrome Extension - MessageStore Unit Tests
// Run these tests in a browser context or with fake-indexeddb

import {
  getMessages,
  getMessage,
  getVisibleMessages,
  getVisibleMessagesPaginated,
  getVisibleMessagesCount,
  saveMessages,
  putMessage,
  putMessages,
  deleteMessage,
  softDeleteMessage,
  clearMessages,
  appendMessages,
  applyMessageLimit,
  getUnreadCount,
  markAllRead,
  purgeDeletedMessages,
  deleteDatabase
} from '../../src/lib/messageStore.js';

function createMessage(overrides = {}) {
  return {
    id: Math.floor(Math.random() * 1000000),
    umid: Math.floor(Math.random() * 1000000),
    message: 'Test message',
    app: 'TestApp',
    aid: 1,
    icon: 'test',
    date: Math.floor(Date.now() / 1000),
    priority: 0,
    _seen: false,
    ...overrides
  };
}

async function resetDatabase() {
  await deleteDatabase();
}

async function setMaxMessages(max) {
  await chrome.storage.local.set({ settings: { maxMessages: max } });
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await resetDatabase();
      await chrome.storage.local.clear();
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(`  ${error.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  return { passed, failed };
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// =============================================================================
// Basic CRUD Tests
// =============================================================================

test('getMessages returns empty array when no messages', async () => {
  const messages = await getMessages();
  assertDeepEqual(messages, []);
});

test('saveMessages stores messages', async () => {
  const msg1 = createMessage({ id: 1, date: 100 });
  const msg2 = createMessage({ id: 2, date: 200 });

  await saveMessages([msg1, msg2]);
  const messages = await getMessages();

  assertEqual(messages.length, 2);
});

test('getMessages returns messages sorted by date descending', async () => {
  const msg1 = createMessage({ id: 1, date: 100 });
  const msg2 = createMessage({ id: 2, date: 300 });
  const msg3 = createMessage({ id: 3, date: 200 });

  await saveMessages([msg1, msg2, msg3]);
  const messages = await getMessages();

  assertEqual(messages[0].id, 2);
  assertEqual(messages[1].id, 3);
  assertEqual(messages[2].id, 1);
});

test('getMessage retrieves single message by id', async () => {
  const msg = createMessage({ id: 42, message: 'Find me' });
  await saveMessages([msg]);

  const found = await getMessage(42);
  assertEqual(found.message, 'Find me');
});

test('getMessage returns undefined for non-existent id', async () => {
  const found = await getMessage(999);
  assertEqual(found, undefined);
});

test('putMessage adds new message', async () => {
  const msg = createMessage({ id: 1 });
  await putMessage(msg);

  const messages = await getMessages();
  assertEqual(messages.length, 1);
});

test('putMessage updates existing message', async () => {
  const msg = createMessage({ id: 1, message: 'Original' });
  await putMessage(msg);

  msg.message = 'Updated';
  await putMessage(msg);

  const found = await getMessage(1);
  assertEqual(found.message, 'Updated');
});

test('putMessages bulk inserts messages', async () => {
  const messages = [
    createMessage({ id: 1 }),
    createMessage({ id: 2 }),
    createMessage({ id: 3 })
  ];

  await putMessages(messages);
  const stored = await getMessages();
  assertEqual(stored.length, 3);
});

test('deleteMessage removes message', async () => {
  await saveMessages([
    createMessage({ id: 1 }),
    createMessage({ id: 2 })
  ]);

  await deleteMessage(1);
  const messages = await getMessages();

  assertEqual(messages.length, 1);
  assertEqual(messages[0].id, 2);
});

test('clearMessages removes all messages', async () => {
  await saveMessages([
    createMessage({ id: 1 }),
    createMessage({ id: 2 })
  ]);

  await clearMessages();
  const messages = await getMessages();

  assertEqual(messages.length, 0);
});

// =============================================================================
// Soft Delete Tests
// =============================================================================

test('softDeleteMessage sets _deletedAt timestamp', async () => {
  const msg = createMessage({ id: 1 });
  await saveMessages([msg]);

  await softDeleteMessage(1);

  const found = await getMessage(1);
  assert(found._deletedAt > 0, '_deletedAt should be set');
});

test('getVisibleMessages excludes soft-deleted messages', async () => {
  await saveMessages([
    createMessage({ id: 1 }),
    createMessage({ id: 2, _deletedAt: Date.now() })
  ]);

  const visible = await getVisibleMessages();
  assertEqual(visible.length, 1);
  assertEqual(visible[0].id, 1);
});

test('getVisibleMessagesCount returns count of non-deleted messages', async () => {
  await saveMessages([
    createMessage({ id: 1, date: 300 }),
    createMessage({ id: 2, date: 200, _deletedAt: Date.now() }),
    createMessage({ id: 3, date: 100 })
  ]);

  const count = await getVisibleMessagesCount();
  assertEqual(count, 2);
});

test('getVisibleMessagesPaginated returns first page', async () => {
  await saveMessages([
    createMessage({ id: 1, date: 100 }),
    createMessage({ id: 2, date: 200 }),
    createMessage({ id: 3, date: 300 })
  ]);

  const result = await getVisibleMessagesPaginated(2, 0);
  assertEqual(result.messages.length, 2);
  assertEqual(result.messages[0].id, 3);
  assertEqual(result.messages[1].id, 2);
  assertEqual(result.total, 3);
  assertEqual(result.hasMore, true);
});

test('getVisibleMessagesPaginated returns second page', async () => {
  await saveMessages([
    createMessage({ id: 1, date: 100 }),
    createMessage({ id: 2, date: 200 }),
    createMessage({ id: 3, date: 300 })
  ]);

  const result = await getVisibleMessagesPaginated(2, 2);
  assertEqual(result.messages.length, 1);
  assertEqual(result.messages[0].id, 1);
  assertEqual(result.hasMore, false);
});

test('getVisibleMessagesPaginated excludes soft-deleted', async () => {
  await saveMessages([
    createMessage({ id: 1, date: 100 }),
    createMessage({ id: 2, date: 200, _deletedAt: Date.now() }),
    createMessage({ id: 3, date: 300 })
  ]);

  const result = await getVisibleMessagesPaginated(10, 0);
  assertEqual(result.messages.length, 2);
  assertEqual(result.total, 2);
  assertEqual(result.hasMore, false);
});

// =============================================================================
// Append and Deduplication Tests
// =============================================================================

test('appendMessages adds new messages', async () => {
  await setMaxMessages(50);

  const count = await appendMessages([
    createMessage({ id: 1 }),
    createMessage({ id: 2 })
  ]);

  assertEqual(count, 2);
  const messages = await getMessages();
  assertEqual(messages.length, 2);
});

test('appendMessages skips duplicates', async () => {
  await setMaxMessages(50);
  await saveMessages([createMessage({ id: 1 })]);

  const count = await appendMessages([
    createMessage({ id: 1 }),
    createMessage({ id: 2 })
  ]);

  assertEqual(count, 1);
  const messages = await getMessages();
  assertEqual(messages.length, 2);
});

test('appendMessages marks new messages as unread', async () => {
  await setMaxMessages(50);

  await appendMessages([createMessage({ id: 1 })]);

  const msg = await getMessage(1);
  assertEqual(msg._seen, false);
});

test('appendMessages returns 0 for empty input', async () => {
  const count = await appendMessages([]);
  assertEqual(count, 0);
});

test('appendMessages returns 0 for null input', async () => {
  const count = await appendMessages(null);
  assertEqual(count, 0);
});

// =============================================================================
// Message Limit Tests
// =============================================================================

test('appendMessages trims read messages to fit limit', async () => {
  await setMaxMessages(3);

  await saveMessages([
    createMessage({ id: 1, date: 100, _seen: true }),
    createMessage({ id: 2, date: 200, _seen: true }),
    createMessage({ id: 3, date: 300, _seen: true })
  ]);

  await appendMessages([createMessage({ id: 4, date: 400 })]);

  const messages = await getMessages();
  assertEqual(messages.length, 3);
  assert(messages.some(m => m.id === 4), 'New message should exist');
});

test('appendMessages keeps all unread messages regardless of limit', async () => {
  await setMaxMessages(2);

  await appendMessages([
    createMessage({ id: 1, date: 100 }),
    createMessage({ id: 2, date: 200 }),
    createMessage({ id: 3, date: 300 })
  ]);

  const messages = await getMessages();
  assertEqual(messages.length, 3);
});

test('applyMessageLimit trims read messages', async () => {
  await setMaxMessages(2);

  await saveMessages([
    createMessage({ id: 1, date: 100, _seen: true }),
    createMessage({ id: 2, date: 200, _seen: true }),
    createMessage({ id: 3, date: 300, _seen: true })
  ]);

  const removed = await applyMessageLimit();
  assertEqual(removed, 1);

  const messages = await getMessages();
  assertEqual(messages.length, 2);
});

test('applyMessageLimit with maxMessages=0 removes all read', async () => {
  await setMaxMessages(0);

  await saveMessages([
    createMessage({ id: 1, _seen: true }),
    createMessage({ id: 2, _seen: false }),
    createMessage({ id: 3, _seen: true })
  ]);

  await applyMessageLimit();

  const messages = await getMessages();
  assertEqual(messages.length, 1);
  assertEqual(messages[0].id, 2);
});

// =============================================================================
// Read State Tests
// =============================================================================

test('getUnreadCount returns count of unseen visible messages', async () => {
  await saveMessages([
    createMessage({ id: 1, _seen: false }),
    createMessage({ id: 2, _seen: true }),
    createMessage({ id: 3, _seen: false }),
    createMessage({ id: 4, _seen: false, _deletedAt: Date.now() })
  ]);

  const count = await getUnreadCount();
  assertEqual(count, 2);
});

test('markAllRead sets _seen on all messages', async () => {
  await setMaxMessages(50);

  await saveMessages([
    createMessage({ id: 1, _seen: false }),
    createMessage({ id: 2, _seen: false })
  ]);

  await markAllRead();

  const messages = await getMessages();
  assert(messages.every(m => m._seen), 'All messages should be seen');
});

// =============================================================================
// Purge Tests
// =============================================================================

test('purgeDeletedMessages removes old soft-deleted messages', async () => {
  const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000);
  const recentTimestamp = Date.now() - (1 * 60 * 60 * 1000);

  await saveMessages([
    createMessage({ id: 1, _deletedAt: oldTimestamp }),
    createMessage({ id: 2, _deletedAt: recentTimestamp }),
    createMessage({ id: 3 })
  ]);

  const purged = await purgeDeletedMessages();
  assertEqual(purged, 1);

  const messages = await getMessages();
  assertEqual(messages.length, 2);
});

test('purgeDeletedMessages keeps non-deleted messages', async () => {
  await saveMessages([
    createMessage({ id: 1 }),
    createMessage({ id: 2 })
  ]);

  const purged = await purgeDeletedMessages();
  assertEqual(purged, 0);

  const messages = await getMessages();
  assertEqual(messages.length, 2);
});

// Export for running
export { runTests, tests };
