// Context menu management for browser action and page contexts

import { getSession, getSettings, getDevices, markAllRead } from '../lib/storage.js';
import { Page, openPageInWindow } from '../lib/navigation.js';
import { updateBadge, showRefreshingBadge } from './badge.js';
import { showToastNotification, clearAllMessageNotifications } from './notifications.js';

let refreshMessagesCallback = null;
let refreshDevicesCallback = null;
let sendMessageCallback = null;

export function setContextMenuCallbacks({ onRefreshMessages, onRefreshDevices, onSendMessage }) {
  refreshMessagesCallback = onRefreshMessages;
  refreshDevicesCallback = onRefreshDevices;
  sendMessageCallback = onSendMessage;
}

export async function buildContextMenus() {
  await chrome.contextMenus.removeAll();

  const session = await getSession();
  const settings = await getSettings();
  const devices = await getDevices();

  // Browser action context menu items (right-click on extension icon)
  // Only show pop-out option if alwaysPopOut is not enabled
  if (!settings.alwaysPopOut) {
    chrome.contextMenus.create({
      id: 'pop-out',
      title: 'Pop-Out',
      contexts: ['action']
    });
  }
  
  if (session?.secret && session?.deviceId) {
    chrome.contextMenus.create({
      id: 'mark-all-read',
      title: 'Mark All as Read',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'refresh-messages',
      title: 'Refresh Messages',
      contexts: ['action']
    });
  }

  if (settings.apiToken && settings.userKey) {
    chrome.contextMenus.create({
      id: 'refresh-devices',
      title: 'Refresh Devices',
      contexts: ['action']
    });
  }

  chrome.contextMenus.create({
    id: 'open-settings',
    title: 'Settings',
    contexts: ['action']
  });

  // Only show send menus if send credentials are configured
  if (!settings.apiToken || !settings.userKey) {
    console.debug('Send context menus not created: missing send credentials');
    return;
  }

  // Parent menu for page URL
  chrome.contextMenus.create({
    id: 'send-page',
    title: 'Pushover',
    contexts: ['page']
  });

  // Parent menu for selected text
  chrome.contextMenus.create({
    id: 'send-selection',
    title: 'Send "%s" to Pushover',
    contexts: ['selection']
  });

  // Parent menu for links
  chrome.contextMenus.create({
    id: 'send-link',
    title: 'Send Link to Pushover',
    contexts: ['link']
  });

  // Parent menu for images
  chrome.contextMenus.create({
    id: 'send-image',
    title: 'Send Image to Pushover',
    contexts: ['image']
  });

  // Add device options under each parent
  for (const parent of ['send-page', 'send-selection', 'send-link', 'send-image']) {
    const contextsMap = { 'send-selection': ['selection'], 'send-link': ['link'], 'send-image': ['image'], 'send-page': ['page'] };
    const contexts = contextsMap[parent];

    chrome.contextMenus.create({
      id: `${parent}-all`,
      parentId: parent,
      title: 'All Devices',
      contexts
    });

    if (devices.length > 0) {
      chrome.contextMenus.create({
        id: `${parent}-separator`,
        parentId: parent,
        type: 'separator',
        contexts
      });

      for (const device of devices) {
        chrome.contextMenus.create({
          id: `${parent}-${device}`,
          parentId: parent,
          title: device,
          contexts
        });
      }
    }
  }

  console.debug(`Context menus created with ${devices.length} devices`);
}

export function setupContextMenuListener() {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const menuId = info.menuItemId;
    console.info('Context menu item clicked:', menuId);

    // Handle browser action context menu items
    if (menuId === 'refresh-messages') {
      console.debug('Manual message refresh triggered from context menu');
      await showRefreshingBadge();
      const result = refreshMessagesCallback ? await refreshMessagesCallback() : { error: 'No callback' };
      await updateBadge();
      if (result.error && result.error !== 'not_logged_in') {
        showToastNotification('Refresh Failed', result.error);
      }
      return;
    }

    if (menuId === 'refresh-devices') {
      console.debug('Manual device refresh triggered from context menu');
      await showRefreshingBadge();
      const result = refreshDevicesCallback ? await refreshDevicesCallback() : { success: false, error: 'No callback' };
      await updateBadge();
      if (!result.success) {
        showToastNotification('Refresh Failed', result.error || 'Unknown error');
      }
      return;
    }

    if (menuId === 'mark-all-read') {
      console.debug('Mark all as read triggered from context menu');
      await markAllRead();
      await clearAllMessageNotifications();
      await updateBadge();
      return;
    }

    if (menuId === 'pop-out') {
      console.debug('Pop-out triggered from context menu');
      openPageInWindow(Page.ROOT);
      return;
    }

    if (menuId === 'open-settings') {
      console.debug('Settings triggered from context menu');
      chrome.windows.create({ url: chrome.runtime.getURL('src/pages/settings.html'), type: 'popup' });
      return;
    }

    const settings = await getSettings();

    // Parse menu ID: "send-{type}-{device}"
    const match = String(menuId).match(/^send-(page|selection|link|image)-(.+)$/);
    if (!match) {
      console.warn('Unknown context menu item clicked:', menuId);
      return;
    }

    const [, type, device] = match;

    const params = {
      token: settings.apiToken,
      user: settings.userKey,
      device: device === 'all' ? undefined : device
    };

    switch (type) {
      case 'page':
        params.message = tab.title || info.pageUrl;
        params.url = info.pageUrl;
        params.urlTitle = info.pageUrl;
        break;
      case 'link':
        params.message = info.selectionText || 'Link';
        params.url = info.linkUrl;
        params.urlTitle = info.linkUrl;
        break;
      case 'image':
        params.message = 'Image';
        params.url = info.srcUrl;
        params.urlTitle = info.srcUrl;
        try {
          const response = await fetch(info.srcUrl);
          if (response.ok) {
            params.attachmentBuffer = await response.arrayBuffer();
            params.attachmentType = response.headers.get('Content-Type') || 'image/png';
          }
        } catch { }
        break;
      case 'selection':
        params.message = info.selectionText;
        break;
    }

    console.debug(`Sending message from context menu (type: ${type}, device: ${device})`);
    if (sendMessageCallback) {
      await sendMessageCallback(params);
    }
  });
}
