// Pushover Chrome Extension - Shared Utilities

// =============================================================================
// Time Formatting
// =============================================================================

export function formatRelativeTime(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const seconds = now - timestamp;

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString();
}

export function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

// =============================================================================
// HTML Sanitization
// =============================================================================

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, char => HTML_ENTITIES[char]);
}

// =============================================================================
// Device Name Generation
// =============================================================================

export function generateDeviceName() {
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `chrome-ext-${randomPart}`;
}

// =============================================================================
// Text Utilities
// =============================================================================

export function truncate(str, maxLength, suffix = '...') {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

// =============================================================================
// Priority Helpers
// =============================================================================

export const PRIORITY_LABELS = {
  '-2': 'Lowest',
  '-1': 'Low',
  '0': 'Normal',
  '1': 'High',
  '2': 'Emergency'
};

export const PRIORITY_CLASSES = {
  '-2': 'priority-lowest',
  '-1': 'priority-low',
  '0': 'priority-normal',
  '1': 'priority-high',
  '2': 'priority-emergency'
};

export function getPriorityLabel(priority) {
  return PRIORITY_LABELS[String(priority)] || 'Normal';
}

export function getPriorityClass(priority) {
  return PRIORITY_CLASSES[String(priority)] || 'priority-normal';
}

// =============================================================================
// URL Helpers
// =============================================================================

export function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;

export function linkifyText(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(URL_REGEX, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

// =============================================================================
// DOM Helpers
// =============================================================================

export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

export function $$(selector, parent = document) {
  return parent.querySelectorAll(selector);
}

export function isPopupMode() {
  return window.innerWidth < 1000 && window.innerHeight < 1000;
}

export function getPopupUrl() {
  return chrome.runtime.getURL('src/popup/popup.html');
}

export function openInTab() {
  chrome.tabs.create({ url: getPopupUrl() });
  window.close();
}

export function createElement(tag, attributes = {}, children = []) {
  const el = document.createElement(tag);
  
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'textContent') {
      el.textContent = value;
    } else if (key === 'innerHTML') {
      el.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.substring(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }
  
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }
  
  return el;
}
