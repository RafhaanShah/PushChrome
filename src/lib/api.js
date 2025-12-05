// Pushover Chrome Extension - API Wrapper
// Handles all communication with Pushover API

const API_BASE = 'https://api.pushover.net/1';

class PushoverAPIError extends Error {
  constructor(message, status, errors = []) {
    super(message);
    this.name = 'PushoverAPIError';
    this.status = status;
    this.errors = errors;
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
  const response = await fetch(url, {
    ...rest,
    signal,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...rest.headers
    }
  });

  const data = await response.json();

  if (!response.ok && response.status !== 412) {
    throw new PushoverAPIError(
      formatErrors(data.errors) || 'API request failed',
      response.status,
      data.errors || []
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

export async function sendMessage({ token, user, message, title, device, priority, url, urlTitle, sound }) {
  const params = {
    token,
    user,
    message,
    title,
    device,
    priority,
    url,
    url_title: urlTitle,
    sound
  };

  const { data } = await apiRequest('/messages.json', {
    method: 'POST',
    body: encodeParams(params)
  });

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

export { PushoverAPIError };
