// Pushover Chrome Extension - API Pure Function Tests
// Run: node --test tests/lib/api.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_TYPES,
  PushoverAPIError,
  classifyError,
  formatErrors,
  encodeParams,
  getIconUrl,
  getSoundUrl
} from '../../src/lib/api.js';

// =============================================================================
// classifyError
// =============================================================================

describe('classifyError', () => {
  // HTTP status-based classification
  it('returns RATE_LIMIT for 429', () => {
    assert.equal(classifyError(429, []), ERROR_TYPES.RATE_LIMIT);
  });

  it('returns AUTH for 401', () => {
    assert.equal(classifyError(401, []), ERROR_TYPES.AUTH);
  });

  it('returns AUTH for 403', () => {
    assert.equal(classifyError(403, []), ERROR_TYPES.AUTH);
  });

  it('returns SERVER for 500', () => {
    assert.equal(classifyError(500, []), ERROR_TYPES.SERVER);
  });

  it('returns SERVER for 502', () => {
    assert.equal(classifyError(502, []), ERROR_TYPES.SERVER);
  });

  it('returns SERVER for 503', () => {
    assert.equal(classifyError(503, []), ERROR_TYPES.SERVER);
  });

  // Status takes precedence over error messages
  it('status takes precedence over error message content', () => {
    assert.equal(classifyError(429, ['invalid token']), ERROR_TYPES.RATE_LIMIT);
  });

  // Error message-based classification
  it('returns AUTH for secret-related errors', () => {
    assert.equal(classifyError(400, ['secret is invalid']), ERROR_TYPES.AUTH);
  });

  it('returns AUTH for "not logged in" errors', () => {
    assert.equal(classifyError(400, ['user is not logged in']), ERROR_TYPES.AUTH);
  });

  it('returns AUTH for session-related errors', () => {
    assert.equal(classifyError(400, ['session expired']), ERROR_TYPES.AUTH);
  });

  it('returns DEVICE for "device not found"', () => {
    assert.equal(classifyError(400, ['device not found']), ERROR_TYPES.DEVICE);
  });

  it('returns DEVICE for "device invalid"', () => {
    assert.equal(classifyError(400, ['device is invalid']), ERROR_TYPES.DEVICE);
  });

  it('returns DEVICE for "device not registered"', () => {
    assert.equal(classifyError(400, ['device not registered']), ERROR_TYPES.DEVICE);
  });

  it('returns VALIDATION for token errors', () => {
    assert.equal(classifyError(400, ['application token is invalid']), ERROR_TYPES.VALIDATION);
  });

  it('returns VALIDATION for user identifier errors', () => {
    assert.equal(classifyError(400, ['user identifier is not valid']), ERROR_TYPES.VALIDATION);
  });

  it('returns UNKNOWN for unrecognized errors', () => {
    assert.equal(classifyError(400, ['something weird happened']), ERROR_TYPES.UNKNOWN);
  });

  it('returns UNKNOWN for null errors', () => {
    assert.equal(classifyError(400, null), ERROR_TYPES.UNKNOWN);
  });

  it('returns UNKNOWN for empty errors', () => {
    assert.equal(classifyError(400, []), ERROR_TYPES.UNKNOWN);
  });

  // Device keyword alone shouldn't match without qualifier
  it('does not match "device" without not found/invalid/not registered', () => {
    assert.equal(classifyError(400, ['device limit reached']), ERROR_TYPES.UNKNOWN);
  });
});

// =============================================================================
// PushoverAPIError
// =============================================================================

describe('PushoverAPIError', () => {
  it('auto-classifies error type from status', () => {
    const err = new PushoverAPIError('rate limited', 429, []);
    assert.equal(err.errorType, ERROR_TYPES.RATE_LIMIT);
  });

  it('auto-classifies error type from error messages', () => {
    const err = new PushoverAPIError('fail', 400, ['secret is invalid']);
    assert.equal(err.errorType, ERROR_TYPES.AUTH);
  });

  it('uses explicit errorType when provided', () => {
    const err = new PushoverAPIError('fail', 400, [], ERROR_TYPES.NETWORK);
    assert.equal(err.errorType, ERROR_TYPES.NETWORK);
  });

  it('isRecoverable is true for SERVER errors', () => {
    const err = new PushoverAPIError('fail', 500, []);
    assert.equal(err.isRecoverable, true);
  });

  it('isRecoverable is true for NETWORK errors', () => {
    const err = new PushoverAPIError('fail', 0, [], ERROR_TYPES.NETWORK);
    assert.equal(err.isRecoverable, true);
  });

  it('isRecoverable is true for RATE_LIMIT errors', () => {
    const err = new PushoverAPIError('fail', 429, []);
    assert.equal(err.isRecoverable, true);
  });

  it('isRecoverable is false for AUTH errors', () => {
    const err = new PushoverAPIError('fail', 401, []);
    assert.equal(err.isRecoverable, false);
  });

  it('isRecoverable is false for DEVICE errors', () => {
    const err = new PushoverAPIError('fail', 400, ['device not found']);
    assert.equal(err.isRecoverable, false);
  });

  it('isRecoverable is false for VALIDATION errors', () => {
    const err = new PushoverAPIError('fail', 400, ['token is invalid']);
    assert.equal(err.isRecoverable, false);
  });

  it('preserves message, status, and errors', () => {
    const err = new PushoverAPIError('bad request', 400, ['field invalid']);
    assert.equal(err.message, 'bad request');
    assert.equal(err.status, 400);
    assert.deepEqual(err.errors, ['field invalid']);
    assert.equal(err.name, 'PushoverAPIError');
  });
});

// =============================================================================
// formatErrors
// =============================================================================

describe('formatErrors', () => {
  it('returns "Unknown error" for null', () => {
    assert.equal(formatErrors(null), 'Unknown error');
  });

  it('returns "Unknown error" for undefined', () => {
    assert.equal(formatErrors(undefined), 'Unknown error');
  });

  it('joins array of errors', () => {
    assert.equal(formatErrors(['err1', 'err2']), 'err1, err2');
  });

  it('returns single array element as-is', () => {
    assert.equal(formatErrors(['only error']), 'only error');
  });

  it('handles empty array', () => {
    assert.equal(formatErrors([]), '');
  });

  it('flattens object errors with array values', () => {
    const result = formatErrors({ email: ['is required'], password: ['too short'] });
    assert.equal(result, 'is required, too short');
  });

  it('handles object errors with string values', () => {
    const result = formatErrors({ email: 'is required' });
    assert.equal(result, 'is required');
  });

  it('stringifies other types', () => {
    assert.equal(formatErrors(42), '42');
    assert.equal(formatErrors('plain string'), 'plain string');
  });
});

// =============================================================================
// encodeParams
// =============================================================================

describe('encodeParams', () => {
  it('encodes simple key-value pairs', () => {
    const result = encodeParams({ foo: 'bar', baz: '123' });
    assert.equal(result, 'foo=bar&baz=123');
  });

  it('filters out undefined values', () => {
    const result = encodeParams({ a: '1', b: undefined, c: '3' });
    assert.equal(result, 'a=1&c=3');
  });

  it('filters out null values', () => {
    const result = encodeParams({ a: '1', b: null });
    assert.equal(result, 'a=1');
  });

  it('filters out empty string values', () => {
    const result = encodeParams({ a: '1', b: '' });
    assert.equal(result, 'a=1');
  });

  it('URL-encodes special characters', () => {
    const result = encodeParams({ msg: 'hello world', url: 'https://example.com?a=1&b=2' });
    assert.equal(result, 'msg=hello%20world&url=https%3A%2F%2Fexample.com%3Fa%3D1%26b%3D2');
  });

  it('returns empty string for empty object', () => {
    assert.equal(encodeParams({}), '');
  });

  it('returns empty string when all values are filtered', () => {
    assert.equal(encodeParams({ a: undefined, b: null, c: '' }), '');
  });

  it('keeps zero as a valid value', () => {
    const result = encodeParams({ priority: 0 });
    assert.equal(result, 'priority=0');
  });
});

// =============================================================================
// getIconUrl / getSoundUrl
// =============================================================================

describe('getIconUrl', () => {
  it('returns full URL for icon name', () => {
    assert.equal(getIconUrl('pushover'), 'https://api.pushover.net/icons/pushover.png');
  });

  it('returns null for null', () => {
    assert.equal(getIconUrl(null), null);
  });

  it('returns null for undefined', () => {
    assert.equal(getIconUrl(undefined), null);
  });

  it('returns null for empty string', () => {
    assert.equal(getIconUrl(''), null);
  });
});

describe('getSoundUrl', () => {
  it('returns full URL for sound name', () => {
    assert.equal(getSoundUrl('pushover'), 'https://api.pushover.net/sounds/pushover.mp3');
  });

  it('returns null for null', () => {
    assert.equal(getSoundUrl(null), null);
  });
});
