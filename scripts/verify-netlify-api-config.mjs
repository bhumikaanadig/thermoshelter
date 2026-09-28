export const PRODUCTION_API_BASE_URL = 'https://thermoshelter-api-5xkn.onrender.com';

export function verifyNetlifyApiConfig({
  isNetlifyBuild = process.env.NETLIFY === 'true',
  apiBaseUrl = process.env.VITE_API_BASE_URL,
} = {}) {
  if (!isNetlifyBuild) return;

  const configuredBaseUrl = (apiBaseUrl || '').trim().replace(/\/+$/, '');
  if (configuredBaseUrl !== PRODUCTION_API_BASE_URL) {
    throw new Error(
      `Netlify builds must use VITE_API_BASE_URL=${PRODUCTION_API_BASE_URL}; `
      + 'check netlify.toml before deploying.',
    );
  }
}

verifyNetlifyApiConfig();
