// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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

async function buildOutput() {
  const result = await build({
    root: resolve('apps/web'),
    configFile: resolve('apps/web/vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, minify: false },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one build');
  return result.output;
}

async function buildEntry() {
  const output = await buildOutput();
  const entry = output.find((item) => item.type === 'chunk' && item.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Missing browser entry');
  // JSDOM evaluates the browser entry as a classic script; its exports are unused by this probe.
  return entry.code.replace(/export\s*\{[^}]*\};?\s*$/s, '');
}

afterEach(() => vi.unstubAllEnvs());
describe('production Mini App API configuration', () => {
  it('shows an immediate boot shell and defers Telegram SDK before the app module', () => {
    const html = readFileSync(resolve('apps/web/index.html'), 'utf8');
    const telegramIndex = html.indexOf('src="https://telegram.org/js/telegram-web-app.js"');
    const appIndex = html.indexOf('type="module" src="/src/main.tsx"');
    expect(html).toContain('class="boot-screen"');
    expect(html.slice(telegramIndex - 24, telegramIndex)).toContain('defer');
    expect(telegramIndex).toBeGreaterThanOrEqual(0);
    expect(appIndex).toBeGreaterThan(telegramIndex);
  });

  it('keeps Review and Vocabulary components out of the entry chunk', async () => {
    const chunks = (await buildOutput()).filter((item) => item.type === 'chunk');
    const entry = chunks.find((item) => item.isEntry);
    expect(entry).toBeDefined();
    const entryModules = Object.keys(entry!.modules).join('\n');
    expect(entryModules).not.toContain('/features/review/components/FlashcardReviewPanel.tsx');
    expect(entryModules).not.toContain('/features/vocabulary/components/VocabularyManagerPanel.tsx');
    const lazyModules = chunks
      .filter((item) => !item.isEntry)
      .flatMap((item) => Object.keys(item.modules));
    expect(lazyModules.some((id) => id.includes('/features/review/components/FlashcardReviewPanel.tsx'))).toBe(
      true,
    );
    expect(
      lazyModules.some((id) => id.includes('/features/vocabulary/components/VocabularyManagerPanel.tsx')),
    ).toBe(true);
  }, 20_000);

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
