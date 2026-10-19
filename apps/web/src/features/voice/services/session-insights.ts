import type { ConversationContextTurn } from '@voice-chat/shared';
import type { CoachCorrection } from './coaching.js';

export interface SessionInsights {
  estimatedSpeechSeconds: number | null;
  totalLearnerWords: number;
  uniqueLearnerWords: number;
  vocabularyDiversity: number | null;
  correctionsByCategory: Readonly<Record<CoachCorrection['category'], number>>;
  suggestedPhrases: readonly string[];
}

/** Builds a bounded, local-only report from the current session's completed turns. */
export function buildSessionInsights(
  turns: readonly Pick<ConversationContextTurn, 'speaker' | 'text'>[],
  speechActiveMs: number,
  corrections: readonly CoachCorrection[],
): SessionInsights {
  const learnerText = turns
    .filter((turn) => turn.speaker === 'user')
    .map((turn) => turn.text)
    .join(' ');
  const tokens = learnerText.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
  const uniqueWords = new Set(tokens.map((token) => token.toLocaleLowerCase('en-US')));
  const correctionCounts: Record<CoachCorrection['category'], number> = {
    grammar: 0,
    word_choice: 0,
    pronunciation: 0,
  };
  const phrases = new Map<string, string>();

  for (const correction of corrections.slice(-20)) {
    correctionCounts[correction.category]++;
    const key = correction.suggested_sentence.trim().toLocaleLowerCase('en-US');
    if (key && !phrases.has(key)) phrases.set(key, correction.suggested_sentence.trim());
  }

  return {
    estimatedSpeechSeconds:
      Number.isFinite(speechActiveMs) && speechActiveMs > 0
        ? Math.round(speechActiveMs / 1000)
        : null,
    totalLearnerWords: tokens.length,
    uniqueLearnerWords: uniqueWords.size,
    vocabularyDiversity: tokens.length > 0 ? uniqueWords.size / tokens.length : null,
    correctionsByCategory: correctionCounts,
    suggestedPhrases: [...phrases.values()].slice(0, 3),
  };
}
