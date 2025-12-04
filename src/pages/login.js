// Pushover Chrome Extension - Login Page
import { login, registerDevice } from '../lib/api.js';
import { saveSession, isLoggedIn, getPendingLogin, savePendingLogin, clearPendingLogin } from '../lib/storage.js';
import { generateDeviceName, $ } from '../lib/utils.js';

const elements = {
  form: null,
  credentialsSection: null,
  twofaSection: null,
  deviceSection: null,
  emailInput: null,
  passwordInput: null,
  twofaInput: null,
  deviceNameInput: null,
  loginBtn: null,
  verifyBtn: null,
  registerBtn: null,
  backBtn: null,
  deviceBackBtn: null,
  errorMessage: null
};

let pendingCredentials = null;
let pendingLoginResult = null;

function init() {
  elements.form = $('#login-form');
  elements.credentialsSection = $('#credentials-section');
  elements.twofaSection = $('#twofa-section');
  elements.deviceSection = $('#device-section');
  elements.emailInput = $('#email');
  elements.passwordInput = $('#password');
  elements.twofaInput = $('#twofa-code');
  elements.deviceNameInput = $('#device-name');
  elements.loginBtn = $('#login-btn');
  elements.verifyBtn = $('#verify-btn');
  elements.registerBtn = $('#register-btn');
  elements.backBtn = $('#back-btn');
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
  
  // Check for pending login (user closed popup after auth but before device registration)
  const pendingLogin = await getPendingLogin();
  if (pendingLogin) {
    pendingLoginResult = pendingLogin;
    showDeviceSection(pendingLogin);
  }
}

function bindEvents() {
  elements.form.addEventListener('submit', handleSubmit);
  elements.backBtn.addEventListener('click', handleBack);
  elements.deviceBackBtn.addEventListener('click', handleBack);
}

async function handleSubmit(e) {
  e.preventDefault();
  hideError();

  const isInDeviceMode = !elements.deviceSection.classList.contains('hidden');
  const isInTwofaMode = !elements.twofaSection.classList.contains('hidden');

  if (isInDeviceMode) {
    await handleDeviceSubmit();
  } else if (isInTwofaMode) {
    await handleTwofaSubmit();
  } else {
    await handleLoginSubmit();
  }
}

async function handleLoginSubmit() {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  if (!email || !password) {
    showError('Please enter your email and password.');
    return;
  }

  setLoading(elements.loginBtn, true);

  try {
    const result = await login(email, password);

    if (result.requires2FA) {
      pendingCredentials = { email, password };
      showTwofaSection();
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

async function handleTwofaSubmit() {
  const twofaCode = elements.twofaInput.value.trim();

  if (!twofaCode) {
    showError('Please enter your authentication code.');
    return;
  }

  if (!pendingCredentials) {
    showError('Session expired. Please try again.');
    handleBack();
    return;
  }

  setLoading(elements.verifyBtn, true);

  try {
    const result = await login(
      pendingCredentials.email,
      pendingCredentials.password,
      twofaCode
    );

    if (result.requires2FA) {
      showError('Invalid authentication code. Please try again.');
      elements.twofaInput.value = '';
      elements.twofaInput.focus();
    } else {
      await savePendingLogin(result);
      showDeviceSection(result);
    }
  } catch (error) {
    showError(error.message || 'Verification failed. Please try again.');
  } finally {
    setLoading(elements.verifyBtn, false);
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
    pendingCredentials = null;
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
  pendingLoginResult = loginResult;
  elements.credentialsSection.classList.add('hidden');
  elements.twofaSection.classList.add('hidden');
  elements.deviceSection.classList.remove('hidden');
  elements.deviceNameInput.value = generateDeviceName();
  elements.deviceNameInput.focus();
  elements.deviceNameInput.select();
}

function showTwofaSection() {
  elements.credentialsSection.classList.add('hidden');
  elements.twofaSection.classList.remove('hidden');
  elements.twofaInput.value = '';
  elements.twofaInput.focus();
}

async function handleBack() {
  await clearPendingLogin();
  pendingCredentials = null;
  pendingLoginResult = null;
  elements.twofaSection.classList.add('hidden');
  elements.deviceSection.classList.add('hidden');
  elements.credentialsSection.classList.remove('hidden');
  elements.twofaInput.value = '';
  elements.deviceNameInput.value = '';
  elements.passwordInput.value = '';
  elements.emailInput.focus();
  hideError();
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
  window.location.href = 'settings.html';
}

document.addEventListener('DOMContentLoaded', init);
