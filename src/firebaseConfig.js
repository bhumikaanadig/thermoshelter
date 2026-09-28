/** Public Firebase Web App settings. Never add Admin credentials to VITE_ variables. */
const env = import.meta.env || {};

export const firebaseWebConfig = Object.freeze({
  apiKey: (env.VITE_FIREBASE_API_KEY || '').trim(),
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: (env.VITE_FIREBASE_PROJECT_ID || '').trim(),
  storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: (env.VITE_FIREBASE_APP_ID || '').trim(),
});

export function isFirebaseAnonymousAuthConfigured() {
  return Boolean(firebaseWebConfig.apiKey && firebaseWebConfig.projectId);
}
