// Pushover Chrome Extension - IndexedDB Message Store
// Handles message storage using IndexedDB for better performance with large datasets

import { getSettings } from './settingsStore.js';

const DB_NAME = 'PushChromeDB';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';

let dbPromise = null;

// =============================================================================
// Database Initialization
// =============================================================================

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const store = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });

        store.createIndex('by_date', 'date');
        store.createIndex('by_seen', '_seen');
        store.createIndex('by_deletedAt', '_deletedAt');
        store.createIndex('by_priority', 'priority');
        store.createIndex('by_umid', 'umid', { unique: true });
      }
    };
  });

  return dbPromise;
}

async function getStore(mode = 'readonly') {
  const db = await openDatabase();
  const tx = db.transaction(MESSAGES_STORE, mode);
  return tx.objectStore(MESSAGES_STORE);
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// =============================================================================
// Message CRUD Operations
// =============================================================================

export async function getMessages() {
  const store = await getStore();
  const messages = await promisifyRequest(store.getAll());
  messages.sort((a, b) => b.date - a.date);
  return messages;
}

export async function getMessage(id) {
  const store = await getStore();
  return promisifyRequest(store.get(id));
}

export async function getVisibleMessages() {
  const messages = await getMessages();
  return messages.filter(m => !m._deletedAt);
}

export async function getVisibleMessagesPaginated(limit = 50, offset = 0) {
  const messages = await getMessages();
  const visible = messages.filter(m => !m._deletedAt);
  const paginated = visible.slice(offset, offset + limit);
  return {
    messages: paginated,
    total: visible.length,
    hasMore: offset + limit < visible.length
  };
}

export async function getVisibleMessagesCount() {
  const messages = await getMessages();
  return messages.filter(m => !m._deletedAt).length;
}

export async function searchMessages(searchTerm, limit = 50, offset = 0) {
  if (!searchTerm) return { messages: [], hasMore: false };
  
  const term = searchTerm.toLowerCase();
  const db = await openDatabase();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const store = tx.objectStore(MESSAGES_STORE);
  const index = store.index('by_date');
  
  return new Promise((resolve, reject) => {
    const results = [];
    let skipped = 0;
    let collected = 0;
    let hasMore = false;
    const request = index.openCursor(null, 'prev');
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const msg = cursor.value;
        if (!msg._deletedAt) {
          const title = (msg.title || '').toLowerCase();
          const body = (msg.message || '').toLowerCase();
          if (title.includes(term) || body.includes(term)) {
            if (skipped < offset) {
              skipped++;
            } else if (collected < limit) {
              results.push(msg);
              collected++;
            } else {
              hasMore = true;
              resolve({ messages: results, hasMore });
              return;
            }
          }
        }
        cursor.continue();
      } else {
        resolve({ messages: results, hasMore });
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

export async function saveMessages(messages) {
  const db = await openDatabase();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  const store = tx.objectStore(MESSAGES_STORE);

  await promisifyRequest(store.clear());

  for (const message of messages) {
    store.put(message);
  }

  await promisifyTransaction(tx);
}

export async function putMessage(message) {
  const store = await getStore('readwrite');
  await promisifyRequest(store.put(message));
}

export async function putMessages(messages) {
  const db = await openDatabase();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  const store = tx.objectStore(MESSAGES_STORE);

  for (const message of messages) {
    store.put(message);
  }

  await promisifyTransaction(tx);
}

export async function deleteMessage(id) {
  const store = await getStore('readwrite');
  await promisifyRequest(store.delete(id));
}

export async function softDeleteMessage(messageId) {
  const message = await getMessage(messageId);
  if (message) {
    message._deletedAt = Date.now();
    await putMessage(message);
  }
}

export async function clearMessages() {
  const store = await getStore('readwrite');
  await promisifyRequest(store.clear());
}

// =============================================================================
// Message Appending with Deduplication
// =============================================================================

function trimMessages(messages, maxMessages) {
  const unread = messages.filter(m => !m._seen && !m._deletedAt);
  const read = messages.filter(m => m._seen || m._deletedAt);

  let trimmedRead = [];
  if (maxMessages > 0) {
    const maxRead = Math.max(0, maxMessages - unread.length);
    trimmedRead = read.slice(0, maxRead);
  }

  const result = [...unread, ...trimmedRead];
  result.sort((a, b) => b.date - a.date);
  return result;
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
  const result = trimMessages(combined, settings.maxMessages);

  await saveMessages(result);
  return uniqueNew.length;
}

export async function applyMessageLimit() {
  const settings = await getSettings();
  const messages = await getMessages();

  if (messages.length === 0) return 0;

  const result = trimMessages(messages, settings.maxMessages);
  const removed = messages.length - result.length;

  if (removed > 0) {
    await saveMessages(result);
  }

  return removed;
}

// =============================================================================
// Read State Tracking
// =============================================================================

export async function getUnreadCount() {
  const messages = await getVisibleMessages();
  return messages.filter(m => !m._seen).length;
}

export async function markMessageRead(messageId) {
  const message = await getMessage(messageId);
  if (message && !message._seen) {
    message._seen = true;
    await putMessage(message);
  }
}

export async function markAllRead() {
  const settings = await getSettings();
  const messages = await getMessages();
  const updated = messages.map(m => m._seen ? m : { ...m, _seen: true });
  const trimmed = trimMessages(updated, settings.maxMessages);
  await saveMessages(trimmed);
}

// =============================================================================
// Cleanup Operations
// =============================================================================

export async function purgeDeletedMessages(olderThanMs = 24 * 60 * 60 * 1000) {
  const messages = await getMessages();
  const cutoff = Date.now() - olderThanMs;
  const filtered = messages.filter(m => !m._deletedAt || m._deletedAt > cutoff);

  if (filtered.length < messages.length) {
    await saveMessages(filtered);
  }

  return messages.length - filtered.length;
}

// =============================================================================
// Database Management
// =============================================================================

export async function closeDatabase() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

export async function deleteDatabase() {
  await closeDatabase();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
