import assert from 'node:assert/strict';
import test from 'node:test';
import { requestJsonWithRecovery } from './apiRequest.js';

const baseUrl = 'https://api.example.test';
const ready = { api_running: true, model_loaded: true, model_version: 'V3' };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function htmlResponse(status) {
  return { ok: false, status, json: async () => { throw new SyntaxError('not JSON'); } };
}

const fastOptions = {
  sleepImpl: async () => {},
  formatError: (status, body) => body?.detail || `HTTP ${status}`,
};

test('successful V3 request returns the API response and reports the response stage', async () => {
  const progress = [];
  const calls = [];
  const result = await requestJsonWithRecovery({
    ...fastOptions,
    baseUrl,
    path: '/predict',
    options: { method: 'POST', body: JSON.stringify({ Shelter_Length_m: 5 }) },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ model_version: 'V3', predictions: { Average_Air_Temperature_C: 18 } });
    },
    onProgress: (value) => progress.push(value),
  });

  assert.equal(result.model_version, 'V3');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/predict`);
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(progress.at(-1).phase, 'response');
  assert.equal(progress.at(-1).percent, 90);
});

test('a transient network failure polls /health and replays the idempotent V3 request', async () => {
  const paths = [];
  const progress = [];
  let predictionCalls = 0;
  const result = await requestJsonWithRecovery({
    ...fastOptions,
    baseUrl,
    path: '/predict',
    options: { method: 'POST', body: '{"case":"same"}' },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/health') return jsonResponse(ready);
      predictionCalls += 1;
      if (predictionCalls === 1) throw new TypeError('Failed to fetch');
      return jsonResponse({ model_version: 'V3', predictions: { Average_Air_Temperature_C: 19 } });
    },
    onProgress: (value) => progress.push(value),
  });

  assert.equal(result.predictions.Average_Air_Temperature_C, 19);
  assert.deepEqual(paths, ['/predict', '/health', '/predict']);
  assert.ok(progress.some((value) => value.phase === 'recovering'));
  assert.ok(progress.some((value) => value.phase === 'ready'));
});

test('Render HTML 502 and model-not-ready health responses are retried with backoff', async () => {
  const paths = [];
  let healthCalls = 0;
  let predictionCalls = 0;
  const result = await requestJsonWithRecovery({
    ...fastOptions,
    baseUrl,
    path: '/predict-hourly',
    options: { method: 'POST', body: '{}' },
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/predict-hourly') {
        predictionCalls += 1;
        return predictionCalls === 1 ? htmlResponse(502) : jsonResponse({ model_version: 'V3-Hourly-v1' });
      }
      healthCalls += 1;
      if (healthCalls === 1) return htmlResponse(502);
      if (healthCalls === 2) return jsonResponse({ api_running: true, model_loaded: false });
      return jsonResponse(ready);
    },
  });

  assert.equal(result.model_version, 'V3-Hourly-v1');
  assert.equal(predictionCalls, 2);
  assert.deepEqual(paths, ['/predict-hourly', '/health', '/health', '/health', '/predict-hourly']);
});

test('validation errors are returned immediately without health polling', async () => {
  let calls = 0;
  await assert.rejects(requestJsonWithRecovery({
    ...fastOptions,
    baseUrl,
    path: '/predict',
    options: { method: 'POST', body: '{}' },
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ detail: 'Shelter_Length_m must be greater than zero.' }, 422);
    },
  }), (error) => error.status === 422 && /greater than zero/.test(error.message));
  assert.equal(calls, 1);
});

test('non-idempotent persistence writes are never replayed after a gateway error', async () => {
  let calls = 0;
  await assert.rejects(requestJsonWithRecovery({
    ...fastOptions,
    baseUrl,
    path: '/records/predictions',
    options: { method: 'POST', body: '{"result":"one-shot"}' },
    fetchImpl: async () => {
      calls += 1;
      return htmlResponse(502);
    },
  }), (error) => error.status === 502);
  assert.equal(calls, 1);
});

test('simultaneous safe requests share one bounded readiness poll stream', async () => {
  let initialRequests = 0;
  let replayRequests = 0;
  let healthRequests = 0;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/health') {
      healthRequests += 1;
      return jsonResponse(ready);
    }
    if (initialRequests < 2) {
      initialRequests += 1;
      throw new TypeError('Failed to fetch');
    }
    replayRequests += 1;
    return jsonResponse({ materials: [] });
  };

  const results = await Promise.all(['one', 'two'].map(() => requestJsonWithRecovery({
    ...fastOptions,
    baseUrl,
    path: '/materials',
    fetchImpl,
  })));

  assert.equal(results.length, 2);
  assert.equal(initialRequests, 2);
  assert.equal(replayRequests, 2);
  assert.equal(healthRequests, 1);
});

test('recovery stops after the bounded health-probe schedule', async () => {
  let predictionCalls = 0;
  let healthCalls = 0;
  await assert.rejects(requestJsonWithRecovery({
    ...fastOptions,
    baseUrl,
    path: '/predict',
    options: { method: 'POST', body: '{}' },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/health') {
        healthCalls += 1;
        return htmlResponse(502);
      }
      predictionCalls += 1;
      return htmlResponse(502);
    },
  }), (error) => /automatic readiness checks/.test(error.message));
  assert.equal(predictionCalls, 1);
  assert.equal(healthCalls, 8);
});
