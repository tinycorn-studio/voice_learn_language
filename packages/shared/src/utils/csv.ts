import {
  PARTS_OF_SPEECH,
  REVIEW_STATES,
  type PartOfSpeech,
  type ReviewState,
  type VocabularyItem,
} from '../contracts/api.js';
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

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
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
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
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
  const rawLines = csvContent
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (rawLines.length <= 1) {
    return [];
  }

  const headerCells = parseCsvLine(rawLines[0]!);
  const indexMap = new Map<string, number>();
  headerCells.forEach((h, idx) => indexMap.set(h.trim(), idx));

  for (const requiredCol of ['word_id', 'user_id', 'word', 'meaning_vi']) {
    if (!indexMap.has(requiredCol)) {
      throw new Error(`Missing required CSV header column: ${requiredCol}`);
    }
  }

  const getCell = (cells: string[], col: string): string => {
    const idx = indexMap.get(col);
    return idx !== undefined ? (cells[idx] ?? '') : '';
  };

  const out: VocabularyItem[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cells = parseCsvLine(rawLines[i]!);
    const rawPos = getCell(cells, 'part_of_speech').trim().toLowerCase();
    const pos: PartOfSpeech = (PARTS_OF_SPEECH as readonly string[]).includes(rawPos)
      ? (rawPos as PartOfSpeech)
      : 'unknown';

    const rawState = getCell(cells, 'review_state').trim().toLowerCase();
    const reviewState: ReviewState = (REVIEW_STATES as readonly string[]).includes(rawState)
      ? (rawState as ReviewState)
      : 'new';

    const word = unescapeFormulaPrefix(getCell(cells, 'word'));
    out.push({
      word_id: getCell(cells, 'word_id'),
      user_id: getCell(cells, 'user_id'),
      word_key: getCell(cells, 'word_key'),
      word,
      lemma: unescapeFormulaPrefix(getCell(cells, 'lemma')) || word.toLowerCase(),
      part_of_speech: pos,
      sense_key: unescapeFormulaPrefix(getCell(cells, 'sense_key')) || 'default',
      meaning_vi: unescapeFormulaPrefix(getCell(cells, 'meaning_vi')),
      ipa: unescapeFormulaPrefix(getCell(cells, 'ipa')),
      example: unescapeFormulaPrefix(getCell(cells, 'example')),
      source_excerpt: unescapeFormulaPrefix(getCell(cells, 'source_excerpt')),
      created_at: getCell(cells, 'created_at'),
      last_asked_at: getCell(cells, 'last_asked_at'),
      times_asked: Math.max(1, Number(getCell(cells, 'times_asked') || '1')),
      review_state: reviewState,
      repetitions: Math.max(0, Number(getCell(cells, 'repetitions') || '0')),
      interval_days: Math.max(0, Number(getCell(cells, 'interval_days') || '0')),
      ease_factor: Math.min(3.0, Math.max(1.3, Number(getCell(cells, 'ease_factor') || '2.5'))),
      due_at: getCell(cells, 'due_at'),
      last_reviewed_at: getCell(cells, 'last_reviewed_at'),
      version: Math.max(1, Number(getCell(cells, 'version') || '1')),
      deleted_at: getCell(cells, 'deleted_at'),
    });
  }
  return out;
}
