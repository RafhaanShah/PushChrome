// Badge management for extension icon

import { getUnreadCount, getErrorState, getSettings } from '../lib/storage.js';

export async function showRefreshingBadge() {
  await chrome.action.setBadgeText({ text: '↻' });
  await chrome.action.setBadgeBackgroundColor({ color: '#2196F3' }); // Blue for refreshing
}

export async function updateBadge() {
  const settings = await getSettings();

  if (!settings.badgeEnabled) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  // Check for non-recoverable errors that require user action (auth/device issues)
  // Transient errors (network, server) don't show warning badge - we'll retry automatically
  const errorState = await getErrorState();
  if (errorState?.type && !errorState.recoverable) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF9800' }); // Orange for warning
    return;
  }

  const unreadCount = await getUnreadCount();

  if (unreadCount > 0) {
    await chrome.action.setBadgeText({
      text: unreadCount > 99 ? '99+' : String(unreadCount)
    });
    await chrome.action.setBadgeBackgroundColor({ color: '#E53935' }); // Red for unread
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}
