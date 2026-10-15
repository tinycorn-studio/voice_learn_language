import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import productionConfig from './public-config.json';

const APP_DIR = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, APP_DIR, 'VITE_');
  // The public production origin must survive a clean checkout without ignored env files.
  const apiBaseUrl =
    env['VITE_API_BASE_URL'] ?? (mode === 'production' ? productionConfig.apiBaseUrl : '');
  if (command === 'build') {
    const invalidOrigin = () =>
      new Error(
        'API origin must be an HTTPS Worker origin without credentials, path, query or hash; Pages and placeholders are invalid.',
      );
    let url: URL;
    try {
      url = new URL(apiBaseUrl);
    } catch {
      throw invalidOrigin();
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.hostname.endsWith('.pages.dev') ||
      url.hostname.toLowerCase().includes('your-worker')
    )
      throw invalidOrigin();
  }
  return {
    root: APP_DIR,
    plugins: [react()],
    envDir: APP_DIR,
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl) },
    server: { port: 5173, strictPort: true },
  };
});
