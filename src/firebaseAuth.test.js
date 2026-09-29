import assert from 'node:assert/strict';
import test from 'node:test';
import { postFirebaseAuth } from './firebaseAuth.js';

test('Firebase identity requests have a bounded timeout and clear failure', async () => {
  await assert.rejects(postFirebaseAuth(
    'https://identitytoolkit.googleapis.com/v1/accounts:signUp',
    { returnSecureToken: true },
    false,
    {
      timeoutMs: 5,
      fetcher: (_url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    },
  ), /Cloud sign-in timed out after 1 seconds/);
});

test('Firebase identity HTTP errors preserve the actionable cloud-saving message', async () => {
  await assert.rejects(postFirebaseAuth(
    'https://identitytoolkit.googleapis.com/v1/accounts:signUp',
    { returnSecureToken: true },
    false,
    { fetcher: async () => ({ ok: false, json: async () => ({ error: { message: 'UNAVAILABLE' } }) }) },
  ), /Cloud saving is temporarily unavailable/);
});
