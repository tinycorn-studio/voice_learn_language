import { describe, expect, it } from 'vitest';
import { exportVocabularyToCsv, importVocabularyFromCsv } from './csv.js';
import type { VocabularyItem } from '../contracts/api.js';
const ITEM: VocabularyItem = {
  word_id: 'w_synthetic',
  user_id: 'telegram:123',
  word_key: 'telegram:123|bank|noun|financial',
  word: 'bank',
  lemma: 'bank',
  part_of_speech: 'noun',
  sense_key: 'financial',
  meaning_vi: 'ngân hàng',
  ipa: '',
  example: 'First line\nSecond, "quoted" line\r\nThird line',
  source_excerpt: 'What does bank mean?',
  created_at: '2026-10-12T00:00:00.000Z',
  last_asked_at: '2026-10-12T00:00:00.000Z',
  times_asked: 1,
  review_state: 'new',
  repetitions: 0,
  interval_days: 0,
  ease_factor: 2.5,
  due_at: '2026-10-12T00:00:00.000Z',
  last_reviewed_at: '',
  version: 1,
  deleted_at: '',
};
describe('R08 CSV record parsing', () => {
  it('roundtrips multiline, quotes, commas, Unicode and formula prefixes as exactly one row', () => {
    expect(importVocabularyFromCsv(exportVocabularyToCsv([ITEM]))).toEqual([ITEM]);
    const formula = { ...ITEM, example: '=SUM(1,2)\nquoted "value"' };
    expect(importVocabularyFromCsv('\uFEFF' + exportVocabularyToCsv([formula]))).toEqual([formula]);
  });
  it('rejects malformed quoted records, invalid numbers/dates and missing headers', () => {
    const csv = exportVocabularyToCsv([ITEM]);
    expect(() => importVocabularyFromCsv(csv + '\n"unterminated')).toThrow(/unterminated/);
    expect(() =>
      importVocabularyFromCsv(exportVocabularyToCsv([{ ...ITEM, repetitions: Number.NaN }])),
    ).toThrow();
    expect(() =>
      importVocabularyFromCsv(exportVocabularyToCsv([{ ...ITEM, repetitions: -1 }])),
    ).toThrow();
    expect(() =>
      importVocabularyFromCsv(exportVocabularyToCsv([{ ...ITEM, ease_factor: 4 }])),
    ).toThrow();
    expect(() =>
      importVocabularyFromCsv(exportVocabularyToCsv([{ ...ITEM, due_at: 'invalid-date' }])),
    ).toThrow(/due_at/);
    expect(() => importVocabularyFromCsv('word,meaning_vi\nbank,ngan hang')).toThrow(/header/);
  });
});
