import { AppError, logStructured, type WorkerEnv } from '../domain/env.js';
import { generateTutorReply, type TutorHistoryTurn } from './gemini-tutor.js';
import { translateTranscriptTurn } from './gemini-translator.js';
import {
  requestOpenAiCompatibleChat,
  resolveOpenAiChatConfig,
  type OpenAiChatConfig,
} from './openai-chat.js';
import { TRANSLATION_SYSTEM_INSTRUCTION, TUTOR_SYSTEM_INSTRUCTION } from './text-prompts.js';

/**
 * Provider switch for the text AI routes `translate` + `chat-turn` (`M9-05`).
 * Default is Gemini (behavior unchanged when `TEXT_AI_*` is not configured). Setting
 * `TEXT_AI_PROVIDER=openai` routes both routes to an OpenAI-compatible endpoint
 * (verified against Z.AI GLM-4.7-Flash free tier) and falls back to Gemini automatically
 * on provider errors so a free-tier outage does not take the routes down.
 * Gemini Live realtime voice is untouched.
 */
type TextAiProvider = 'gemini' | 'openai';

function resolveProvider(env: WorkerEnv, requestId: string): TextAiProvider {
  const raw = (env.TEXT_AI_PROVIDER ?? 'gemini').trim().toLowerCase();
  if (raw === '' || raw === 'gemini') return 'gemini';
  if (raw === 'openai') return 'openai';
  logStructured('warn', 'text_ai_provider_unknown', requestId, {});
  return 'gemini';
}

function openAiChatConfig(env: WorkerEnv, requestId: string): OpenAiChatConfig | null {
  const config = resolveOpenAiChatConfig({
    baseUrl: env.TEXT_AI_BASE_URL,
    apiKey: env.TEXT_AI_API_KEY,
    model: env.TEXT_AI_MODEL,
  });
  if (!config) {
    logStructured('warn', 'text_ai_config_incomplete', requestId, {});
  }
  return config;
}

/**
 * Runs the configured provider call with the Gemini fallback. Timeouts do not fall back:
 * the per-request budget is already spent, so a second provider would exceed client timeouts.
 */
async function callWithFallback(params: {
  requestId: string;
  primary: (() => Promise<string>) | null;
  fallback: () => Promise<string>;
}): Promise<string> {
  if (!params.primary) return params.fallback();
  try {
    return await params.primary();
  } catch (error) {
    if (!(error instanceof AppError) || error.code === 'TIMEOUT') throw error;
    logStructured('warn', 'text_ai_fallback', params.requestId, {
      provider: 'openai',
      reason: error.code,
    });
    return params.fallback();
  }
}

/** One lite-mode tutor reply through the configured provider (`M9-05`; was Gemini-only `M9-01`). */
export async function requestTutorReply(params: {
  env: WorkerEnv;
  message: string;
  history?: TutorHistoryTurn[];
  fetchFn?: typeof fetch;
  requestId: string;
}): Promise<string> {
  const config =
    resolveProvider(params.env, params.requestId) === 'openai'
      ? openAiChatConfig(params.env, params.requestId)
      : null;

  const geminiFallback = () =>
    generateTutorReply({
      message: params.message,
      ...(params.history ? { history: params.history } : {}),
      geminiApiKey: params.env.GEMINI_API_KEY,
      ...(params.env.GEMINI_TRANSLATION_MODEL
        ? { model: params.env.GEMINI_TRANSLATION_MODEL }
        : {}),
      ...(params.fetchFn ? { fetchFn: params.fetchFn } : {}),
    });

  return callWithFallback({
    requestId: params.requestId,
    primary: config
      ? () =>
          requestOpenAiCompatibleChat({
            config,
            system: TUTOR_SYSTEM_INSTRUCTION,
            messages: [
              ...(params.history ?? []).map((turn) => ({
                role: (turn.role === 'learner' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: turn.text,
              })),
              { role: 'user' as const, content: params.message },
            ],
            temperature: 0.6,
            maxTokens: 320,
            maxContentLength: 1_200,
            ...(params.fetchFn ? { fetchFn: params.fetchFn } : {}),
          })
      : null,
    fallback: geminiFallback,
  });
}

/** Translation through the configured provider (`M9-05`; was Gemini-only `M8-01`). */
export async function translateText(params: {
  env: WorkerEnv;
  text: string;
  fetchFn?: typeof fetch;
  requestId: string;
}): Promise<string> {
  const config =
    resolveProvider(params.env, params.requestId) === 'openai'
      ? openAiChatConfig(params.env, params.requestId)
      : null;

  const geminiFallback = () =>
    translateTranscriptTurn({
      text: params.text,
      geminiApiKey: params.env.GEMINI_API_KEY,
      ...(params.env.GEMINI_TRANSLATION_MODEL
        ? { model: params.env.GEMINI_TRANSLATION_MODEL }
        : {}),
      ...(params.fetchFn ? { fetchFn: params.fetchFn } : {}),
    });

  return callWithFallback({
    requestId: params.requestId,
    primary: config
      ? () =>
          requestOpenAiCompatibleChat({
            config,
            system: TRANSLATION_SYSTEM_INSTRUCTION,
            messages: [{ role: 'user' as const, content: params.text }],
            temperature: 0.2,
            maxTokens: 512,
            maxContentLength: 1_500,
            ...(params.fetchFn ? { fetchFn: params.fetchFn } : {}),
          })
      : null,
    fallback: geminiFallback,
  });
}
