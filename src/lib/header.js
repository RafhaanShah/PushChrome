// Common header component for all pages
import { $ } from './utils.js';
import { Page, navigateTo, isPopupMode, openPageInWindow } from './navigation.js';

const ICONS = {
  messages: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.708 2.825L15 11.105V5.383Zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741ZM1 11.105l4.708-2.897L1 5.383v5.722Z"/>
  </svg>`,
  send: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083l6-15Zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471-.47 1.178Z"/>
  </svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.892 3.434-.901 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.892-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
  </svg>`,
  refresh: `<svg class="refresh-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
  </svg>`,
  popout: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
    <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
  </svg>`,
  markRead: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8.47 1.318a1 1 0 0 0-.94 0l-6 3.2A1 1 0 0 0 1 5.4v.817l5.75 3.45L8 8.917l1.25.75L15 6.217V5.4a1 1 0 0 0-.53-.882l-6-3.2ZM15 7.383l-4.778 2.867L15 13.117V7.383Zm-.035 6.88L8 10.082l-6.965 4.18A1 1 0 0 0 2 15h12a1 1 0 0 0 .965-.738ZM1 13.116l4.778-2.867L1 7.383v5.734ZM7.059.435a2 2 0 0 1 1.882 0l6 3.2A2 2 0 0 1 16 5.4V14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V5.4a2 2 0 0 1 1.059-1.765l6-3.2Z"/>
  </svg>`,
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
