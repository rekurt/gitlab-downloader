import { describe, expect, jest, test } from '@jest/globals';

import {
  deviceAuthorize,
  pollDeviceToken,
} from '../auth.js';

const config = {
  url: 'https://gitlab.example.com',
  oauthClientId: 'client-1',
  oauthScope: 'api read_user',
};

function response(status, body) {
  return {
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('deviceAuthorize', () => {
  test('sends current client values and validates the response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(200, {
      device_code: 'device',
      verification_uri: 'https://gitlab.example.com/oauth/device',
      user_code: 'ABCD',
    }));
    await expect(deviceAuthorize(config, { fetchFn })).resolves.toMatchObject({ device_code: 'device' });
    const form = new URLSearchParams(fetchFn.mock.calls[0][1].body);
    expect(form.get('client_id')).toBe('client-1');
    expect(form.get('scope')).toBe('api read_user');
  });

  test('cancels an in-flight request', async () => {
    const controller = new AbortController();
    const fetchFn = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    const pending = deviceAuthorize(config, { fetchFn, signal: controller.signal });
    controller.abort(new DOMException('Canceled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  test.each([
    [403, { message: 'forbidden' }, 'HTTP 403'],
    [200, { verification_uri: 'https://gitlab.example.com/oauth/device' }, 'incomplete'],
  ])('rejects invalid HTTP/device responses', async (status, body, message) => {
    await expect(deviceAuthorize(config, {
      fetchFn: jest.fn().mockResolvedValue(response(status, body)),
    })).rejects.toThrow(message);
  });

  test('wraps network and malformed JSON failures without exposing a token', async () => {
    await expect(deviceAuthorize(config, {
      fetchFn: jest.fn().mockRejectedValue(new Error('offline')),
    })).rejects.toThrow('Device authorization failed: offline');
    await expect(deviceAuthorize(config, {
      fetchFn: jest.fn().mockResolvedValue({ status: 200, text: async () => '{' }),
    })).rejects.toThrow('Device authorization failed');
  });
});

describe('pollDeviceToken', () => {
  test('retries pending authorization and returns a token', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(response(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(response(200, { access_token: 'oauth-token' }));
    await expect(pollDeviceToken(config, 'device', 1, 60, {
      fetchFn,
      sleepFn: async () => {},
    })).resolves.toMatchObject({ access_token: 'oauth-token' });
  });

  test('cancels while waiting between attempts', async () => {
    const controller = new AbortController();
    const pending = pollDeviceToken(config, 'device', 1, 60, {
      fetchFn: jest.fn().mockResolvedValue(response(400, { error: 'authorization_pending' })),
      sleepFn: () => new Promise(() => {}),
      signal: controller.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new DOMException('Canceled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('backs off on slow_down without sending a client secret', async () => {
    const sleeps = [];
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(response(400, { error: 'slow_down' }))
      .mockResolvedValueOnce(response(200, { access_token: 'oauth-token' }));
    await expect(pollDeviceToken(config, 'device', 2, 60, {
      fetchFn,
      sleepFn: async (seconds) => sleeps.push(seconds),
    })).resolves.toMatchObject({ access_token: 'oauth-token' });
    expect(sleeps).toEqual([4]);
    expect(new URLSearchParams(fetchFn.mock.calls[0][1].body).has('client_secret')).toBe(false);
  });

  test('reports denied and network polling failures', async () => {
    await expect(pollDeviceToken(config, 'device', 1, 60, {
      fetchFn: jest.fn().mockResolvedValue(response(400, { error: 'access_denied' })),
      sleepFn: async () => {},
    })).rejects.toThrow('access_denied');
    await expect(pollDeviceToken(config, 'device', 1, 60, {
      fetchFn: jest.fn().mockRejectedValue(new Error('offline')),
      sleepFn: async () => {},
    })).rejects.toThrow('Device token polling failed: offline');
  });

  test('rejects a signal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Canceled', 'AbortError'));
    await expect(pollDeviceToken(config, 'device', 1, 60, {
      fetchFn: jest.fn(),
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
