// Pushover Chrome Extension - Login Page
import { login, registerDevice } from '../lib/api.js';
import { saveSession, isLoggedIn, getPendingLogin, savePendingLogin, clearPendingLogin, getPendingEmail, savePendingEmail, clearPendingEmail } from '../lib/storage.js';
import { generateDeviceName, $ } from '../lib/utils.js';
import { Page, navigateTo, initWindowMode } from '../lib/navigation.js';
import { initTheme } from '../lib/theme.js';

const elements = {
  form: null,
  credentialsSection: null,
  deviceSection: null,
  emailInput: null,
  passwordInput: null,
  twofaInput: null,
  deviceNameInput: null,
  loginBtn: null,
  registerBtn: null,
  deviceBackBtn: null,
  errorMessage: null
};

let pendingLoginResult = null;

async function init() {
  console.info('Login page initialized');
  await initTheme();
  await initWindowMode(Page.LOGIN, true);
  elements.form = $('#login-form');
  elements.credentialsSection = $('#credentials-section');
  elements.deviceSection = $('#device-section');
  elements.emailInput = $('#email');
  elements.passwordInput = $('#password');
  elements.twofaInput = $('#twofa-code');
  elements.deviceNameInput = $('#device-name');
  elements.loginBtn = $('#login-btn');
  elements.registerBtn = $('#register-btn');
  elements.deviceBackBtn = $('#device-back-btn');
  elements.errorMessage = $('#error-message');

  checkExistingSession();
  bindEvents();
}

async function checkExistingSession() {
  if (await isLoggedIn()) {
    redirectToSettings();
    return;
  }
  
  // Restore pending email if user closed popup mid-login
  const pendingEmail = await getPendingEmail();
  if (pendingEmail) {
    elements.emailInput.value = pendingEmail;
  }
  
  // Check for pending login (user closed popup after auth but before device registration)
  const pendingLogin = await getPendingLogin();
  if (pendingLogin) {
    pendingLoginResult = pendingLogin;
    showDeviceSection(pendingLogin);
  }
}

function bindEvents() {
  elements.form.addEventListener('submit', handleSubmit);
  elements.deviceBackBtn.addEventListener('click', handleDeviceBack);
  elements.emailInput.addEventListener('input', () => {
    savePendingEmail(elements.emailInput.value.trim());
  });
}

async function handleSubmit(e) {
  e.preventDefault();
  hideError();

  const isInDeviceMode = !elements.deviceSection.classList.contains('hidden');
  console.debug('Form submitted', { mode: isInDeviceMode ? 'device' : 'login' });

  if (isInDeviceMode) {
    await handleDeviceSubmit();
  } else {
    await handleLoginSubmit();
  }
}

async function handleLoginSubmit() {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;
  const twofaCode = elements.twofaInput.value.trim() || null;

  if (!email || !password) {
    showError('Please enter your email and password.');
    return;
  }

  setLoading(elements.loginBtn, true);

  try {
    const result = await login(email, password, twofaCode);

    if (result.requires2FA) {
      showError('Two-factor authentication is enabled. Please enter your 2FA code.');
      elements.twofaInput.focus();
    } else {
      await savePendingLogin(result);
      showDeviceSection(result);
    }
  } catch (error) {
    showError(error.message || 'Login failed. Please check your credentials.');
  } finally {
    setLoading(elements.loginBtn, false);
  }
}

async function handleDeviceSubmit() {
  let deviceName = elements.deviceNameInput.value.trim();

  if (!deviceName) {
    deviceName = generateDeviceName();
  }

  if (!/^[A-Za-z0-9_-]+$/.test(deviceName)) {
    showError('Device name can only contain letters, numbers, dashes, and underscores.');
    return;
  }

  if (deviceName.length > 25) {
    showError('Device name must be 25 characters or less.');
    return;
  }

  if (!pendingLoginResult) {
    showError('Session expired. Please try again.');
    handleBack();
    return;
  }

  setLoading(elements.registerBtn, true);

  try {
    const deviceId = await registerDevice(pendingLoginResult.secret, deviceName);

    await saveSession({
      secret: pendingLoginResult.secret,
      userId: pendingLoginResult.userId,
      deviceId: deviceId,
      deviceName: deviceName
    });

    await clearPendingLogin();
    await clearPendingEmail();
    pendingLoginResult = null;
    redirectToSettings();
  } catch (error) {
    const errorMsg = error.message || 'Unknown error';
    if (errorMsg.toLowerCase().includes('already been taken') || errorMsg.toLowerCase().includes('already in use')) {
      showErrorHtml(`
        Device name "<strong>${deviceName}</strong>" is already in use.<br>
        <a href="https://pushover.net/devices/edit/${encodeURIComponent(deviceName)}" target="_blank" rel="noopener">
          Delete it on Pushover.net
        </a> to re-use this name, or choose a different name.
      `);
    } else {
      showError('Failed to register device: ' + errorMsg);
    }
  } finally {
    setLoading(elements.registerBtn, false);
  }
}

function showDeviceSection(loginResult) {
  console.debug('Transitioning to device section');
  pendingLoginResult = loginResult;
  elements.credentialsSection.classList.add('hidden');
  elements.deviceSection.classList.remove('hidden');
  elements.deviceNameInput.value = generateDeviceName();
  elements.deviceNameInput.focus();
  elements.deviceNameInput.select();
}

async function handleDeviceBack() {
  console.debug('Back button clicked');
  await clearPendingLogin();
  pendingLoginResult = null;
  elements.deviceSection.classList.add('hidden');
  elements.credentialsSection.classList.remove('hidden');
  elements.deviceNameInput.value = '';
  elements.passwordInput.value = '';
  elements.twofaInput.value = '';
  elements.emailInput.focus();
  hideError();
}

function setLoading(button, isLoading) {
  const textEl = $('.btn-text', button);
  const loadingEl = $('.btn-loading', button);

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

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove('hidden');
}

function showErrorHtml(html) {
  elements.errorMessage.innerHTML = html;
  elements.errorMessage.classList.remove('hidden');
}

function hideError() {
  elements.errorMessage.textContent = '';
  elements.errorMessage.classList.add('hidden');
}

function redirectToSettings() {
  navigateTo(Page.SETTINGS);
}

document.addEventListener('DOMContentLoaded', init);
