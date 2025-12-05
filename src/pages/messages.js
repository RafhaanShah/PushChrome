// Pushover Chrome Extension - Messages Page

import * as storage from '../lib/storage.js';
import * as api from '../lib/api.js';
import { $, escapeHtml, formatRelativeTime, getPriorityClass, getPriorityLabel, linkifyText } from '../lib/utils.js';

const DEBOUNCE_INTERVAL_MS = 60000;
const LAST_REFRESH_KEY = 'lastRefreshTimestamp';

let isRefreshing = false;
let abortController = null;

async function init() {
  setupEventListeners();
  await checkAuthAndLoadMessages();
}

function setupEventListeners() {
  $('#settings-btn').addEventListener('click', () => {
    window.location.href = 'settings.html';
  });

  $('#send-btn').addEventListener('click', () => {
    window.location.href = 'send.html';
  });

  $('#refresh-btn').addEventListener('click', () => refreshMessages(true));
  $('#login-btn')?.addEventListener('click', () => {
    window.location.href = 'login.html';
  });
  $('#retry-btn')?.addEventListener('click', () => refreshMessages(true));
}

async function checkAuthAndLoadMessages() {
  const loggedIn = await storage.isLoggedIn();

  if (!loggedIn) {
    showLoginPrompt();
    return;
  }

  await loadAndDisplayMessages();
  await refreshMessagesWithDebounce();
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

async function loadAndDisplayMessages() {
  const messages = await storage.getVisibleMessages();

  if (messages.length === 0) {
    showMessages();
    $('#message-list').classList.add('hidden');
    $('#empty-messages').classList.remove('hidden');
    return;
  }

  showMessages();
  $('#message-list').classList.remove('hidden');
  $('#empty-messages').classList.add('hidden');

  renderMessageList(messages);
}

function renderMessageList(messages) {
  const container = $('#message-list');
  container.innerHTML = '';

  for (const msg of messages) {
    const messageEl = createMessageElement(msg, !msg._seen);
    container.appendChild(messageEl);
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
      <button class="message-delete" title="Delete message">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
          <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
        </svg>
      </button>
    </div>
    <div class="message-title-row">
      <span class="message-title">${escapeHtml(titleText)}</span>
      ${priorityBadge}
    </div>
    <div class="message-body">${messageBody}</div>
    ${urlHtml}
    ${emergencyHtml}
  `;

  div.querySelector('.message-delete').addEventListener('click', async () => {
    await deleteMessage(msg.id, div);
  });

  if (emergencyHtml) {
    div.querySelector('.btn-ack').addEventListener('click', async (e) => {
      await acknowledgeMessage(msg.receipt, e.target);
    });
  }

  return div;
}

async function deleteMessage(messageId, element) {
  element.style.opacity = '0.5';
  
  await storage.softDeleteMessage(messageId);
  
  element.remove();
  
  const visible = await storage.getVisibleMessages();
  if (visible.length === 0) {
    $('#message-list').classList.add('hidden');
    $('#empty-messages').classList.remove('hidden');
  }
}

async function acknowledgeMessage(receipt, button) {
  const session = await storage.getSession();
  if (!session) return;

  button.disabled = true;
  button.textContent = 'Acknowledging...';

  try {
    await api.acknowledgeEmergency(session.secret, receipt);
    button.textContent = 'Acknowledged';
    button.classList.add('acknowledged');

    const messages = await storage.getMessages();
    const updated = messages.map(m => 
      m.receipt === receipt ? { ...m, acked: 1 } : m
    );
    await storage.saveMessages(updated);
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Acknowledge';
    showStatus('Failed to acknowledge', true);
  }
}

async function refreshMessagesWithDebounce() {
  const lastRefresh = await getLastRefreshTime();
  const now = Date.now();

  if (lastRefresh && (now - lastRefresh) < DEBOUNCE_INTERVAL_MS) {
    return;
  }

  await refreshMessages(false);
}

async function getLastRefreshTime() {
  const result = await chrome.storage.session.get(LAST_REFRESH_KEY);
  return result[LAST_REFRESH_KEY] || null;
}

async function setLastRefreshTime() {
  await chrome.storage.session.set({ [LAST_REFRESH_KEY]: Date.now() });
}

async function refreshMessages(force = false) {
  if (isRefreshing) return;

  if (!force) {
    const lastRefresh = await getLastRefreshTime();
    const now = Date.now();
    if (lastRefresh && (now - lastRefresh) < DEBOUNCE_INTERVAL_MS) {
      return;
    }
  }

  isRefreshing = true;
  abortController = new AbortController();
  setRefreshingState(true);

  try {
    const session = await storage.getSession();
    if (!session?.secret || !session?.deviceId) {
      showLoginPrompt();
      return;
    }

    const signal = abortController.signal;
    const serverMessages = await api.fetchMessages(session.secret, session.deviceId, signal);

    if (serverMessages.length > 0) {
      await storage.appendMessages(serverMessages);

      const highestId = Math.max(...serverMessages.map(m => m.id));
      await api.deleteMessages(session.secret, session.deviceId, highestId, signal);
    }

    await setLastRefreshTime();
    await loadAndDisplayMessages();
    await markMessagesAsRead();
    await updateBadge();

  } catch (err) {
    if (err.name === 'AbortError') {
      return;
    }

    console.error('Refresh error:', err);

    if (err.status === 401 || (err.errors && err.errors.includes('invalid secret'))) {
      await storage.clearSession();
      showLoginPrompt();
      return;
    }

    const messages = await storage.getMessages();
    if (messages.length === 0) {
      showError('Failed to load messages. Check your connection.');
    } else {
      showStatus('Refresh failed', true);
    }
  } finally {
    isRefreshing = false;
    abortController = null;
    setRefreshingState(false);
  }
}

function setRefreshingState(refreshing) {
  const btn = $('#refresh-btn');
  const icon = btn.querySelector('.refresh-icon');

  if (refreshing) {
    btn.disabled = true;
    icon.classList.add('spinning');
  } else {
    btn.disabled = false;
    icon.classList.remove('spinning');
  }
}

async function markMessagesAsRead() {
  await storage.markAllRead();
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

document.addEventListener('DOMContentLoaded', init);
