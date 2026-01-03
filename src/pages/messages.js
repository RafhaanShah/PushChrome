// Pushover Chrome Extension - Messages Page

import * as storage from '../lib/storage.js';
import * as api from '../lib/api.js';
import { $, debounce, escapeHtml, formatRelativeTime, getPriorityClass, getPriorityLabel, linkifyText } from '../lib/utils.js';
import { Page, navigateTo, initWindowMode } from '../lib/navigation.js';
import { initHeader, ICONS } from '../lib/header.js';

let isRefreshing = false;
let settings = null;
let headerController = null;
let hadUnreadOnOpen = false;

const PAGE_SIZE = 50;
let loadedMessagesCount = 0;
let hasMoreMessages = true;
let isLoadingMore = false;

async function init() {
  console.info('Messages page initialized');
  await initWindowMode(Page.MESSAGES);

  headerController = initHeader({
    title: 'PushChrome',
    currentPage: Page.MESSAGES,
    pageActions: [
      { id: 'refresh-btn', icon: ICONS.refresh, title: 'Refresh messages', onClick: () => refreshMessages(false) },
      { id: 'mark-read-btn', icon: ICONS.markRead, title: 'Mark all as read', onClick: handleMarkAllRead, hidden: true },
    ],
  });

  setupEventListeners();
  setupMessageListener();
  await checkErrorState();
  await checkAuthAndLoadMessages();
}

function setupEventListeners() {
  $('#login-btn')?.addEventListener('click', () => navigateTo(Page.LOGIN));
  $('#retry-btn')?.addEventListener('click', () => refreshMessages(false));

  // Error banner actions
  $('#error-banner-action')?.addEventListener('click', handleErrorAction);
  $('#error-banner-dismiss')?.addEventListener('click', dismissErrorBanner);

  // Save scroll position on page unload/visibility change
  window.addEventListener('scroll', debounce(() => {
    storage.saveScrollPosition(window.scrollY);
    checkInfiniteScroll();
  }, 100));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      storage.saveScrollPosition(window.scrollY);
    }
  });

  window.addEventListener('beforeunload', () => {
    storage.saveScrollPosition(window.scrollY);
  });
}

function setupMessageListener() {
  // Listen for updates from service worker when new messages arrive
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'messagesUpdated') {
      console.debug('Received messagesUpdated event');
      // Reload and display messages, preserving scroll position
      loadAndDisplayMessages(true).then(() => {
        updateMarkReadButton();
      });
    }

    if (request.action === 'errorStateChanged') {
      console.debug('Received errorStateChanged event');
      checkErrorState();
    }
  });
}

async function checkAuthAndLoadMessages() {
  const loggedIn = await storage.isLoggedIn();

  if (!loggedIn) {
    showLoginPrompt();
    return;
  }

  settings = await storage.getSettings();

  // Check if there are unread messages before loading
  const unreadCount = await storage.getUnreadCount();
  hadUnreadOnOpen = unreadCount > 0;

  await loadAndDisplayMessages();

  // Restore scroll position only if no unread messages
  if (!hadUnreadOnOpen) {
    const savedPosition = await storage.getScrollPosition();
    if (savedPosition > 0) {
      requestAnimationFrame(() => {
        window.scrollTo(0, savedPosition);
        setTimeout(checkInfiniteScroll, 100);
      });
    }
  }

  // Show/hide mark as read button based on setting
  updateMarkReadButton();

  // Conditionally mark as read on open
  if (settings.markAsReadOnOpen) {
    await markMessagesAsRead();
    await updateBadge();
  }

  // Auto-refresh on popup open (debounced - only if last refresh > 1 min ago)
  await refreshMessages(true);
}

function showLoginPrompt() {
  $('#loading').classList.add('hidden');
  $('#messages-container').classList.add('hidden');
  $('#error-state').classList.add('hidden');
  $('#login-prompt').classList.remove('hidden');
}

function showError(message) {
  $('#loading').classList.add('hidden');
  $('#messages-container').classList.add('hidden');
  $('#login-prompt').classList.add('hidden');
  $('#error-state').classList.remove('hidden');
  $('#error-text').textContent = message;
}

function showMessages() {
  $('#loading').classList.add('hidden');
  $('#login-prompt').classList.add('hidden');
  $('#error-state').classList.add('hidden');
  $('#messages-container').classList.remove('hidden');
}

async function loadAndDisplayMessages(preserveScroll = false) {
  loadedMessagesCount = 0;
  hasMoreMessages = true;

  const totalCount = await storage.getVisibleMessagesCount();

  if (totalCount === 0) {
    showMessages();
    $('#message-list').classList.add('hidden');
    $('#empty-messages').classList.remove('hidden');
    return;
  }

  showMessages();
  $('#message-list').classList.remove('hidden');
  $('#empty-messages').classList.add('hidden');

  const container = $('#message-list');
  container.innerHTML = '';

  const existingIndicator = $('#load-more-indicator');
  if (existingIndicator) existingIndicator.remove();

  let initialLoadCount = PAGE_SIZE;

  if (!hadUnreadOnOpen) {
    const savedPosition = await storage.getScrollPosition();
    if (savedPosition > 0) {
      const estimatedRowHeight = 120;
      const estimatedMessagesNeeded = Math.ceil(savedPosition / estimatedRowHeight) + 10;
      initialLoadCount = Math.max(PAGE_SIZE, Math.ceil(estimatedMessagesNeeded / PAGE_SIZE) * PAGE_SIZE);
    }
  }

  await loadMoreMessages(initialLoadCount, !preserveScroll);
}

async function loadMoreMessages(count = PAGE_SIZE, isInitialLoad = false) {
  if (isLoadingMore || !hasMoreMessages) return;

  isLoadingMore = true;

  try {
    const result = await storage.getVisibleMessagesPaginated(count, loadedMessagesCount);

    if (result.messages.length === 0) {
      hasMoreMessages = false;
      return;
    }

    const container = $('#message-list');
    for (const msg of result.messages) {
      const messageEl = createMessageElement(msg, !msg._seen);
      container.appendChild(messageEl);
    }

    loadedMessagesCount += result.messages.length;
    hasMoreMessages = result.hasMore;

    updateLoadingIndicator();
  } finally {
    isLoadingMore = false;
  }
}

function checkInfiniteScroll() {
  if (isLoadingMore || !hasMoreMessages) return;

  const scrollY = window.scrollY;
  const windowHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;

  if (scrollY + windowHeight >= documentHeight - 300) {
    loadMoreMessages();
  }
}

function updateLoadingIndicator() {
  let indicator = $('#load-more-indicator');
  if (!hasMoreMessages && indicator) {
    indicator.remove();
  } else if (hasMoreMessages && !indicator) {
    indicator = document.createElement('div');
    indicator.id = 'load-more-indicator';
    indicator.className = 'load-more-indicator';
    indicator.innerHTML = '<div class="spinner spinner-small"></div>';
    $('#message-list').after(indicator);
  }
}

function createMessageElement(msg, isUnread) {
  const div = document.createElement('div');
  div.className = `message-item ${isUnread ? 'unread' : ''} ${getPriorityClass(msg.priority)}`;
  div.dataset.id = msg.id;

  const iconUrl = msg.icon ? api.getIconUrl(msg.icon) : null;
  const iconHtml = iconUrl
    ? `<img src="${escapeHtml(iconUrl)}" alt="" class="message-icon" loading="lazy">`
    : `<div class="message-icon message-icon-default">📨</div>`;

  const titleText = msg.title || msg.app || 'Notification';
  const messageBody = msg.html === 1 ? msg.message : linkifyText(msg.message);
  const timeText = formatRelativeTime(msg.date);
  const priorityBadge = msg.priority !== 0
    ? `<span class="priority-badge ${getPriorityClass(msg.priority)}">${getPriorityLabel(msg.priority)}</span>`
    : '';

  const urlHtml = msg.url
    ? `<a href="${escapeHtml(msg.url)}" class="message-link" target="_blank" rel="noopener">${escapeHtml(msg.url_title || 'Open Link')}</a>`
    : '';

  const emergencyHtml = msg.priority === 2 && msg.acked === 0 && msg.receipt
    ? `<button class="btn btn-ack" data-receipt="${escapeHtml(msg.receipt)}">Acknowledge</button>`
    : '';

  div.innerHTML = `
    <div class="message-header">
      ${iconHtml}
      <span class="message-app">${escapeHtml(msg.app || '')}</span>
      <div class="message-time-container">
        <div class="message-time" title="${new Date(msg.date * 1000).toLocaleString()}">${timeText}</div>
        ${isUnread ? '<div class="unread-indicator"></div>' : ''}
      </div>
      <button class="message-copy" title="Copy message">📋</button>
      <button class="message-delete" title="Delete message">🗑️</button>
    </div>
    <div class="message-title-row">
      <span class="message-title">${escapeHtml(titleText)}</span>
      ${priorityBadge}
    </div>
    <div class="message-body">${messageBody}</div>
    ${urlHtml}
    ${emergencyHtml}
  `;

  $('.message-copy', div).addEventListener('click', async () => {
    await copyMessage(msg, $('.message-copy', div));
  });

  $('.message-delete', div).addEventListener('click', async () => {
    await deleteMessage(msg.id, div);
  });

  if (emergencyHtml) {
    $('.btn-ack', div).addEventListener('click', async (e) => {
      await acknowledgeMessage(msg.receipt, msg.id, e.target);
    });
  }

  return div;
}

async function copyMessage(msg, button) {
  console.debug('Copy message clicked', { messageId: msg.id });
  try {
    await navigator.clipboard.writeText(msg.message);
    const originalText = button.textContent;
    button.textContent = '✅';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy:', err);
    showStatus('Failed to copy', true);
  }
}

async function deleteMessage(messageId, element) {
  console.debug('Delete message clicked', { messageId });
  element.style.opacity = '0.5';

  await storage.softDeleteMessage(messageId);

  element.remove();
  loadedMessagesCount--;

  const totalCount = await storage.getVisibleMessagesCount();
  if (totalCount === 0) {
    $('#message-list').classList.add('hidden');
    $('#empty-messages').classList.remove('hidden');
  } else {
    hasMoreMessages = loadedMessagesCount < totalCount;
    updateLoadingIndicator();
    checkInfiniteScroll();
  }
}

async function acknowledgeMessage(receipt, messageId, button) {
  console.debug('Acknowledge clicked', { messageId });
  button.disabled = true;
  button.textContent = 'Acknowledging...';

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'acknowledgeEmergency',
      receipt,
      messageId
    });

    if (result.success) {
      button.textContent = 'Acknowledged';
      button.classList.add('acknowledged');
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Acknowledge';
    showStatus('Failed to acknowledge', true);
  }
}

async function refreshMessages(checkDebounce = false) {
  if (isRefreshing) return;

  console.debug('Refresh button clicked');
  isRefreshing = true;
  setRefreshingState(true);

  try {
    // Delegate refresh to service worker
    const result = await chrome.runtime.sendMessage({
      action: 'refreshMessages',
      skipNotifications: true, // We're open, don't need notifications
      checkDebounce: checkDebounce
    });

    if (result.debounced) {
      // Debounced, nothing to do
      return;
    }

    if (result.error === 'not_logged_in') {
      showLoginPrompt();
      return;
    }

    if (result.error) {
      const messages = await storage.getMessages();
      if (messages.length === 0) {
        showError('Failed to load messages. Check your connection.');
      } else {
        showStatus('Refresh failed', true);
      }
      return;
    }

    // Reload display after refresh
    await loadAndDisplayMessages();
    updateMarkReadButton();

    if (settings.markAsReadOnOpen) {
      await markMessagesAsRead();
      await updateBadge();
    }

  } catch (err) {
    console.error('Refresh error:', err);
    showStatus('Refresh failed', true);
  } finally {
    isRefreshing = false;
    setRefreshingState(false);
  }
}

function setRefreshingState(refreshing) {
  const btn = headerController?.getButton('refresh-btn');
  if (!btn) return;

  const icon = $('.refresh-icon', btn);

  if (refreshing) {
    btn.disabled = true;
    icon?.classList.add('spinning');
  } else {
    btn.disabled = false;
    icon?.classList.remove('spinning');
  }
}

async function markMessagesAsRead() {
  await storage.markAllRead();

  // Clear notifications from OS tray since user has seen them
  try {
    await chrome.runtime.sendMessage({ action: 'clearNotifications' });
  } catch (e) {
    // Service worker may not be ready, ignore
  }

  // Re-render to remove unread indicators
  await loadAndDisplayMessages();
  updateMarkReadButton();
}

async function handleMarkAllRead() {
  console.debug('Mark all read clicked');
  await markMessagesAsRead();
  await updateBadge();
}

function updateMarkReadButton() {
  // Show if there are any unread messages
  storage.getUnreadCount().then(count => {
    if (count > 0) {
      headerController?.showButton('mark-read-btn');
    } else {
      headerController?.hideButton('mark-read-btn');
    }
  });
}

async function updateBadge() {
  const settings = await storage.getSettings();
  if (!settings.badgeEnabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const count = await storage.getUnreadCount();
  if (count > 0) {
    chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#E53935' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function showStatus(message, isError = false) {
  const statusBar = $('#status-bar');
  const statusText = $('#status-text');

  statusText.textContent = message;
  statusBar.classList.remove('hidden');
  statusBar.classList.toggle('error', isError);

  setTimeout(() => {
    statusBar.classList.add('hidden');
  }, 3000);
}

// =============================================================================
// Error State Handling
// =============================================================================

let currentErrorState = null;

async function checkErrorState() {
  const errorState = await storage.getErrorState();
  currentErrorState = errorState;

  const banner = $('#error-banner');
  const text = $('#error-banner-text');
  const actionBtn = $('#error-banner-action');

  if (errorState?.type && !errorState.recoverable) {
    // Show error banner
    text.textContent = errorState.message;

    // Configure action button based on error type
    if (errorState.type === 'receive_auth' || errorState.type === 'receive_device') {
      actionBtn.textContent = 'Re-login';
      actionBtn.classList.remove('hidden');
    } else if (errorState.type === 'send_auth') {
      actionBtn.textContent = 'Settings';
      actionBtn.classList.remove('hidden');
    } else {
      actionBtn.classList.add('hidden');
    }

    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

async function handleErrorAction() {
  console.debug('Error banner action clicked');
  if (!currentErrorState) return;

  if (currentErrorState.type === 'receive_auth' || currentErrorState.type === 'receive_device') {
    // Clear session and redirect to login
    await storage.clearSession();
    await storage.clearErrorState();
    navigateTo(Page.LOGIN);
  } else if (currentErrorState.type === 'send_auth') {
    navigateTo(Page.SETTINGS);
  }
}

async function dismissErrorBanner() {
  console.debug('Error banner dismissed');
  // Just hide the banner but keep the error state (user acknowledged it)
  $('#error-banner').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);
