import { z } from 'zod';
import { PARTS_OF_SPEECH, type PartOfSpeech } from '../contracts/api.js';
import { normalizeText } from './normalize.js';

/**
 * Gemini Live tool declaration for `save_vocabulary` (`docs/04_GEMINI_SETUP.md` Section 4).
 */
export const SAVE_VOCABULARY_TOOL_DECLARATION = {
  name: 'save_vocabulary',
  // Persisting D1 is independent of the spoken turn; Live API may keep generating audio.
  behavior: 'NON_BLOCKING',
  description:
    'Call this tool whenever the learner explicitly asks what an English word/phrase means, asks for its Vietnamese translation, or asks how to say a term in English. For a Vietnamese insertion in an English sentence, call only when one vocabulary target and its English equivalent are clear; otherwise ask briefly and do not save. Do NOT call for ordinary conversation, Vietnamese fillers (à, ừ, nhỉ, hả, nhé...), or ambiguous targets.',
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

/** Compares spoken words without treating ASR punctuation as a different question. */
export function normalizeVocabularyQuestion(value: string): string {
  return (
    normalizeText(value)
      .replace(/’/g, "'")
      .match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)
      ?.join(' ') ?? ''
  );
}

const NAMED_LEARNER_QUESTION =
  /^(?:(?:the\s+)?(?:word|phrase|term)\s+)?["'“”‘’]?([a-zA-Z][a-zA-Z\s'-]{0,60}?)["'“”‘’]?\s*[,;:]?\s+(?:what\s+(?:does\s+)?)?(?:that|it|this)\s+means?\s*[?.!]*$/i;

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

function extractQuotedOrHighlightedCandidates(
  recentTurns: readonly ConversationContextTurn[],
): string[] {
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

const VIETNAMESE_DIACRITICS_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const VIETNAMESE_FILLERS = new Set([
  'a',
  'à',
  'ạ',
  'u',
  'ừ',
  'ha',
  'hả',
  'nhe',
  'nhé',
  'nhi',
  'nhỉ',
  'nha',
  'the',
  'thế',
  'vay',
  'vậy',
  'oi',
  'ơi',
  'dung khong',
  'đúng không',
  'phai khong',
  'phải không',
  'ne',
  'nè',
  'hen',
  'chu',
  'chứ',
  'duoc khong',
  'được không',
  'sao',
]);

const ENGLISH_CONTEXT_TOKENS = new Set([
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'her',
  'its',
  'our',
  'their',
  'this',
  'that',
  'these',
  'those',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'so',
  'because',
  'if',
  'to',
  'in',
  'on',
  'at',
  'for',
  'of',
  'with',
  'about',
  'by',
  'from',
  'as',
  'into',
  'like',
  'through',
  'after',
  'over',
  'between',
  'out',
  'against',
  'during',
  'without',
  'before',
  'under',
  'around',
  'among',
  'very',
  'really',
  'too',
  'just',
  'some',
  'any',
  'much',
  'many',
  'want',
  'need',
  'feel',
  'think',
  'know',
  'see',
  'look',
  'go',
  'come',
  'get',
  'make',
  'buy',
  'cut',
  'today',
  'yesterday',
  'tomorrow',
  'day',
  'time',
  'weather',
  'paper',
  'now',
]);

// This short allowlist supports common single-token inserts; unknown low-confidence tokens fail closed.
const VIETNAMESE_LEXICAL_WORDS = new Set([
  'bánh',
  'bực',
  'bội',
  'chào',
  'cái',
  'đầu',
  'đau',
  'đẹp',
  'dễ',
  'khó',
  'kéo',
  'mệt',
  'nghĩa',
  'nước',
  'phở',
  'quá',
  'rất',
  'tải',
  'tiếng',
  'việt',
]);
const VIETNAMESE_CONNECTORS = new Set(['oi']);

interface CodeSwitchToken {
  clean: string;
  hasDiacritics: boolean;
}

function hasStrongVietnameseOrthography(value: string): boolean {
  // A tone mark plus a second vowel mark is uncommon outside Vietnamese; normalize so
  // precomposed and decomposed ASR text use the same check.
  return /[đ]|[aeiouy]\p{M}{2,}/iu.test(value.normalize('NFD'));
}

function isTitleCasePhrase(tokens: readonly CodeSwitchToken[]): boolean {
  return tokens.length > 1 && tokens.every((token) => /^\p{Lu}/u.test(token.clean));
}

function extractCodeSwitchingTargets(utterance: string): string[] {
  const tokens: CodeSwitchToken[] = utterance
    .split(/\s+/)
    .map((token) => ({
      clean: token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''),
      hasDiacritics: VIETNAMESE_DIACRITICS_REGEX.test(token),
    }))
    .filter((token) => token.clean.length > 0);

  const englishWordCount = tokens.filter(
    (token) =>
      !token.hasDiacritics &&
      (ENGLISH_CONTEXT_TOKENS.has(token.clean.toLowerCase()) || /^[a-zA-Z]{3,}$/.test(token.clean)),
  ).length;
  if (englishWordCount < 2) return [];

  const groups: CodeSwitchToken[][] = [];
  let group: CodeSwitchToken[] = [];
  const flushGroup = () => {
    if (group.some((token) => token.hasDiacritics)) groups.push(group);
    group = [];
  };

  for (const token of tokens) {
    const isVietnameseCandidate =
      token.hasDiacritics || VIETNAMESE_CONNECTORS.has(token.clean.toLowerCase());
    if (isVietnameseCandidate) group.push(token);
    else flushGroup();
  }
  flushGroup();

  const candidates: string[] = [];
  for (const candidateTokens of groups) {
    const candidate = candidateTokens
      .map((token) => token.clean)
      .join(' ')
      .trim();
    const normalized = normalizeText(candidate);
    if (!candidate || VIETNAMESE_FILLERS.has(normalized)) continue;
    // Accented place/person names such as “Hà Nội” are not vocabulary targets.
    if (isTitleCasePhrase(candidateTokens)) continue;

    const hasKnownVietnameseWord = candidateTokens.some((token) =>
      VIETNAMESE_LEXICAL_WORDS.has(normalizeText(token.clean)),
    );
    const hasVietnameseLetterPattern = candidateTokens.some((token) =>
      hasStrongVietnameseOrthography(token.clean),
    );
    // Single-token candidates require a lexical cue; this avoids saving common pronouns
    // and foreign words just because one accented character looks Vietnamese.
    const hasSafeLexicalEvidence =
      hasKnownVietnameseWord || (candidateTokens.length > 1 && hasVietnameseLetterPattern);
    if (!hasSafeLexicalEvidence) continue;
    candidates.push(candidate);
  }
  return candidates;
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

  const namedQuestion = NAMED_LEARNER_QUESTION.exec(trimmed);
  const namedTarget = namedQuestion?.[1]?.trim();
  if (
    namedTarget &&
    !/^(?:i|you|we|they|he|she|it|this|that|what|how|can|could|would|do|does|did|is|are|please|tell|explain|define)\b/i.test(
      namedTarget,
    )
  ) {
    return {
      status: 'save',
      targetWord: namedTarget,
      sourceExcerpt: excerpt,
      reason: 'named_learner_inquiry',
    };
  }

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

  const codeSwitchTargets = extractCodeSwitchingTargets(trimmed);
  if (codeSwitchTargets.length > 1) {
    return {
      status: 'clarify',
      targetWord: null,
      sourceExcerpt: excerpt,
      reason: 'ambiguous_multiple_code_switch_targets',
    };
  }
  const codeSwitchTarget = codeSwitchTargets[0];
  if (codeSwitchTarget) {
    return {
      status: 'save',
      targetWord: codeSwitchTarget,
      sourceExcerpt: excerpt,
      reason: 'code_switching_insertion',
    };
  }

  return {
    status: 'ignore',
    targetWord: null,
    sourceExcerpt: excerpt,
    reason: 'ordinary_conversation',
  };
}

function containsVocabularyPhrase(text: string, phrase: string): boolean {
  const words = normalizeVocabularyQuestion(text).split(' ').filter(Boolean);
  const target = normalizeVocabularyQuestion(phrase).split(' ').filter(Boolean);
  if (target.length === 0 || target.length > words.length) return false;
  return words.some((_, start) => target.every((word, offset) => words[start + offset] === word));
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
  const trustedUserTurn = [...recentTurns].reverse().find((turn) => turn.speaker === 'user');
  if (
    !trustedUserTurn ||
    normalizeVocabularyQuestion(args.source_excerpt) !==
      normalizeVocabularyQuestion(trustedUserTurn.text.slice(0, 500))
  ) {
    return {
      allowed: false,
      reason: 'source_excerpt_does_not_match_user_turn',
      requiresClarification: false,
    };
  }
  const normalizedWord = normalizeText(args.word);
  if (PRONOUN_TARGETS.has(normalizedWord)) {
    return {
      allowed: false,
      reason: 'pronoun_target_not_resolved',
      requiresClarification: true,
    };
  }

  const decision = detectVocabularyIntent(trustedUserTurn.text, recentTurns);
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

  const isCodeSwitching = decision.reason === 'code_switching_insertion';
  const isTranslationToEnglish =
    /how\s+do\s+(?:i|you)\s+say\b|english\s+(?:word|term|phrase)\s+for\b|tiếng\s+anh.*nói\s+sao/i.test(
      trustedUserTurn.text,
    ) || isCodeSwitching;
  if (!isTranslationToEnglish && normalizeText(decision.targetWord ?? '') !== normalizedWord) {
    return {
      allowed: false,
      reason: 'tool_target_does_not_match_user_question',
      requiresClarification: true,
    };
  }
  if (
    isTranslationToEnglish &&
    !containsVocabularyPhrase(args.meaning_vi, decision.targetWord ?? '')
  ) {
    return {
      allowed: false,
      reason: 'translation_does_not_match_user_question',
      requiresClarification: true,
    };
  }
  if (
    isCodeSwitching &&
    (!/^[a-zA-Z][a-zA-Z' -]{0,119}$/.test(args.word) ||
      !args.example ||
      !containsVocabularyPhrase(args.example, args.word))
  ) {
    return {
      allowed: false,
      reason: 'invalid_code_switch_translation_shape',
      requiresClarification: true,
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
      source_excerpt: trustedUserTurn.text.trim().slice(0, 500),
    },
  };
}
