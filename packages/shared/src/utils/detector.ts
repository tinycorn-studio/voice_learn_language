import { z } from 'zod';
import { PARTS_OF_SPEECH, type PartOfSpeech } from '../contracts/api.js';
import { normalizeText } from './normalize.js';

/**
 * Gemini Live tool declaration for `save_vocabulary` (`docs/04_GEMINI_SETUP.md` Section 4).
 */
export const SAVE_VOCABULARY_TOOL_DECLARATION = {
  name: 'save_vocabulary',
  description:
    'Call this tool ONLY when the learner explicitly asks what an English word/phrase means, asks for its Vietnamese translation, or asks how to say a term in English. Do NOT call for ordinary conversation or when "that/it" has multiple ambiguous referents.',
  parameters: {
    type: 'OBJECT',
    properties: {
      word: {
        type: 'STRING',
        description: 'The target English word or short phrase the user asked to learn.',
      },
      lemma: {
        type: 'STRING',
        description: 'Base dictionary form (lemma) of the English word or phrase.',
      },
      part_of_speech: {
        type: 'STRING',
        description:
          'Part of speech: noun, verb, adjective, adverb, phrase, idiom, preposition, conjunction, pronoun, interjection, or unknown.',
      },
      sense_key: {
        type: 'STRING',
        description: 'Short snake_case identifier distinguishing this specific meaning/sense.',
      },
      meaning_vi: {
        type: 'STRING',
        description: 'Concise Vietnamese meaning matching the conversation context.',
      },
      example: {
        type: 'STRING',
        description: 'Short natural English example sentence using the word.',
      },
      source_excerpt: {
        type: 'STRING',
        description: 'The exact user question or turn excerpt that triggered saving.',
      },
    },
    required: ['word', 'meaning_vi', 'source_excerpt'],
  },
} as const;

export const saveVocabularyToolArgsSchema = z.object({
  word: z.string().trim().min(1).max(120),
  lemma: z.string().trim().min(1).max(120).optional(),
  part_of_speech: z.string().trim().optional(),
  sense_key: z.string().trim().max(100).optional(),
  meaning_vi: z.string().trim().max(300).default(''),
  example: z.string().trim().max(500).optional(),
  source_excerpt: z.string().trim().max(500).default(''),
});

export type SaveVocabularyToolArgs = z.infer<typeof saveVocabularyToolArgsSchema>;

export type IntentResolutionStatus = 'save' | 'clarify' | 'ignore';

export interface VocabularyIntentDecision {
  status: IntentResolutionStatus;
  targetWord: string | null;
  sourceExcerpt: string;
  reason: string;
}

export interface ConversationContextTurn {
  speaker: 'user' | 'assistant';
  text: string;
  highlightedTerms?: readonly string[];
}

const PRONOUN_TARGETS = new Set(['that', 'it', 'this', 'that word', 'this word', 'the word']);

const DIRECT_PATTERNS: readonly RegExp[] = [
  /what\s+does\s+(?:the\s+(?:word|phrase|idiom|term)\s+)?["'“”‘’]?([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]?\s+mean\b/i,
  /what(?:'s|\s+is)\s+the\s+meaning\s+of\s+(?:the\s+(?:word|phrase|idiom|term)\s+)?["'“”‘’]?([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]?(?:[?.!]|$)/i,
  /what\s+is\s+["'“”‘’]([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]\s+in\s+vietnamese\b/i,
  /can\s+you\s+(?:define|explain)\s+(?:the\s+(?:word|phrase|idiom|term)\s+)?["'“”‘’]?([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]?(?:\s+for\s+me|\s+to\s+me)?(?:[?.!]|$)/i,
  /define\s+["'“”‘’]?([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]?(?:[?.!]|$)/i,
  /["'“”‘’]?([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]?\s+nghĩa\s+là\s+gì/i,
  /nghĩa\s+của\s+từ\s+["'“”‘’]?([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]?\s+là\s+gì/i,
  /how\s+do\s+(?:i|you)\s+say\s+["'“”‘’]?([^?.!"]+)["'“”‘’]?\s+in\s+english/i,
  /what\s+is\s+the\s+english\s+(?:word|term|phrase)\s+for\s+["'“”‘’]?([^?.!"]+)["'“”‘’]?(?:[?.!]|$)/i,
  /tiếng\s+anh\s+["'“”‘’]?([^?.!"]+)["'“”‘’]?\s+nói\s+sao/i,
];

const PRONOUN_QUESTION_PATTERNS: readonly RegExp[] = [
  /^what\s+does\s+(that|it|this|that\s+word|this\s+word|that\s+phrase)\s+mean\b/i,
  /^what(?:'s|\s+is)\s+the\s+meaning\s+of\s+(that|it|this|that\s+word|this\s+word)\b/i,
  /^can\s+you\s+(?:define|explain)\s+(that|it|this|that\s+word|this\s+word)\b/i,
  /^what\s+about\s+(?:the\s+second\s+word|that\s+one)\b/i,
];

function extractQuotedOrHighlightedCandidates(recentTurns: readonly ConversationContextTurn[]): string[] {
  const lastAssistant = [...recentTurns].reverse().find((t) => t.speaker === 'assistant');
  if (!lastAssistant) {
    return [];
  }
  if (lastAssistant.highlightedTerms && lastAssistant.highlightedTerms.length > 0) {
    return lastAssistant.highlightedTerms.map((t) => t.trim()).filter(Boolean);
  }
  const matches: string[] = [];
  const quoteRegex = /["'“”‘’*]([a-zA-Z][a-zA-Z\s'-]{1,40})["'“”‘’*]/g;
  let match: RegExpExecArray | null = quoteRegex.exec(lastAssistant.text);
  while (match !== null) {
    const candidate = match[1]?.trim();
    if (candidate && !matches.includes(candidate)) {
      matches.push(candidate);
    }
    match = quoteRegex.exec(lastAssistant.text);
  }
  return matches;
}

/**
 * Pure deterministic vocabulary intent detector (`M1-03`, `docs/00_PRODUCT_SCOPE.md` US-02).
 *
 * Evaluates a user utterance + recent conversation turns to decide:
 * - `save`: Explicit vocabulary inquiry with an unambiguous target word/phrase.
 * - `clarify`: Indirect pronoun inquiry ("What does that mean?") where 0 or >=2 candidate words exist.
 * - `ignore`: Ordinary conversational statement without explicit vocabulary-learning intent.
 */
export function detectVocabularyIntent(
  utterance: string,
  recentTurns: readonly ConversationContextTurn[] = [],
): VocabularyIntentDecision {
  const trimmed = utterance.trim();
  if (!trimmed) {
    return {
      status: 'ignore',
      targetWord: null,
      sourceExcerpt: '',
      reason: 'empty_utterance',
    };
  }

  const excerpt = trimmed.slice(0, 500);

  // 1. Check indirect pronoun/referent questions first so "What does that mean?" doesn't save literal "that".
  for (const pattern of PRONOUN_QUESTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      const candidates = extractQuotedOrHighlightedCandidates(recentTurns);
      if (candidates.length === 1 && candidates[0]) {
        return {
          status: 'save',
          targetWord: candidates[0],
          sourceExcerpt: excerpt,
          reason: 'resolved_single_referent',
        };
      }
      return {
        status: 'clarify',
        targetWord: null,
        sourceExcerpt: excerpt,
        reason: candidates.length === 0 ? 'missing_referent' : 'ambiguous_multiple_referents',
      };
    }
  }

  // 2. Check direct vocabulary inquiry patterns.
  for (const pattern of DIRECT_PATTERNS) {
    const match = pattern.exec(trimmed);
    const rawTarget = match?.[1]?.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
    if (rawTarget) {
      const normalizedTarget = normalizeText(rawTarget);
      if (PRONOUN_TARGETS.has(normalizedTarget)) {
        const candidates = extractQuotedOrHighlightedCandidates(recentTurns);
        if (candidates.length === 1 && candidates[0]) {
          return {
            status: 'save',
            targetWord: candidates[0],
            sourceExcerpt: excerpt,
            reason: 'resolved_single_referent',
          };
        }
        return {
          status: 'clarify',
          targetWord: null,
          sourceExcerpt: excerpt,
          reason: candidates.length === 0 ? 'missing_referent' : 'ambiguous_multiple_referents',
        };
      }

      return {
        status: 'save',
        targetWord: rawTarget,
        sourceExcerpt: excerpt,
        reason: 'explicit_vocabulary_inquiry',
      };
    }
  }

  return {
    status: 'ignore',
    targetWord: null,
    sourceExcerpt: excerpt,
    reason: 'ordinary_conversation',
  };
}

/**
 * Sanitizes and validates model-supplied `save_vocabulary` tool call arguments against our
 * deterministic detector rules so hallucinated or ambiguous tool calls never persist (`AGENTS.md` Section 2 & 5).
 */
export function validateSaveVocabularyToolCall(
  rawArgs: unknown,
  recentTurns: readonly ConversationContextTurn[] = [],
):
  | {
      allowed: true;
      sanitized: {
        word: string;
        lemma: string;
        part_of_speech: PartOfSpeech;
        sense_key: string;
        meaning_vi: string;
        example: string;
        source_excerpt: string;
      };
    }
  | {
      allowed: false;
      reason: string;
      requiresClarification: boolean;
    } {
  const parsed = saveVocabularyToolArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      allowed: false,
      reason: 'invalid_tool_arguments',
      requiresClarification: false,
    };
  }

  const args = parsed.data;
  const normalizedWord = normalizeText(args.word);
  if (PRONOUN_TARGETS.has(normalizedWord)) {
    return {
      allowed: false,
      reason: 'pronoun_target_not_resolved',
      requiresClarification: true,
    };
  }

  const decision = detectVocabularyIntent(args.source_excerpt, recentTurns);
  if (decision.status === 'clarify') {
    return {
      allowed: false,
      reason: decision.reason,
      requiresClarification: true,
    };
  }
  if (decision.status === 'ignore') {
    return {
      allowed: false,
      reason: 'source_excerpt_lacks_explicit_intent',
      requiresClarification: false,
    };
  }

  const rawPos = normalizeText(args.part_of_speech ?? 'unknown');
  const pos: PartOfSpeech = (PARTS_OF_SPEECH as readonly string[]).includes(rawPos)
    ? (rawPos as PartOfSpeech)
    : 'unknown';

  const senseKey = args.sense_key ? normalizeText(args.sense_key).replace(/\s+/g, '_') : 'default';

  return {
    allowed: true,
    sanitized: {
      word: args.word.trim(),
      lemma: (args.lemma ?? args.word).trim().toLowerCase(),
      part_of_speech: pos,
      sense_key: senseKey || 'default',
      meaning_vi: args.meaning_vi.trim(),
      example: (args.example ?? '').trim(),
      source_excerpt: args.source_excerpt.trim(),
    },
  };
}
