import { z } from 'zod';
import { vocabularyItemSchema, type VocabularyItem } from '../contracts/api.js';
import { escapeSpreadsheetFormula } from './normalize.js';

export const WORDS_CSV_HEADERS = [
  'word_id',
  'user_id',
  'word_key',
  'word',
  'lemma',
  'part_of_speech',
  'sense_key',
  'meaning_vi',
  'ipa',
  'example',
  'source_excerpt',
  'created_at',
  'last_asked_at',
  'times_asked',
  'review_state',
  'repetitions',
  'interval_days',
  'ease_factor',
  'due_at',
  'last_reviewed_at',
  'version',
  'deleted_at',
] as const;

function escapeCsvCell(raw: string | number): string {
  const str = escapeSpreadsheetFormula(String(raw));
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(current);
      if (cells.some((cell) => cell.length > 0)) records.push([...cells]);
      cells.length = 0;
      current = '';
    } else {
      current += ch;
    }
  }
  if (inQuotes) throw new Error('CSV contains an unterminated quoted field');
  cells.push(current);
  if (cells.some((cell) => cell.length > 0)) records.push(cells);
  return records;
}

function unescapeFormulaPrefix(value: string): string {
  return /^'[\s]*[=+\-@]/.test(value) ? value.slice(1) : value;
}

/**
 * Exports a list of `VocabularyItem` records into a standard RFC-4180 CSV string
 * matching the `Words` tab schema (`docs/09_DATA_SCHEMA.md`, `M3-04`).
 */
export function exportVocabularyToCsv(items: readonly VocabularyItem[]): string {
  const lines: string[] = [WORDS_CSV_HEADERS.join(',')];
  for (const item of items) {
    const row = [
      item.word_id,
      item.user_id,
      item.word_key,
      item.word,
      item.lemma,
      item.part_of_speech,
      item.sense_key,
      item.meaning_vi,
      item.ipa,
      item.example,
      item.source_excerpt,
      item.created_at,
      item.last_asked_at,
      item.times_asked,
      item.review_state,
      item.repetitions,
      item.interval_days,
      item.ease_factor,
      item.due_at,
      item.last_reviewed_at,
      item.version,
      item.deleted_at,
    ].map(escapeCsvCell);
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

/**
 * Imports and validates `VocabularyItem` rows from a CSV backup string (`M3-04`).
 */
export function importVocabularyFromCsv(csvContent: string): VocabularyItem[] {
  if (csvContent.length > 2_000_000) throw new Error('CSV backup exceeds 2MB');
  const records = parseCsvRecords(csvContent.replace(/^\uFEFF/, ''));
  if (records.length === 0) {
    return [];
  }

  const headerCells = records[0]!;
  const indexMap = new Map<string, number>();
  headerCells.forEach((h, idx) => indexMap.set(h.trim(), idx));
  if (indexMap.size !== headerCells.length) throw new Error('Duplicate CSV header');

  for (const requiredCol of WORDS_CSV_HEADERS) {
    if (!indexMap.has(requiredCol)) {
      throw new Error(`Missing required CSV header column: ${requiredCol}`);
    }
  }

  const getCell = (cells: string[], col: string): string => {
    const idx = indexMap.get(col);
    return idx !== undefined ? (cells[idx] ?? '') : '';
  };

  const out: VocabularyItem[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i]!;
    if (cells.length !== headerCells.length)
      throw new Error(`CSV record ${i + 1} has an invalid column count`);
    const rawPos = getCell(cells, 'part_of_speech').trim().toLowerCase();
    const rawState = getCell(cells, 'review_state').trim().toLowerCase();
    const numberCell = (column: string): number => {
      const value = getCell(cells, column).trim();
      if (!value) throw new Error(`CSV record ${i + 1} has an empty ${column}`);
      return Number(value);
    };

    const word = unescapeFormulaPrefix(getCell(cells, 'word'));
    const item = {
      word_id: getCell(cells, 'word_id'),
      user_id: getCell(cells, 'user_id'),
      word_key: getCell(cells, 'word_key'),
      word,
      lemma: unescapeFormulaPrefix(getCell(cells, 'lemma')) || word.toLowerCase(),
      part_of_speech: rawPos,
      sense_key: unescapeFormulaPrefix(getCell(cells, 'sense_key')) || 'default',
      meaning_vi: unescapeFormulaPrefix(getCell(cells, 'meaning_vi')),
      ipa: unescapeFormulaPrefix(getCell(cells, 'ipa')),
      example: unescapeFormulaPrefix(getCell(cells, 'example')),
      source_excerpt: unescapeFormulaPrefix(getCell(cells, 'source_excerpt')),
      created_at: getCell(cells, 'created_at'),
      last_asked_at: getCell(cells, 'last_asked_at'),
      times_asked: numberCell('times_asked'),
      review_state: rawState,
      repetitions: numberCell('repetitions'),
      interval_days: numberCell('interval_days'),
      ease_factor: numberCell('ease_factor'),
      due_at: getCell(cells, 'due_at'),
      last_reviewed_at: getCell(cells, 'last_reviewed_at'),
      version: numberCell('version'),
      deleted_at: getCell(cells, 'deleted_at'),
    };
    for (const column of [
      'created_at',
      'last_asked_at',
      'due_at',
      'last_reviewed_at',
      'deleted_at',
    ] as const) {
      if ((column !== 'deleted_at' && column !== 'last_reviewed_at') || item[column] !== '') {
        if (!z.string().datetime().safeParse(item[column]).success) {
          throw new Error(`CSV record ${i + 1} has an invalid ${column}`);
        }
      }
    }
    out.push(vocabularyItemSchema.parse(item));
  }
  return out;
}
