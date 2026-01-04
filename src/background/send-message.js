// Send message handling

import { setErrorState, clearErrorState } from '../lib/storage.js';
import { sendMessage, ERROR_TYPES } from '../lib/api.js';
import { Page, isPageOpen } from '../lib/navigation.js';
import { updateBadge } from './badge.js';
import { showToastNotification, showCriticalErrorNotification } from './notifications.js';

export async function handleSendMessage(params) {
  const result = await trySendMessage(params);
  await notifySendResult(result, params.device);
  return result;
}

async function trySendMessage(params) {
  try {
    console.debug('Sending message:', params.message);
    const result = await sendMessage(params);
    await clearErrorState('send');
    console.debug('Message sent, success:', result.success);
    return { success: true, ...result };
  } catch (error) {
    console.error('Send message failed:', error);
    await handleSendError(error);
    return { success: false, error: error.message, errorType: error.errorType };
  }
}

async function handleSendError(error) {
  switch (error.errorType) {
    case ERROR_TYPES.VALIDATION:
    case ERROR_TYPES.AUTH:
      await setErrorState({
        type: 'send_auth',
        message: 'Send credentials invalid. Check your API token and user key in Settings.',
        recoverable: false
      });
      await updateBadge();
      break;
  }
}

async function notifySendResult(result, device) {
  if (await isPageOpen(Page.SEND)) return;

  if (result.success) {
    showToastNotification('Message Sent', `Sent to ${device || 'all devices'}`);
    return;
  }

  switch (result.errorType) {
    case ERROR_TYPES.VALIDATION:
    case ERROR_TYPES.AUTH:
      showCriticalErrorNotification('send_auth', 'Unable to send messages. Your API credentials are invalid. Please check Settings.');
      break;
    case ERROR_TYPES.RATE_LIMIT:
      showToastNotification('Rate Limited', 'Message limit reached. Try again later.');
      break;
    default:
      showToastNotification('Send Failed', result.error || 'Failed to send message');
  }
}
