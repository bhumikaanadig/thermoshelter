import { firebaseWebConfig, isFirebaseAnonymousAuthConfigured } from './firebaseConfig.js';

const IDENTITY_ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const TOKEN_ENDPOINT = 'https://securetoken.googleapis.com/v1/token';
const STORAGE_KEY = 'thermoshelter.firebase.anonymous-session.v1';
const REFRESH_MARGIN_MS = 60_000;
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

let cachedSession = null;
let cachedIdToken = '';
let cachedIdTokenExpiry = 0;
let pendingIdentityRequest = null;

class FirebaseIdentityError extends Error {
  constructor(message, code = '') {
    super(message);
    this.name = 'FirebaseIdentityError';
    this.code = code;
  }
}

function readSession() {
  if (cachedSession) return cachedSession;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (typeof session?.refreshToken !== 'string' || !session.refreshToken) return null;
    cachedSession = session;
    return session;
  } catch {
    return null;
  }
}

function saveSession(session) {
  cachedSession = session;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // The in-memory identity still works for this browser session if storage is unavailable.
  }
}

function clearSession() {
  cachedSession = null;
  cachedIdToken = '';
  cachedIdTokenExpiry = 0;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Continue without persisted browser storage.
  }
}

export async function postFirebaseAuth(url, body, formEncoded = false, {
  fetcher = globalThis.fetch,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response;
  let payload;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': formEncoded ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: formEncoded ? new URLSearchParams(body).toString() : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    if (timedOut) {
      throw new FirebaseIdentityError(`Cloud sign-in timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Please try again.`);
    }
    throw new FirebaseIdentityError('Cloud saving is temporarily unavailable. Check your connection and try again.');
  }
  try {
    payload = await response.json();
  } catch {
    clearTimeout(timeoutId);
    if (timedOut) {
      throw new FirebaseIdentityError(`Cloud sign-in timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Please try again.`);
    }
    throw new FirebaseIdentityError('Cloud saving is temporarily unavailable. Please try again later.');
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const code = String(payload?.error?.message || '');
    if (code === 'OPERATION_NOT_ALLOWED') {
      throw new FirebaseIdentityError('Cloud saving is unavailable for this project.', code);
    }
    throw new FirebaseIdentityError('Cloud saving is temporarily unavailable. Please try again later.', code);
  }
  return payload;
}

function validateAuthResponse(payload) {
  const idToken = payload?.id_token || payload?.idToken;
  const refreshToken = payload?.refresh_token || payload?.refreshToken;
  const expiresIn = payload?.expires_in || payload?.expiresIn;
  if (typeof idToken !== 'string' || typeof refreshToken !== 'string' || !expiresIn) {
    throw new FirebaseIdentityError('Cloud saving could not start. Please try again later.');
  }
  cachedIdToken = idToken;
  cachedIdTokenExpiry = Date.now() + Number(expiresIn) * 1000;
  const previous = readSession();
  saveSession({
    uid: payload.localId || payload.user_id || previous?.uid || '',
    refreshToken,
  });
  return cachedIdToken;
}

async function signInAnonymously() {
  const payload = await postFirebaseAuth(
    `${IDENTITY_ENDPOINT}?key=${encodeURIComponent(firebaseWebConfig.apiKey)}`,
    { returnSecureToken: true },
  );
  return validateAuthResponse(payload);
}

async function refreshSession(session) {
  const payload = await postFirebaseAuth(
    `${TOKEN_ENDPOINT}?key=${encodeURIComponent(firebaseWebConfig.apiKey)}`,
    { grant_type: 'refresh_token', refresh_token: session.refreshToken },
    true,
  );
  return validateAuthResponse(payload);
}

async function getOrCreateIdToken() {
  if (!isFirebaseAnonymousAuthConfigured()) {
    throw new FirebaseIdentityError(
      'Cloud saving is not set up for this environment yet.',
    );
  }
  if (cachedIdToken && cachedIdTokenExpiry > Date.now() + REFRESH_MARGIN_MS) return cachedIdToken;
  const saved = readSession();
  if (!saved) return signInAnonymously();
  try {
    return await refreshSession(saved);
  } catch (error) {
    if (['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_NOT_FOUND', 'USER_DISABLED'].includes(error?.code)) {
      clearSession();
      return signInAnonymously();
    }
    throw error;
  }
}

/** Return a valid Firebase anonymous ID token for an authenticated API request. */
export function getAnonymousFirebaseIdToken({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    cachedIdToken = '';
    cachedIdTokenExpiry = 0;
  }
  if (!pendingIdentityRequest) {
    pendingIdentityRequest = getOrCreateIdToken().finally(() => {
      pendingIdentityRequest = null;
    });
  }
  return pendingIdentityRequest;
}
