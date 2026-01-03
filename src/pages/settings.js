// Pushover Chrome Extension - Settings Page
import { getSession, getSettings, saveSettings, saveDevices, clearAll, applyMessageLimit } from '../lib/storage.js';
import { $ } from '../lib/utils.js';
import { Page, navigateTo, initWindowMode } from '../lib/navigation.js';
import { initHeader } from '../lib/header.js';

let isLoggedIn = false;

const elements = {
  deviceName: null,
  userId: null,
  logoutBtn: null,
  loginPrompt: null,
  loginBtn: null,
  apiToken: null,
  userKey: null,
  userKeyGroup: null,
  validateBtn: null,
  validateResult: null,
  receiveSettings: null,
  refreshInterval: null,
  deviceRefreshInterval: null,
  maxMessages: null,
  notificationsEnabled: null,
  badgeEnabled: null,
  markAsReadOnOpen: null,
  alwaysPopOut: null,
  saveBtn: null
};

async function init() {
  await initWindowMode(Page.SETTINGS);
  initHeader({
    title: 'Settings',
    currentPage: Page.SETTINGS,
  });
  elements.deviceName = $('#device-name');
  elements.userId = $('#user-id');
  elements.logoutBtn = $('#logout-btn');
  elements.loginPrompt = $('#login-prompt');
  elements.loginBtn = $('#login-btn');
  elements.apiToken = $('#api-token');
  elements.userKey = $('#user-key');
  elements.userKeyGroup = $('#user-key-group');
  elements.validateBtn = $('#validate-btn');
  elements.validateResult = $('#validate-result');
  elements.receiveSettings = $('#receive-settings');
  elements.refreshInterval = $('#refresh-interval');
  elements.deviceRefreshInterval = $('#device-refresh-interval');
  elements.maxMessages = $('#max-messages');
  elements.notificationsEnabled = $('#notifications-enabled');
  elements.badgeEnabled = $('#badge-enabled');
  elements.markAsReadOnOpen = $('#mark-as-read-on-open');
  elements.alwaysPopOut = $('#always-pop-out');
  elements.saveBtn = $('#save-btn');

  await loadAccountInfo();
  await loadSettings();
  bindEvents();
}

async function loadAccountInfo() {
  const session = await getSession();

  if (session?.userId) {
    isLoggedIn = true;
    elements.deviceName.textContent = session.deviceName || '-';
    elements.userId.textContent = session.userId || '-';
    elements.userKey.value = session.userId;
    elements.logoutBtn.classList.remove('hidden');
  } else {
    isLoggedIn = false;
    elements.userKeyGroup.classList.remove('hidden');
    elements.deviceName.textContent = '-';
    elements.userId.textContent = '-';
    elements.receiveSettings.classList.add('hidden');
    elements.loginPrompt.classList.remove('hidden');
  }
}

async function loadSettings() {
  const settings = await getSettings();

  elements.apiToken.value = settings.apiToken || '';
  elements.userKey.value = settings.userKey || elements.userKey.value || '';
  elements.refreshInterval.value = String(settings.refreshInterval);
  elements.deviceRefreshInterval.value = String(settings.deviceRefreshInterval);
  elements.maxMessages.value = String(settings.maxMessages);
  elements.notificationsEnabled.checked = settings.notificationsEnabled;
  elements.badgeEnabled.checked = settings.badgeEnabled;
  elements.markAsReadOnOpen.checked = settings.markAsReadOnOpen;
  elements.alwaysPopOut.checked = settings.alwaysPopOut;
}

function bindEvents() {
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.loginBtn.addEventListener('click', () => navigateTo(Page.LOGIN));
  elements.validateBtn.addEventListener('click', handleValidate);
  elements.saveBtn.addEventListener('click', handleSave);
}

async function handleLogout() {
  if (!confirm('Are you sure you want to logout? Your cached messages will be deleted.')) {
    return;
  }

  await clearAll();
  navigateTo(Page.LOGIN);
}

async function handleValidate() {
  const token = elements.apiToken.value.trim();
  const user = elements.userKey.value.trim();

  if (!token || !user) {
    showValidateResult('Please enter valid API token and User Key.', false);
    return;
  }

  setLoading(elements.validateBtn, true);
  hideValidateResult();

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'validateCredentials',
      apiToken: token,
      userKey: user
    });

    if (result.valid) {
      // Save credentials and devices when validation succeeds
      await saveSettings({
        apiToken: token,
        userKey: user
      });
      if (result.devices.length > 0) {
        await saveDevices(result.devices);
      }

      // Notify service worker to rebuild context menus with new devices
      chrome.runtime.sendMessage({ action: 'rebuildContextMenus' }).catch(() => { });

      const deviceList = result.devices.length > 0
        ? `Devices: ${result.devices.join(', ')}`
        : 'No devices found';
      showValidateResult(`Valid! ${deviceList}`, true);
    } else {
      showValidateResult('Invalid credentials. Please check your API token and user key.', false);
    }
  } catch (error) {
    showValidateResult('Validation failed: ' + (error.message || 'Unknown error'), false);
  } finally {
    setLoading(elements.validateBtn, false);
  }
}

async function handleSave() {
  setLoading(elements.saveBtn, true);

  try {
    const newSettings = {
      apiToken: elements.apiToken.value.trim(),
      userKey: elements.userKey.value.trim(),
      refreshInterval: parseInt(elements.refreshInterval.value, 10),
      deviceRefreshInterval: parseInt(elements.deviceRefreshInterval.value, 10),
      maxMessages: parseInt(elements.maxMessages.value, 10),
      notificationsEnabled: elements.notificationsEnabled.checked,
      badgeEnabled: elements.badgeEnabled.checked,
      markAsReadOnOpen: elements.markAsReadOnOpen.checked,
      alwaysPopOut: elements.alwaysPopOut.checked
    };

    await saveSettings(newSettings);

    // Apply message limit immediately
    await applyMessageLimit();

    // Update alarm interval if service worker is active
    try {
      await chrome.alarms.clear('refreshMessages');
      if (newSettings.refreshInterval > 0) {
        await chrome.alarms.create('refreshMessages', {
          periodInMinutes: newSettings.refreshInterval
        });
      }
    } catch (e) {
      console.error('Could not update alarm:', e);
    }

    // Kick off a device refresh
    chrome.runtime.sendMessage({ action: 'refreshDevices' }).catch(() => { });

    showSaveSuccess();
  } catch (error) {
    alert('Failed to save settings: ' + (error.message || 'Unknown error'));
    setLoading(elements.saveBtn, false);
  }
}

function setLoading(button, isLoading) {
  const textEl = button.querySelector('.btn-text');
  const loadingEl = button.querySelector('.btn-loading');

  if (isLoading) {
    button.disabled = true;
    textEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');
  } else {
    button.disabled = false;
    textEl.classList.remove('hidden');
    loadingEl.classList.add('hidden');
  }
}

function showValidateResult(message, isSuccess) {
  elements.validateResult.textContent = message;
  elements.validateResult.className = `validate-result ${isSuccess ? 'success' : 'error'}`;
  elements.validateResult.classList.remove('hidden');
}

function hideValidateResult() {
  elements.validateResult.classList.add('hidden');
}

function showSaveSuccess() {
  const textEl = elements.saveBtn.querySelector('.btn-text');
  const loadingEl = elements.saveBtn.querySelector('.btn-loading');
  const successEl = elements.saveBtn.querySelector('.btn-success');

  loadingEl.classList.add('hidden');
  textEl.classList.add('hidden');
  successEl.classList.remove('hidden');
  elements.saveBtn.classList.add('success');

  setTimeout(() => {
    successEl.classList.add('hidden');
    textEl.classList.remove('hidden');
    elements.saveBtn.classList.remove('success');
    elements.saveBtn.disabled = false;
  }, 2000);
}

document.addEventListener('DOMContentLoaded', init);
