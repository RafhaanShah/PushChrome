// Notification management for push messages

import { getSettings, getVisibleMessages, getMessages, saveMessages, getSession } from '../lib/storage.js';
import { acknowledgeEmergency } from '../lib/api.js';
import { Page, openPageInWindow, openUrlInTab, createOffscreenDocument, closeOffscreenDocument } from '../lib/navigation.js';
import { getCachedIconUrl } from './icon-cache.js';
import { updateBadge } from './badge.js';

export async function showNotificationsForNewMessages(newCount) {
  const settings = await getSettings();

  if (!settings.notificationsEnabled) {
    return;
  }

  // Get the newest unseen messages
  const messages = await getVisibleMessages();
  const unseenMessages = messages.filter(m => !m._seen).slice(0, newCount);

  for (const message of unseenMessages) {
    await showNotification(message);
  }
}

async function showNotification(message) {
  // Lowest priority (-2): no notification at all, per Pushover spec
  if (message.priority <= -2) {
    return;
  }

  const notificationId = `pushover-msg-${message.id}`;
  const fallbackIcon = chrome.runtime.getURL('src/icons/icon-128.png');

  // Pre-cache icon for notification (ensures it's available offline too)
  const iconUrl = await getCachedIconUrl(message.icon) || fallbackIcon;

  const options = {
    type: 'basic',
    title: message.title || message.app || 'Pushover',
    message: message.message || '',
    iconUrl,
    priority: getPriorityForNotification(message.priority),
    // Low priority (-1): show notification but no sound/vibration
    silent: message.priority === -1,
    // Emergency priority (2): stay visible until user interacts
    requireInteraction: message.priority >= 2
  };

  const isEmergency = message.priority === 2 && message.acked === 0 && message.receipt;

  if (isEmergency) {
    // Emergency messages: Acknowledge, and Open URL if present
    options.buttons = message.url
      ? [{ title: 'Acknowledge' }, { title: 'Open URL' }]
      : [{ title: 'Acknowledge' }];
  } else if (message.url) {
    // Messages with URL: Copy and Open URL buttons
    options.buttons = [
      { title: 'Copy' },
      { title: 'Open URL' }
    ];
  } else {
    // Normal messages: just Copy button
    options.buttons = [{ title: 'Copy' }];
  }

  try {
    console.debug('Showing notification for message ID:', message.id);
    await chrome.notifications.create(notificationId, options);
  } catch (error) {
    // Fallback without custom icon if it fails
    options.iconUrl = fallbackIcon;
    await chrome.notifications.create(notificationId, options);
  }
}

function getPriorityForNotification(pushoverPriority) {
  // Chrome notification priority: -2 to 2
  // Pushover priority: -2 to 2
  // Map: -2,-1 → 0 (low), 0 → 1 (default), 1,2 → 2 (high)
  if (pushoverPriority <= -1) return 0;
  if (pushoverPriority === 0) return 1;
  return 2;
}

export async function markMessageAsReadFromNotification(notificationId) {
  const messageId = parseInt(notificationId.replace('pushover-msg-', ''), 10);

  // Get messages and mark this specific one as read
  const messages = await getMessages();
  const updated = messages.map(m =>
    m.id === messageId ? { ...m, _seen: true } : m
  );

  await saveMessages(updated);
  await updateBadge();
}

export async function handleAcknowledgeEmergency(receipt, messageId) {
  const session = await getSession();
  if (!session?.secret) {
    return { success: false, error: 'Not logged in' };
  }

  try {
    console.info('Acknowledging emergency with receipt:', receipt);
    await acknowledgeEmergency(session.secret, receipt);

    // Update message in storage to mark as acknowledged
    const messages = await getMessages();
    const updated = messages.map(m =>
      m.receipt === receipt ? { ...m, acked: 1 } : m
    );
    await saveMessages(updated);

    // Mark as read and clear notification if present
    if (messageId) {
      const notificationId = `pushover-msg-${messageId}`;
      await markMessageAsReadFromNotification(notificationId);
      chrome.notifications.clear(notificationId);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to acknowledge emergency:', error);
    return { success: false, error: error.message };
  }
}

export async function handleCopyToClipboard(text) {
  // Use offscreen document API for clipboard access in service worker
  console.info('Copying text to clipboard:', text);
  await createOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ action: 'copyToClipboard', text: text });
  console.info('Offscreen document copy result:', result?.success);
  await closeOffscreenDocument();
}

export async function clearAllMessageNotifications() {
  const notifications = await chrome.notifications.getAll();

  for (const notificationId of Object.keys(notifications)) {
    if (notificationId.startsWith('pushover-msg-')) {
      await chrome.notifications.clear(notificationId);
    }
  }
}

export function showToastNotification(title, message) {
  const notificationId = `pushover-toast-${Date.now()}`;

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
    title: title,
    message: message,
    priority: 0
  });

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    chrome.notifications.clear(notificationId);
  }, 5000);
}

export function showCriticalErrorNotification(type, message) {
  const notificationId = `pushover-error-${type}`;

  // Clear any existing error notification of this type first
  chrome.notifications.clear(notificationId);

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
    title: 'Pushover: Action Required',
    message: message,
    priority: 2,
    requireInteraction: true // Stay visible until dismissed
  });
}

// Set up notification click handlers
export function setupNotificationListeners() {
  // Handle notification clicks - always open the messages page
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (notificationId.startsWith('pushover-msg-')) {
      console.debug('Notification clicked:', notificationId);
      openPageInWindow(Page.MESSAGES);
      await markMessageAsReadFromNotification(notificationId);
      chrome.notifications.clear(notificationId);
    }
  });

  // Handle notification dismissal (user closes from OS tray)
  chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
    if (notificationId.startsWith('pushover-msg-') && byUser) {
      console.debug('Notification dismissed by user:', notificationId);
      await markMessageAsReadFromNotification(notificationId);
    }
  });

  // Handle notification button clicks
  chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith('pushover-msg-')) return;
    console.debug('Notification button clicked:', notificationId, ', Button index:', buttonIndex);

    const messageId = parseInt(notificationId.replace('pushover-msg-', ''), 10);
    const messages = await getVisibleMessages();
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const isEmergency = message.priority === 2 && message.acked === 0 && message.receipt;

    if (isEmergency) {
      // Button 0: Acknowledge, Button 1: Open URL (if present)
      if (buttonIndex === 0) {
        await handleAcknowledgeEmergency(message.receipt, message.id);
      } else if (buttonIndex === 1 && message.url) {
        openUrlInTab(message.url);
        await markMessageAsReadFromNotification(notificationId);
        chrome.notifications.clear(notificationId);
      }
    } else if (message.url) {
      // Button 0: Copy (url), Button 1: Open URL
      if (buttonIndex === 0) {
        await handleCopyToClipboard(message.url);
      } else if (buttonIndex === 1) {
        openUrlInTab(message.url);
      }
      await markMessageAsReadFromNotification(notificationId);
      chrome.notifications.clear(notificationId);
    } else {
      // Button 0: Copy (message)
      if (buttonIndex === 0) {
        await handleCopyToClipboard(message.message || '');
      }
      await markMessageAsReadFromNotification(notificationId);
      chrome.notifications.clear(notificationId);
    }
  });
}
