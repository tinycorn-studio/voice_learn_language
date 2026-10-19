import { describe, expect, it } from 'vitest';
import { validateCoachCorrection } from './coaching.js';

const validCorrection = {
  source_excerpt: 'I go to cinema yesterday.',
  learner_phrase: 'I go to cinema yesterday',
  suggested_sentence: 'I went to the cinema yesterday.',
  focus_phrase: 'went to the cinema',
  category: 'grammar',
};

describe('coach correction validation', () => {
  it('accepts a short correction grounded in the latest transcript', () => {
    expect(validateCoachCorrection(validCorrection, 'I go to cinema yesterday.')).toEqual(
      validCorrection,
    );
  });

  it('allows transcript punctuation differences but rejects another turn or an invented phrase', () => {
    expect(validateCoachCorrection(validCorrection, 'I go to cinema yesterday')).not.toBeNull();
    expect(validateCoachCorrection(validCorrection, 'I went to a party yesterday')).toBeNull();
    expect(
      validateCoachCorrection(
        { ...validCorrection, learner_phrase: 'I visited a museum' },
        'I go to cinema yesterday.',
      ),
    ).toBeNull();
  });

  it('requires the highlighted phrase in the suggestion and a tip for pronunciation', () => {
    expect(
      validateCoachCorrection(
        { ...validCorrection, focus_phrase: 'beautifully spoken' },
        validCorrection.source_excerpt,
      ),
    ).toBeNull();
    expect(
      validateCoachCorrection(
        {
          ...validCorrection,
          category: 'pronunciation',
          suggested_sentence: validCorrection.source_excerpt,
          learner_phrase: 'cinema yesterday',
          focus_phrase: 'cinema yesterday',
        },
        validCorrection.source_excerpt,
      ),
    ).toBeNull();
  });

  it('rejects malformed and oversized payloads', () => {
    expect(
      validateCoachCorrection(
        { ...validCorrection, focus_phrase: '' },
        validCorrection.source_excerpt,
      ),
    ).toBeNull();
    expect(
      validateCoachCorrection(
        { ...validCorrection, suggested_sentence: 'x'.repeat(301) },
        validCorrection.source_excerpt,
      ),
    ).toBeNull();
  });
});
