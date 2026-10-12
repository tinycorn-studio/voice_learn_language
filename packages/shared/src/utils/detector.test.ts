import { describe, expect, it } from 'vitest';
import {
  detectVocabularyIntent,
  escapeSpreadsheetFormula,
  formatLocalDateAsiaHoChiMinh,
  makeWordKey,
  normalizeText,
  validateSaveVocabularyToolCall,
  type ConversationContextTurn,
} from '../index.js';

interface UtteranceFixture {
  id: string;
  category: 'direct' | 'indirect' | 'ordinary';
  utterance: string;
  recentTurns?: readonly ConversationContextTurn[];
  expectedStatus: 'save' | 'clarify' | 'ignore';
  expectedTargetWord: string | null;
}

/**
 * 30 evaluation fixtures required by `docs/00_PRODUCT_SCOPE.md` (KPI line 29)
 * and `docs/13_MILESTONES.md` (`M1-03`):
 * - 10 direct vocabulary questions
 * - 10 indirect / pronoun referent questions (single antecedent vs ambiguous/missing)
 * - 10 ordinary conversation sentences that must NOT trigger saving
 */
const THIRTY_UTTERANCE_FIXTURES: readonly UtteranceFixture[] = [
  // === 10 DIRECT INQUIRIES ===
  {
    id: 'DIR-01',
    category: 'direct',
    utterance: 'What does overwhelmed mean?',
    expectedStatus: 'save',
    expectedTargetWord: 'overwhelmed',
  },
  {
    id: 'DIR-02',
    category: 'direct',
    utterance: 'What is the meaning of resilient?',
    expectedStatus: 'save',
    expectedTargetWord: 'resilient',
  },
  {
    id: 'DIR-03',
    category: 'direct',
    utterance: "What's the meaning of procrastination?",
    expectedStatus: 'save',
    expectedTargetWord: 'procrastination',
  },
  {
    id: 'DIR-04',
    category: 'direct',
    utterance: 'Can you define serendipity for me?',
    expectedStatus: 'save',
    expectedTargetWord: 'serendipity',
  },
  {
    id: 'DIR-05',
    category: 'direct',
    utterance: 'Can you explain the word meticulous?',
    expectedStatus: 'save',
    expectedTargetWord: 'meticulous',
  },
  {
    id: 'DIR-06',
    category: 'direct',
    utterance: 'What does the phrase break the ice mean?',
    expectedStatus: 'save',
    expectedTargetWord: 'break the ice',
  },
  {
    id: 'DIR-07',
    category: 'direct',
    utterance: 'Define ubiquitous.',
    expectedStatus: 'save',
    expectedTargetWord: 'ubiquitous',
  },
  {
    id: 'DIR-08',
    category: 'direct',
    utterance: '"eloquent" nghĩa là gì?',
    expectedStatus: 'save',
    expectedTargetWord: 'eloquent',
  },
  {
    id: 'DIR-09',
    category: 'direct',
    utterance: 'How do I say "quá tải" in English?',
    expectedStatus: 'save',
    expectedTargetWord: 'quá tải',
  },
  {
    id: 'DIR-10',
    category: 'direct',
    utterance: 'What is the English word for "kiên trì"?',
    expectedStatus: 'save',
    expectedTargetWord: 'kiên trì',
  },

  // === 10 INDIRECT / REFERENT INQUIRIES ===
  {
    id: 'IND-01',
    category: 'indirect',
    utterance: 'What does that mean?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'You handled that situation in a very "pragmatic" way.',
      },
    ],
    expectedStatus: 'save',
    expectedTargetWord: 'pragmatic',
  },
  {
    id: 'IND-02',
    category: 'indirect',
    utterance: 'What does that word mean?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'It was an ephemeral moment.',
        highlightedTerms: ['ephemeral'],
      },
    ],
    expectedStatus: 'save',
    expectedTargetWord: 'ephemeral',
  },
  {
    id: 'IND-03',
    category: 'indirect',
    utterance: 'Can you explain that?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'People often feel "burnout" after working nonstop.',
      },
    ],
    expectedStatus: 'save',
    expectedTargetWord: 'burnout',
  },
  {
    id: 'IND-04',
    category: 'indirect',
    utterance: 'What is the meaning of that?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'Let us look at the word "candid".',
      },
    ],
    expectedStatus: 'save',
    expectedTargetWord: 'candid',
  },
  {
    id: 'IND-05',
    category: 'indirect',
    utterance: 'Can you define it?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'His explanation was quite "ambiguous".',
      },
    ],
    expectedStatus: 'save',
    expectedTargetWord: 'ambiguous',
  },
  {
    id: 'IND-06',
    category: 'indirect',
    utterance: 'What does that mean?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'She is both "diligent" and "gregarious" at work.',
      },
    ],
    expectedStatus: 'clarify',
    expectedTargetWord: null,
  },
  {
    id: 'IND-07',
    category: 'indirect',
    utterance: 'What does that word mean?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'We discussed "mitigate" and "exacerbate" earlier.',
        highlightedTerms: ['mitigate', 'exacerbate'],
      },
    ],
    expectedStatus: 'clarify',
    expectedTargetWord: null,
  },
  {
    id: 'IND-08',
    category: 'indirect',
    utterance: 'What does that mean?',
    recentTurns: [],
    expectedStatus: 'clarify',
    expectedTargetWord: null,
  },
  {
    id: 'IND-09',
    category: 'indirect',
    utterance: 'Can you explain this word?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'How was your weekend trip to Da Nang?',
      },
    ],
    expectedStatus: 'clarify',
    expectedTargetWord: null,
  },
  {
    id: 'IND-10',
    category: 'indirect',
    utterance: 'What about that one?',
    recentTurns: [
      {
        speaker: 'assistant',
        text: 'You can use "concise" or "succinct".',
      },
    ],
    expectedStatus: 'clarify',
    expectedTargetWord: null,
  },

  // === 10 ORDINARY CONVERSATION UTTERANCES (MUST NOT SAVE) ===
  {
    id: 'ORD-01',
    category: 'ordinary',
    utterance: 'I feel overwhelmed today because of my workload.',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-02',
    category: 'ordinary',
    utterance: 'What do you mean by saying I should wake up earlier?',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-03',
    category: 'ordinary',
    utterance: 'Yesterday I went to the supermarket and bought some fruit.',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-04',
    category: 'ordinary',
    utterance: 'I think learning English by speaking every day is very helpful.',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-05',
    category: 'ordinary',
    utterance: 'Could we practice a job interview scenario for a software engineer?',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-06',
    category: 'ordinary',
    utterance: 'That makes a lot of sense, thank you for correcting my grammar!',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-07',
    category: 'ordinary',
    utterance: 'My favorite hobby is playing badminton with friends on Sunday.',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-08',
    category: 'ordinary',
    utterance: 'Let me try using the word resilient in my own sentence now.',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-09',
    category: 'ordinary',
    utterance: 'How is the weather in Ho Chi Minh City this week?',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
  {
    id: 'ORD-10',
    category: 'ordinary',
    utterance: 'I mean I usually drink coffee in the morning before work.',
    expectedStatus: 'ignore',
    expectedTargetWord: null,
  },
];

describe('M1-03 Vocabulary Intent Detector & Tool Call Validation (30 Fixtures)', () => {
  it('evaluates all 30 utterance fixtures with 0 false positives and 0 false negatives', () => {
    expect(THIRTY_UTTERANCE_FIXTURES.length).toBe(30);

    let falsePositives = 0;
    let falseNegatives = 0;

    for (const fixture of THIRTY_UTTERANCE_FIXTURES) {
      const result = detectVocabularyIntent(fixture.utterance, fixture.recentTurns ?? []);
      if (fixture.expectedStatus !== 'save' && result.status === 'save') {
        falsePositives++;
      }
      if (fixture.expectedStatus === 'save' && result.status !== 'save') {
        falseNegatives++;
      }
      expect(result.status, `Fixture ${fixture.id}: ${fixture.utterance}`).toBe(
        fixture.expectedStatus,
      );
      expect(result.targetWord, `Fixture ${fixture.id} targetWord`).toBe(
        fixture.expectedTargetWord,
      );
    }

    expect(falsePositives).toBe(0);
    expect(falseNegatives).toBe(0);
  });

  it('validates save_vocabulary tool call and produces structured sanitized output (TC-01)', () => {
    const validation = validateSaveVocabularyToolCall(
      {
        word: ' Overwhelmed ',
        lemma: 'overwhelm',
        part_of_speech: 'Adjective',
        sense_key: 'feeling unable to cope',
        meaning_vi: 'quá tải, choáng ngợp',
        example: 'I felt overwhelmed by the project deadline.',
        source_excerpt: 'What does overwhelmed mean?',
      },
      [{ speaker: 'user', text: 'What does overwhelmed mean?' }],
    );

    expect(validation.allowed).toBe(true);
    if (validation.allowed) {
      expect(validation.sanitized).toEqual({
        word: 'Overwhelmed',
        lemma: 'overwhelm',
        part_of_speech: 'adjective',
        sense_key: 'feeling_unable_to_cope',
        meaning_vi: 'quá tải, choáng ngợp',
        example: 'I felt overwhelmed by the project deadline.',
        source_excerpt: 'What does overwhelmed mean?',
      });
    }
  });

  it('rejects hallucinated save_vocabulary tool call on ordinary dialogue (TC-04)', () => {
    const validation = validateSaveVocabularyToolCall(
      {
        word: 'overwhelmed',
        meaning_vi: 'quá tải',
        source_excerpt: 'I feel overwhelmed today.',
      },
      [{ speaker: 'user', text: 'I feel overwhelmed today.' }],
    );

    expect(validation.allowed).toBe(false);
    if (!validation.allowed) {
      expect(validation.requiresClarification).toBe(false);
      expect(validation.reason).toBe('source_excerpt_lacks_explicit_intent');
    }
  });

  it('requests clarification when save_vocabulary is called on ambiguous "that" (TC-03)', () => {
    const validation = validateSaveVocabularyToolCall(
      {
        word: 'diligent',
        meaning_vi: 'chăm chỉ',
        source_excerpt: 'What does that mean?',
      },
      [
        {
          speaker: 'assistant',
          text: 'She is both "diligent" and "gregarious".',
        },
        { speaker: 'user', text: 'What does that mean?' },
      ],
    );

    expect(validation.allowed).toBe(false);
    if (!validation.allowed) {
      expect(validation.requiresClarification).toBe(true);
      expect(validation.reason).toBe('ambiguous_multiple_referents');
    }
  });

  it('normalizes word keys and escapes spreadsheet formulas (TC-06, TC-10)', () => {
    expect(normalizeText('  Overwhelmed   ')).toBe('overwhelmed');
    const key1 = makeWordKey({
      userId: 'telegram:123',
      lemma: 'Bank',
      partOfSpeech: 'Noun',
      senseKey: 'financial_institution',
    });
    const key2 = makeWordKey({
      userId: 'telegram:123',
      lemma: 'bank',
      partOfSpeech: 'noun',
      senseKey: 'river_edge',
    });
    expect(key1).toBe('telegram:123|bank|noun|financial_institution');
    expect(key2).toBe('telegram:123|bank|noun|river_edge');
    expect(key1).not.toBe(key2);

    expect(escapeSpreadsheetFormula('=IMPORTXML("https://evil.example", "//a")')).toBe(
      '\'=IMPORTXML("https://evil.example", "//a")',
    );
    expect(escapeSpreadsheetFormula('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(escapeSpreadsheetFormula('-1+2')).toBe("'-1+2");
    expect(escapeSpreadsheetFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeSpreadsheetFormula('Normal meaning text')).toBe('Normal meaning text');
  });

  it('R09 rejects mismatched targets and invented source excerpts; accepts explicitly requested translation', () => {
    const question = [{ speaker: 'user' as const, text: 'What does bank mean?' }];
    expect(
      validateSaveVocabularyToolCall(
        { word: 'elephant', meaning_vi: 'voi', source_excerpt: question[0]!.text },
        question,
      ).allowed,
    ).toBe(false);
    expect(
      validateSaveVocabularyToolCall(
        { word: 'elephant', meaning_vi: 'voi', source_excerpt: 'What does elephant mean?' },
        question,
      ).allowed,
    ).toBe(false);
    expect(
      validateSaveVocabularyToolCall({
        word: 'bank',
        meaning_vi: 'ngân hàng',
        source_excerpt: question[0]!.text,
      }).allowed,
    ).toBe(false);
    const translation = [{ speaker: 'user' as const, text: 'How do I say quá tải in English?' }];
    expect(
      validateSaveVocabularyToolCall(
        {
          word: 'overwhelmed',
          meaning_vi: 'quá tải, choáng ngợp',
          source_excerpt: translation[0]!.text,
        },
        translation,
      ).allowed,
    ).toBe(true);
  });

  it('formats UTC dates accurately in Asia/Ho_Chi_Minh (+07:00) across midnight (TC-13)', () => {
    // 2026-10-12 23:55 +07:00 is 2026-10-12T16:55:00.000Z
    expect(formatLocalDateAsiaHoChiMinh('2026-10-12T16:55:00.000Z')).toBe('2026-10-12');
    // 10 minutes later (00:05 +07:00 next day) is 2026-10-12T17:05:00.000Z
    expect(formatLocalDateAsiaHoChiMinh('2026-10-12T17:05:00.000Z')).toBe('2026-10-13');
  });
});
