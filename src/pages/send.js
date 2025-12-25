// Pushover Chrome Extension - Send Message Page
import { getSettings, getDevices, getSendPreferences, saveSendPreferences } from '../lib/storage.js';
import { $ } from '../lib/utils.js';

const elements = {
  backBtn: null,
  credentialsWarning: null,
  form: null,
  message: null,
  messageCount: null,
  title: null,
  titleCount: null,
  device: null,
  refreshDevicesBtn: null,
  priority: null,
  url: null,
  urlCount: null,
  urlTitle: null,
  urlTitleCount: null,
  sound: null,
  errorMessage: null,
  successMessage: null,
  sendBtn: null
};

const LIMITS = {
  message: 1024,
  title: 250,
  url: 512,
  urlTitle: 100
};

let settings = null;

async function init() {
  elements.backBtn = $('#back-btn');
  elements.credentialsWarning = $('#credentials-warning');
  elements.form = $('#send-form');
  elements.message = $('#message');
  elements.messageCount = $('#message-count');
  elements.title = $('#title');
  elements.titleCount = $('#title-count');
  elements.device = $('#device');
  elements.refreshDevicesBtn = $('#refresh-devices-btn');
  elements.priority = $('#priority');
  elements.url = $('#url');
  elements.urlCount = $('#url-count');
  elements.urlTitle = $('#url-title');
  elements.urlTitleCount = $('#url-title-count');
  elements.sound = $('#sound');
  elements.errorMessage = $('#error-message');
  elements.successMessage = $('#success-message');
  elements.sendBtn = $('#send-btn');

  await loadSettings();
  await loadDevices();
  await loadSendPreferences();
  bindEvents();
}

async function loadSettings() {
  settings = await getSettings();

  if (!settings.apiToken || !settings.userKey) {
    elements.credentialsWarning.classList.remove('hidden');
  }
  
  validateForm();
}

async function loadDevices() {
  const devices = await getDevices();

  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device;
    option.textContent = device;
    elements.device.appendChild(option);
  });
}

async function loadSendPreferences() {
  const prefs = await getSendPreferences();
  
  if (prefs.device) {
    elements.device.value = prefs.device;
  }
  if (prefs.priority) {
    elements.priority.value = prefs.priority;
  }
  if (prefs.sound) {
    elements.sound.value = prefs.sound;
  }
}

function bindEvents() {
  elements.backBtn.addEventListener('click', handleBack);
  elements.message.addEventListener('input', handleInput);
  elements.title.addEventListener('input', handleInput);
  elements.url.addEventListener('input', handleInput);
  elements.urlTitle.addEventListener('input', handleInput);
  elements.refreshDevicesBtn.addEventListener('click', handleRefreshDevices);
  elements.form.addEventListener('submit', handleSubmit);
}

function handleBack() {
  window.location.href = '../popup/popup.html';
}

async function handleRefreshDevices() {
  const btn = elements.refreshDevicesBtn;
  
  if (btn.classList.contains('refreshing')) return;
  
  btn.classList.add('refreshing');
  btn.disabled = true;
  
  try {
    const result = await chrome.runtime.sendMessage({ action: 'refreshDevices' });
    
    if (result?.success && result.devices) {
      // Remember current selection
      const currentValue = elements.device.value;
      
      // Clear and repopulate device list
      elements.device.innerHTML = '<option value="">All devices</option>';
      result.devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device;
        option.textContent = device;
        elements.device.appendChild(option);
      });
      
      // Restore selection if still valid
      if (result.devices.includes(currentValue)) {
        elements.device.value = currentValue;
      }
    }
  } catch (error) {
    console.error('Failed to refresh devices:', error);
  } finally {
    btn.classList.remove('refreshing');
    btn.disabled = false;
  }
}

function handleInput() {
  updateCharCount(elements.message, elements.messageCount, LIMITS.message);
  updateCharCount(elements.title, elements.titleCount, LIMITS.title);
  updateCharCount(elements.url, elements.urlCount, LIMITS.url);
  updateCharCount(elements.urlTitle, elements.urlTitleCount, LIMITS.urlTitle);
  validateForm();
}

function updateCharCount(input, counter, limit) {
  const length = input.value.length;
  counter.textContent = length;

  if (length > limit) {
    counter.parentElement.classList.add('over-limit');
  } else {
    counter.parentElement.classList.remove('over-limit');
  }
}

function validateForm() {
  const hasCredentials = settings?.apiToken && settings?.userKey;
  const messageValid = elements.message.value.length > 0 && elements.message.value.length <= LIMITS.message;
  const titleValid = elements.title.value.length <= LIMITS.title;
  const urlValid = elements.url.value.length <= LIMITS.url;
  const urlTitleValid = elements.urlTitle.value.length <= LIMITS.urlTitle;

  const isValid = hasCredentials && messageValid && titleValid && urlValid && urlTitleValid;

  elements.sendBtn.disabled = !isValid;
}

async function handleSubmit(e) {
  e.preventDefault();

  const message = elements.message.value.trim();

  if (!message) {
    showError('Message is required.');
    return;
  }

  if (!settings.apiToken || !settings.userKey) {
    showError('Send credentials not configured. Please configure in Settings.');
    return;
  }

  hideMessages();
  setLoading(true);

  try {
    const params = {
      token: settings.apiToken,
      user: settings.userKey,
      message: message,
      title: elements.title.value.trim() || undefined,
      device: elements.device.value || undefined,
      priority: parseInt(elements.priority.value, 10),
      url: elements.url.value.trim() || undefined,
      urlTitle: elements.urlTitle.value.trim() || undefined,
      sound: elements.sound.value || undefined
    };

    // Delegate to service worker so send continues if popup closes
    const result = await chrome.runtime.sendMessage({ 
      action: 'sendMessage', 
      params 
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to send message');
    }

    await saveSendPreferences({
      device: elements.device.value,
      priority: elements.priority.value,
      sound: elements.sound.value
    });

    showSuccess();
    elements.message.value = '';
    elements.title.value = '';
    elements.url.value = '';
    elements.urlTitle.value = '';
    elements.messageCount.textContent = '0';
    handleInput(); // Re-validate form
  } catch (error) {
    showError(error.message || 'Failed to send message. Please try again.');
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  const textEl = elements.sendBtn.querySelector('.btn-text');
  const loadingEl = elements.sendBtn.querySelector('.btn-loading');

  if (isLoading) {
    elements.sendBtn.disabled = true;
    textEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');
  } else {
    textEl.classList.remove('hidden');
    loadingEl.classList.add('hidden');
    validateForm();
  }
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove('hidden');
  elements.successMessage.classList.add('hidden');
}

function showSuccess() {
  elements.successMessage.classList.remove('hidden');
  elements.errorMessage.classList.add('hidden');

  setTimeout(() => {
    elements.successMessage.classList.add('hidden');
  }, 3000);
}

function hideMessages() {
  elements.errorMessage.classList.add('hidden');
  elements.successMessage.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);
