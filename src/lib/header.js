// Common header component for all pages
import { $ } from './utils.js';
import { Page, navigateTo, isPopupMode, openPageInWindow } from './navigation.js';

const ICONS = {
  messages: '📬',
  send: '📤',
  settings: '⚙️',
  refresh: '<span class="icon-refresh">🔄</span>',
  popout: '↗️',
  markRead: '📭',
};

/**
 * Initialize the page header
 * @param {Object} options - Configuration options
 * @param {string} options.title - Page title
 * @param {string} options.currentPage - Current page identifier (from Page enum)
 * @param {Array} [options.pageActions] - Page-specific action buttons [{id, icon, title, onClick, hidden}]
 * @returns {Object} - Header controller with methods to update page action buttons
 */
function initHeader(options) {
  const {
    title,
    currentPage,
    pageActions = [],
  } = options;

  const header = $('.header');
  if (!header) return null;

  // Clear existing content
  header.innerHTML = '';

  // Create header left section (title + page actions)
  const headerLeft = document.createElement('div');
  headerLeft.className = 'header-left';

  const h1 = document.createElement('h1');
  h1.textContent = title;
  headerLeft.appendChild(h1);

  header.appendChild(headerLeft);

  // Create header actions section (nav buttons)
  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';

  // Add page-specific action buttons first (on the left of nav buttons)
  const pageActionButtons = {};
  for (const action of pageActions) {
    const btn = createIconButton(action.id, action.icon, action.title);
    if (action.hidden) btn.classList.add('hidden');
    if (action.onClick) btn.addEventListener('click', action.onClick);
    headerActions.appendChild(btn);
    pageActionButtons[action.id] = btn;
  }

  // Popout button (only shown in popup mode)
  if (isPopupMode()) {
    const popoutBtn = createIconButton('popout-btn', ICONS.popout, 'Open in new window');
    popoutBtn.addEventListener('click', () => openPageInWindow(currentPage));
    headerActions.appendChild(popoutBtn);
  }

  // Messages button (hidden on messages page)
  if (currentPage !== Page.MESSAGES) {
    const messagesBtn = createIconButton('nav-messages-btn', ICONS.messages, 'Messages');
    messagesBtn.addEventListener('click', () => navigateTo(Page.MESSAGES));
    headerActions.appendChild(messagesBtn);
  }

  // Send button (hidden on send page)
  if (currentPage !== Page.SEND) {
    const sendBtn = createIconButton('nav-send-btn', ICONS.send, 'Send message');
    sendBtn.addEventListener('click', () => navigateTo(Page.SEND));
    headerActions.appendChild(sendBtn);
  }

  // Settings button (hidden on settings page)
  if (currentPage !== Page.SETTINGS) {
    const settingsBtn = createIconButton('nav-settings-btn', ICONS.settings, 'Settings');
    settingsBtn.addEventListener('click', () => navigateTo(Page.SETTINGS));
    headerActions.appendChild(settingsBtn);
  }

  header.appendChild(headerActions);

  // Return controller object for page-specific actions only
  return {
    getButton: (id) => pageActionButtons[id] || header.querySelector(`#${id}`),
    showButton: (id) => pageActionButtons[id]?.classList.remove('hidden'),
    hideButton: (id) => pageActionButtons[id]?.classList.add('hidden'),
  };
}

function createIconButton(id, iconHtml, title) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'icon-btn';
  btn.title = title;
  btn.innerHTML = iconHtml;
  return btn;
}

export { initHeader, ICONS, isPopupMode, openPageInWindow, Page };
