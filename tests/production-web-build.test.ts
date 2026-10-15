// @vitest-environment node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import type { TelegramWebAppWindow } from '../apps/web/src/integrations/telegram/telegram-adapter.js';

// jsdom is already the test runtime; its optional declaration package is not required here.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (
    html: string,
    options: { url: string; runScripts: 'outside-only' },
  ) => { window: Window & typeof globalThis & TelegramWebAppWindow };
};
const APP_ORIGIN = 'https://voice-chat-learn-language.pages.dev';
const API_ORIGIN = 'https://voice-chat-learn-language-worker.voice-chat-learn-language.workers.dev';

async function buildEntry() {
  const result = await build({
    root: resolve('apps/web'),
    configFile: resolve('apps/web/vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, minify: false },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one build');
  const entry = result.output.find((item) => item.type === 'chunk' && item.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Missing browser entry');
  return entry.code;
}

afterEach(() => vi.unstubAllEnvs());
describe('production Mini App API configuration', () => {
  it('runs the compiled App and sends Telegram auth to Worker without a process API override', async () => {
    vi.stubEnv('VITE_API_BASE_URL', undefined);
    const code = await buildEntry();
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: APP_ORIGIN,
      runScripts: 'outside-only',
    });
    dom.window.Telegram = { WebApp: { initData: 'synthetic-build-probe', platform: 'tdesktop' } };
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: 'Synthetic auth rejection', retryable: false },
          request_id: 'synthetic-build-request',
        },
        { status: 401 },
      ),
    );
    dom.window.fetch = fetchFn;
    dom.window.console.error = vi.fn();
    dom.window.console.warn = vi.fn();
    try {
      dom.window.eval(code);
      await vi.waitFor(() => expect(dom.window.document.querySelector('textarea')).not.toBeNull());
      expect(String(fetchFn.mock.calls[0]?.[0])).toBe(`${API_ORIGIN}/api/v1/auth/telegram`);
      const report = JSON.parse(dom.window.document.querySelector('textarea')!.value) as {
        attempts: { api_origin: string; code: string; http_status: number }[];
      };
      expect(report.attempts[0]).toMatchObject({
        api_origin: API_ORIGIN,
        code: 'UNAUTHENTICATED',
        http_status: 401,
      });
    } finally {
      dom.window.close();
    }
  }, 20000);

  it.each(['', APP_ORIGIN, 'http://worker.example', 'https://YOUR-WORKER.workers.dev'])(
    'rejects a production build with an invalid API origin: %s',
    async (origin) => {
      vi.stubEnv('VITE_API_BASE_URL', origin);
      await expect(buildEntry()).rejects.toThrow(/API origin/);
    },
    20000,
  );
});
