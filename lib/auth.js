import { RETRY_BACKOFF_MAX } from './constants.js';

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

function safeScope(scope = '') {
  return scope.split(/\s+/).filter(Boolean).join(' ');
}

function requestSignal(signal, timeoutMs = 30_000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function defaultSleep(seconds) {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function abortableSleep(sleepFn, seconds, signal) {
  if (!signal) return sleepFn(seconds);
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  let abort;
  try {
    await Promise.race([
      sleepFn(seconds),
      new Promise((_, reject) => {
        abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

export async function deviceAuthorize(config, options = {}) {
  const { fetchFn = globalThis.fetch, signal } = options;
  try {
    const response = await fetchFn(`${config.url}/oauth/authorize_device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.oauthClientId || '',
        scope: safeScope(config.oauthScope),
      }).toString(),
      signal: requestSignal(signal),
    });
    const text = await response.text();
    if (response.status !== 200) {
      throw new Error(`Device authorization failed with HTTP ${response.status}`);
    }
    const payload = JSON.parse(text);
    if (!payload.device_code || !payload.verification_uri) {
      throw new Error('Device authorization returned an incomplete response');
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error.message.startsWith('Device authorization')) throw error;
    throw new Error(`Device authorization failed: ${error.message}`, { cause: error });
  }
}

export async function pollDeviceToken(config, deviceCode, interval, expiresIn, options = {}) {
  const { fetchFn = globalThis.fetch, sleepFn = defaultSleep, signal } = options;
  const deadline = Math.floor(Date.now() / 1000) + Math.max(1, expiresIn);
  let waitSeconds = Math.max(1, interval);
  while (Math.floor(Date.now() / 1000) < deadline) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    try {
      const response = await fetchFn(`${config.url}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: DEVICE_GRANT_TYPE,
          device_code: deviceCode,
          client_id: config.oauthClientId || '',
        }).toString(),
        signal: requestSignal(signal),
      });
      const body = await response.json();
      if (response.status === 200 && body?.access_token) return body;
      const code = String(body?.error || '');
      if (code === 'authorization_pending') {
        await abortableSleep(sleepFn, waitSeconds, signal);
        continue;
      }
      if (code === 'slow_down') {
        waitSeconds = Math.min(waitSeconds + 2, RETRY_BACKOFF_MAX);
        await abortableSleep(sleepFn, waitSeconds, signal);
        continue;
      }
      throw new Error(`Device token polling failed: ${code || `HTTP ${response.status}`}`);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error.message.startsWith('Device token polling failed:')) throw error;
      throw new Error(`Device token polling failed: ${error.message}`, { cause: error });
    }
  }
  throw new Error('Device authorization expired before completion');
}
