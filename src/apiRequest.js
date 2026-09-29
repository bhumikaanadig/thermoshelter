const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 500, 502, 503, 504]);
const HEALTH_POLL_DELAYS_MS = [1000, 2000, 4000, 8000, 12000, 12000, 12000, 12000];

const readinessPools = new WeakMap();

function notify(onProgress, progress) {
  try {
    onProgress?.(progress);
  } catch {
    // Progress display must never fail the API operation.
  }
}

function asHttpError(status, body, formatError) {
  const error = new Error(formatError?.(status, body) || body?.detail || `THERMOSHELTER API request failed (${status}).`);
  error.status = status;
  if (TRANSIENT_HTTP_STATUSES.has(status)) error.kind = 'transient-http';
  return error;
}

async function requestOnce(url, options, { fetchImpl, timeoutMs, formatError }) {
  const controller = new AbortController();
  let timeoutId;
  const request = (async () => {
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (cause) {
      if (cause?.name === 'AbortError') {
        const error = new Error(`THERMOSHELTER API request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
        error.kind = 'timeout';
        throw error;
      }
      const error = new Error('Unable to connect to THERMOSHELTER API.');
      error.kind = 'network';
      error.cause = cause;
      throw error;
    }

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) throw asHttpError(response.status, body, formatError);
    if (body === null) throw new Error('THERMOSHELTER API returned an unreadable response.');
    return body;
  })();

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(`THERMOSHELTER API request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
      error.kind = 'timeout';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isTransient(error) {
  return error?.kind === 'network'
    || error?.kind === 'timeout'
    || TRANSIENT_HTTP_STATUSES.has(error?.status);
}

function canReplay(method, path) {
  if (method === 'GET') return path !== '/health';
  return method === 'POST' && (path === '/predict' || path === '/predict-hourly');
}

function getPool(fetchImpl) {
  let pool = readinessPools.get(fetchImpl);
  if (!pool) {
    pool = new Map();
    readinessPools.set(fetchImpl, pool);
  }
  return pool;
}

async function pollUntilReady(baseUrl, {
  fetchImpl,
  timeoutMs,
  recoveryTimeoutMs,
  sleepImpl,
  formatError,
  onProgress,
}) {
  const deadline = Date.now() + recoveryTimeoutMs;
  let probes = 0;

  while (probes < HEALTH_POLL_DELAYS_MS.length && Date.now() < deadline) {
    const delayMs = Math.min(HEALTH_POLL_DELAYS_MS[probes], Math.max(0, deadline - Date.now()));
    if (delayMs > 0) await sleepImpl(delayMs);
    if (Date.now() >= deadline) break;

    notify(onProgress, {
      phase: 'recovering',
      percent: 35,
      label: 'Waiting for the thermal API to become ready — 35%',
    });
    probes += 1;
    try {
      const health = await requestOnce(`${baseUrl}/health`, { method: 'GET', headers: { Accept: 'application/json' } }, {
        fetchImpl,
        timeoutMs: Math.max(1, Math.min(8000, timeoutMs, deadline - Date.now())),
        formatError,
      });
      if (health?.api_running === true && health?.model_loaded === true) {
        notify(onProgress, {
          phase: 'ready',
          percent: 55,
          label: 'Thermal API is ready — 55%',
        });
        return;
      }
    } catch {
      // A starting or restarting service may return a gateway error until it is ready.
    }
  }

  const error = new Error('THERMOSHELTER API did not become ready within the recovery window. Please try again.');
  error.kind = 'recovery-timeout';
  throw error;
}

async function waitForApiReady(baseUrl, options) {
  const pool = getPool(options.fetchImpl);
  let recovery = pool.get(baseUrl);
  if (!recovery) {
    const listeners = new Set();
    recovery = { listeners, promise: null };
    const broadcast = (progress) => {
      for (const listener of listeners) notify(listener, progress);
    };
    recovery.promise = pollUntilReady(baseUrl, { ...options, onProgress: broadcast })
      .finally(() => {
        if (pool.get(baseUrl) === recovery) pool.delete(baseUrl);
      });
    pool.set(baseUrl, recovery);
  }

  if (typeof options.onProgress === 'function') recovery.listeners.add(options.onProgress);
  try {
    await recovery.promise;
  } finally {
    recovery.listeners.delete(options.onProgress);
  }
}

function finalRecoveryError(error) {
  if (error?.status) {
    const wrapped = new Error(`${error.message} The API stayed unavailable after automatic readiness checks.`);
    wrapped.status = error.status;
    wrapped.kind = error.kind;
    return wrapped;
  }
  if (error?.kind === 'recovery-timeout') return error;
  const wrapped = new Error('Unable to connect to THERMOSHELTER API after automatic readiness checks. The service did not recover in time; please try again.');
  wrapped.kind = error?.kind || 'network';
  if (error?.cause) wrapped.cause = error.cause;
  return wrapped;
}

/** Send one bounded API request, polling shared readiness before safe retries. */
export async function requestJsonWithRecovery({
  baseUrl,
  path,
  options = {},
  fetchImpl = globalThis.fetch,
  onProgress,
  timeoutMs = 20000,
  recoveryTimeoutMs = 75000,
  sleepImpl = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  formatError,
  recover = true,
}) {
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is not configured.');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable in this browser.');

  const method = (options.method || 'GET').toUpperCase();
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const requestOptions = {
    ...options,
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  };
  const canRecover = recover && canReplay(method, path);
  let retries = 0;

  while (true) {
    notify(onProgress, {
      phase: retries ? 'retrying' : 'connecting',
      percent: retries ? 60 : 35,
      label: retries ? 'Sending request to the ready thermal API — 60%' : 'Connecting to thermal model — 35%',
    });
    try {
      const result = await requestOnce(url, requestOptions, { fetchImpl, timeoutMs, formatError });
      notify(onProgress, {
        phase: 'response',
        percent: 90,
        label: 'Thermal response received — 90%',
      });
      return result;
    } catch (error) {
      if (!canRecover || !isTransient(error)) throw error;
      if (retries >= 1) throw finalRecoveryError(error);
      retries += 1;
      try {
        await waitForApiReady(baseUrl.replace(/\/+$/, ''), {
          fetchImpl,
          timeoutMs,
          recoveryTimeoutMs,
          sleepImpl,
          formatError,
          onProgress,
        });
      } catch (recoveryError) {
        throw finalRecoveryError(error?.status ? error : recoveryError);
      }
    }
  }
}
