// ESM loader hooks - intercepts imports that need browser APIs

const MOCK_MESSAGE_STORE = `
export async function getMessages() { return []; }
export async function getMessage() { return undefined; }
export async function getVisibleMessages() { return []; }
export async function getVisibleMessagesPaginated() { return { messages: [], total: 0, hasMore: false }; }
export async function getVisibleMessagesCount() { return 0; }
export async function searchMessages() { return { messages: [], hasMore: false }; }
export async function saveMessages() {}
export async function putMessage() {}
export async function putMessages() {}
export async function deleteMessage() {}
export async function softDeleteMessage() {}
export async function clearMessages() {}
export async function appendMessages() { return 0; }
export async function applyMessageLimit() { return 0; }
export async function getUnreadCount() { return 0; }
export async function markMessageRead() {}
export async function markAllRead() {}
export async function purgeDeletedMessages() { return 0; }
export async function closeDatabase() {}
export async function deleteDatabase() {}
`;

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/messageStore.js')) {
    return {
      url: 'data:text/javascript,' + encodeURIComponent(MOCK_MESSAGE_STORE),
      shortCircuit: true
    };
  }
  return next(specifier, context);
}
