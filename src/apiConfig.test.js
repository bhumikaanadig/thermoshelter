import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PRODUCTION_API_BASE_URL,
  verifyNetlifyApiConfig,
} from '../scripts/verify-netlify-api-config.mjs';

const netlifyConfig = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const renderConfig = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');

test('Netlify build configuration pins the production API base URL', () => {
  assert.match(netlifyConfig, /^\[build\.environment\]\s*$/m);
  assert.match(
    netlifyConfig,
    new RegExp(`^\\s*VITE_API_BASE_URL\\s*=\\s*"${PRODUCTION_API_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*$`, 'm'),
  );
});

test('Netlify build guard rejects missing or incorrect API configuration', () => {
  assert.doesNotThrow(() => verifyNetlifyApiConfig({
    isNetlifyBuild: true,
    apiBaseUrl: `${PRODUCTION_API_BASE_URL}/`,
  }));
  assert.throws(
    () => verifyNetlifyApiConfig({ isNetlifyBuild: true, apiBaseUrl: '' }),
    /Netlify builds must use VITE_API_BASE_URL=/,
  );
  assert.throws(
    () => verifyNetlifyApiConfig({ isNetlifyBuild: true, apiBaseUrl: 'http://127.0.0.1:8000' }),
    /Netlify builds must use VITE_API_BASE_URL=/,
  );
});

test('Render uses the model-aware API health endpoint for deploy and runtime health checks', () => {
  assert.match(renderConfig, /^\s+healthCheckPath:\s*\/health\s*$/m);
});
