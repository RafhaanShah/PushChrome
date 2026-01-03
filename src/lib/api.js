// Pushover Chrome Extension - API Wrapper
// Handles all communication with Pushover API

const API_BASE = 'https://api.pushover.net/1';

// Error types for classification
export const ERROR_TYPES = {
  AUTH: 'auth',           // Invalid secret/credentials
  DEVICE: 'device',       // Device deleted/invalid
  VALIDATION: 'validation', // Invalid token/user key for sending
  RATE_LIMIT: 'rate_limit', // Rate limited (429)
  SERVER: 'server',       // Temporary server error (5xx)
  NETWORK: 'network',     // Network/connection error
  UNKNOWN: 'unknown'      // Unknown error
};

function classifyError(status, errors) {
  // Classify by HTTP status first
  switch (status) {
    case 429:
      return ERROR_TYPES.RATE_LIMIT;
    case 401:
    case 403:
      return ERROR_TYPES.AUTH;
  }

  if (status >= 500) {
    return ERROR_TYPES.SERVER;
  }

  // Fall back to error message content analysis
  const errorStr = (errors || []).join(' ').toLowerCase();

  switch (true) {
    case errorStr.includes('secret'):
    case errorStr.includes('not logged in'):
    case errorStr.includes('session'):
      return ERROR_TYPES.AUTH;

    case errorStr.includes('device') &&
      (errorStr.includes('not found') || errorStr.includes('invalid') || errorStr.includes('not registered')):
      return ERROR_TYPES.DEVICE;

    case errorStr.includes('token'):
    case errorStr.includes('user identifier'):
      return ERROR_TYPES.VALIDATION;

    default:
      return ERROR_TYPES.UNKNOWN;
  }
}

class PushoverAPIError extends Error {
  constructor(message, status, errors = [], errorType = null) {
    super(message);
    this.name = 'PushoverAPIError';
    this.status = status;
    this.errors = errors;
    this.errorType = errorType || classifyError(status, errors);
  }

  get isRecoverable() {
    return this.errorType === ERROR_TYPES.SERVER ||
      this.errorType === ERROR_TYPES.NETWORK ||
      this.errorType === ERROR_TYPES.RATE_LIMIT;
  }
}

function formatErrors(errors) {
  if (!errors) return 'Unknown error';
  if (Array.isArray(errors)) return errors.join(', ');
  if (typeof errors === 'object') {
    return Object.entries(errors)
      .map(([field, msgs]) => Array.isArray(msgs) ? msgs.join(', ') : msgs)
      .join(', ');
  }
  return String(errors);
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const { signal, ...rest } = options;

  let response;
  try {
    response = await fetch(url, {
      ...rest,
      signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...rest.headers
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new PushoverAPIError(
      'Network error: Unable to connect to Pushover servers',
      0,
      [],
      ERROR_TYPES.NETWORK
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    if (response.status >= 500) {
      throw new PushoverAPIError(
        'Server error: Invalid response from Pushover',
        response.status,
        [],
        ERROR_TYPES.SERVER
      );
    }
    throw new PushoverAPIError(
      'Invalid response from server',
      response.status,
      []
    );
  }

  if (!response.ok && response.status !== 412) {
    const errors = Array.isArray(data.errors) ? data.errors :
      (typeof data.errors === 'object' ? Object.values(data.errors).flat() : []);
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'API request failed',
      response.status,
      errors
    );
  }

  return { data, status: response.status };
}

function encodeParams(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

// =============================================================================
// Open Client API (for receiving messages)
// =============================================================================

export async function login(email, password, twofa = null) {
  const params = { email, password };
  if (twofa) {
    params.twofa = twofa;
  }

  const { data, status } = await apiRequest('/users/login.json', {
    method: 'POST',
    body: encodeParams(params)
  });

  if (status === 412) {
    return { requires2FA: true };
  }

  if (data.status !== 1) {
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'Login failed',
      status,
      data.errors || []
    );
  }

  return {
    secret: data.secret,
    userId: data.id
  };
}

export async function registerDevice(secret, deviceName) {
  const { data } = await apiRequest('/devices.json', {
    method: 'POST',
    body: encodeParams({
      secret,
      name: deviceName,
      os: 'O' // "O" for Open Client
    })
  });

  if (data.status !== 1) {
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'Device registration failed',
      0,
      data.errors || []
    );
  }

  return data.id;
}

export async function fetchMessages(secret, deviceId, signal = null) {
  const { data } = await apiRequest(
    `/messages.json?secret=${encodeURIComponent(secret)}&device_id=${encodeURIComponent(deviceId)}`,
    { method: 'GET', signal }
  );

  if (data.status !== 1) {
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'Failed to fetch messages',
      0,
      data.errors || []
    );
  }

  return data.messages || [];
}

export async function deleteMessages(secret, deviceId, highestMessageId, signal = null) {
  const { data } = await apiRequest(`/devices/${encodeURIComponent(deviceId)}/update_highest_message.json`, {
    method: 'POST',
    signal,
    body: encodeParams({
      secret,
      message: highestMessageId
    })
  });

  if (data.status !== 1) {
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'Failed to delete messages',
      0,
      data.errors || []
    );
  }

  return true;
}

export async function acknowledgeEmergency(secret, receiptId) {
  const { data } = await apiRequest(`/receipts/${encodeURIComponent(receiptId)}/acknowledge.json`, {
    method: 'POST',
    body: encodeParams({ secret })
  });

  if (data.status !== 1) {
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'Failed to acknowledge emergency',
      0,
      data.errors || []
    );
  }

  return true;
}

// =============================================================================
// Message API (for sending messages)
// =============================================================================

export async function sendMessage({ token, user, message, title, device, priority, retry, expire, url, urlTitle, sound, attachmentBuffer, attachmentType }) {
  const formData = new FormData();
  formData.append('token', token);
  formData.append('user', user);
  formData.append('message', message);
  if (title) formData.append('title', title);
  if (device) formData.append('device', device);
  if (priority !== undefined) formData.append('priority', String(priority));
  if (priority === 2) {
    formData.append('retry', String(retry || 60));
    formData.append('expire', String(expire || 3600));
  }
  if (url) formData.append('url', url);
  if (urlTitle) formData.append('url_title', urlTitle);
  if (sound) formData.append('sound', sound);

  if (attachmentBuffer && attachmentType) {
    const blob = new Blob([attachmentBuffer], { type: attachmentType });
    formData.append('attachment', blob, 'attachment');
  }

  const response = await fetch(`${API_BASE}/messages.json`, {
    method: 'POST',
    body: formData
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new PushoverAPIError('Invalid response from server', response.status);
  }

  if (data.status !== 1) {
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'Failed to send message',
      0,
      data.errors || []
    );
  }

  return {
    success: true,
    request: data.request,
    receipt: data.receipt // Only present for emergency priority
  };
}

export async function validateCredentials(token, user) {
  try {
    const { data } = await apiRequest('/users/validate.json', {
      method: 'POST',
      body: encodeParams({ token, user })
    });

    return {
      valid: data.status === 1,
      devices: data.devices || [],
      group: data.group || 0
    };
  } catch (error) {
    return { valid: false, devices: [], group: 0 };
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

// TODO: Implement icon caching using Cache API to reduce API calls
// Icons should be cached locally per Pushover API guidelines (Step 11)
export function getIconUrl(iconName) {
  if (!iconName) return null;
  return `https://api.pushover.net/icons/${iconName}.png`;
}

export function getSoundUrl(soundName) {
  if (!soundName) return null;
  return `https://api.pushover.net/sounds/${soundName}.mp3`;
}

// =============================================================================
// WebSocket API (for real-time message notification)
// =============================================================================

const WEBSOCKET_URL = 'wss://client.pushover.net/push';

export function createWebSocketConnection(deviceId, secret, handlers = {}) {
  const { onMessage, onReload, onError, onClose, onOpen } = handlers;

  const ws = new WebSocket(WEBSOCKET_URL);

  ws.onopen = () => {
    const loginMessage = `login:${deviceId}:${secret}\n`;
    ws.send(loginMessage);
    onOpen?.();
  };

  ws.onmessage = async (event) => {
    const data = event.data instanceof Blob ? await event.data.text() : event.data;

    if (data === '#') {
      return;
    }

    if (data === '!') {
      onMessage?.();
      return;
    }

    if (data === 'R') {
      onReload?.();
      return;
    }

    if (data === 'E') {
      onError?.('permanent', 'Permanent error occurred. Please re-login.');
      return;
    }

    if (data === 'A') {
      onError?.('session_conflict', 'Device logged in from another session.');
      return;
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    onError?.('connection', 'WebSocket connection error');
  };

  ws.onclose = (event) => {
    onClose?.(event.code, event.reason);
  };

  return ws;
}

export { PushoverAPIError };
