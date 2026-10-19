import { z } from 'zod';
import { normalizeVocabularyQuestion } from '@voice-chat/shared';

export const COACH_CORRECTION_TOOL_DECLARATION = {
  name: 'coach_correction',
  behavior: 'NON_BLOCKING',
  description:
    'Create one short, structured, session-only coaching note when the learner has a clear grammar or word-choice issue, or a clearly audible pronunciation issue. Never call for a correct sentence, ordinary accent variation, or an uncertain audio signal. This tool does not save vocabulary or persist data.',
  parameters: {
    type: 'OBJECT',
    properties: {
      source_excerpt: {
        type: 'STRING',
        description: 'Copy the complete latest learner transcript exactly.',
      },
      learner_phrase: {
        type: 'STRING',
        description: 'A short exact phrase from source_excerpt to coach.',
      },
      suggested_sentence: {
        type: 'STRING',
        description: 'A concise, natural sentence the learner can repeat.',
      },
      focus_phrase: {
        type: 'STRING',
        description: 'The exact short phrase inside suggested_sentence to highlight.',
      },
      category: {
        type: 'STRING',
        enum: ['grammar', 'word_choice', 'pronunciation'],
        description: 'The main coaching category.',
      },
      pronunciation_tip: {
        type: 'STRING',
        description: 'One brief actionable tip, required only for clear pronunciation coaching.',
      },
    },
    required: [
      'source_excerpt',
      'learner_phrase',
      'suggested_sentence',
      'focus_phrase',
      'category',
    ],
  },
} as const;

const coachCorrectionArgsSchema = z.object({
  source_excerpt: z.string().trim().min(1).max(500),
  learner_phrase: z.string().trim().min(1).max(180),
  suggested_sentence: z.string().trim().min(1).max(300),
  focus_phrase: z.string().trim().min(1).max(120),
  category: z.enum(['grammar', 'word_choice', 'pronunciation']),
  pronunciation_tip: z.string().trim().max(180).optional(),
});

export type CoachCorrection = z.infer<typeof coachCorrectionArgsSchema>;

/** Accepts only short coaching grounded in the latest user transcript. */
export function validateCoachCorrection(
  raw: unknown,
  latestUserTurn: string,
): CoachCorrection | null {
  const parsed = coachCorrectionArgsSchema.safeParse(raw);
  if (!parsed.success || !latestUserTurn.trim()) return null;

  const source = normalizeVocabularyQuestion(parsed.data.source_excerpt);
  const latest = normalizeVocabularyQuestion(latestUserTurn);
  const learnerPhrase = normalizeVocabularyQuestion(parsed.data.learner_phrase);
  const suggested = normalizeVocabularyQuestion(parsed.data.suggested_sentence);
  const focus = normalizeVocabularyQuestion(parsed.data.focus_phrase);
  if (
    !source ||
    source !== latest ||
    !learnerPhrase ||
    !source.includes(learnerPhrase) ||
    !suggested ||
    !focus ||
    !suggested.includes(focus)
  )
    return null;
  if (
    !parsed.data.suggested_sentence
      .toLocaleLowerCase('en-US')
      .includes(parsed.data.focus_phrase.toLocaleLowerCase('en-US'))
  )
    return null;

  if (parsed.data.category === 'pronunciation' && !parsed.data.pronunciation_tip?.trim())
    return null;
  if (parsed.data.category !== 'pronunciation' && learnerPhrase === suggested) return null;

  return parsed.data;
}
