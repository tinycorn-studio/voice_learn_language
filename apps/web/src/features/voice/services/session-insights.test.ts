import { describe, expect, it } from 'vitest';
import { buildSessionInsights } from './session-insights.js';

describe('session insights', () => {
  it('summarizes learner words, estimated speech time, categories and unique phrases', () => {
    const report = buildSessionInsights(
      [
        { speaker: 'user', text: 'I went to work and I felt ready.' },
        { speaker: 'assistant', text: 'That sounds great.' },
        { speaker: 'user', text: 'I felt ready.' },
      ],
      125_000,
      [
        {
          source_excerpt: 'I go yesterday',
          learner_phrase: 'I go yesterday',
          suggested_sentence: 'I went yesterday.',
          focus_phrase: 'went',
          category: 'grammar',
        },
        {
          source_excerpt: 'I go yesterday',
          learner_phrase: 'I go yesterday',
          suggested_sentence: 'I went yesterday.',
          focus_phrase: 'went',
          category: 'grammar',
        },
        {
          source_excerpt: 'I say a wrong word',
          learner_phrase: 'wrong word',
          suggested_sentence: 'I used the wrong word.',
          focus_phrase: 'used the wrong word',
          category: 'word_choice',
        },
      ],
    );

    expect(report.estimatedSpeechSeconds).toBe(125);
    expect(report.totalLearnerWords).toBe(11);
    expect(report.uniqueLearnerWords).toBe(7);
    expect(report.vocabularyDiversity).toBe(7 / 11);
    expect(report.correctionsByCategory).toEqual({ grammar: 2, word_choice: 1, pronunciation: 0 });
    expect(report.suggestedPhrases).toEqual(['I went yesterday.', 'I used the wrong word.']);
  });

  it('keeps missing speech and transcript metrics unavailable instead of inventing a score', () => {
    const report = buildSessionInsights([], 0, []);
    expect(report.estimatedSpeechSeconds).toBeNull();
    expect(report.totalLearnerWords).toBe(0);
    expect(report.uniqueLearnerWords).toBe(0);
    expect(report.vocabularyDiversity).toBeNull();
    expect(report.suggestedPhrases).toEqual([]);
  });

  it('caps report phrases and correction processing to the latest three and twenty', () => {
    const corrections = Array.from({ length: 24 }, (_unused, index) => ({
      source_excerpt: 'I said a sentence',
      learner_phrase: 'a sentence',
      suggested_sentence: `Suggested phrase ${index}`,
      focus_phrase: `phrase ${index}`,
      category: 'grammar' as const,
    }));
    const report = buildSessionInsights([], 1, corrections);
    expect(report.correctionsByCategory.grammar).toBe(20);
    expect(report.suggestedPhrases).toEqual([
      'Suggested phrase 4',
      'Suggested phrase 5',
      'Suggested phrase 6',
    ]);
  });
});
