import { z } from 'zod';
import {
  createInitialFsrsCard,
  dueReviewCardSchema,
  fsrsCardSchema,
  fsrsConfigSchema,
  normalizeText,
  previewCardToResponse,
  scheduleNextFsrsReview,
  vocabularyItemSchema,
  vocabularyCreateResponseSchema,
  reviewSubmitResponseSchema,
  reviewStatsResponseSchema,
  type FsrsCard,
  type FsrsConfig,
  type VocabularyItem,
  type VocabularyCreateRequest,
  type VocabularyCreateResponse,
  type VocabularyListQuery,
  type VocabularyListResponse,
  type VocabularyUpdateRequest,
  type DueReviewCard,
  type ReviewSubmitRequest,
  type ReviewSubmitResponse,
  type ReviewPreviewResponse,
  type ReviewStatsResponse,
  type MirrorEntity,
} from '@voice-chat/shared';
import { AppError, logStructured } from '../domain/env.js';
import type {
  VocabularyRepository,
  ReviewRepository,
  DailyDigestClaimResult,
  TelegramMutationContext,
} from '../domain/repositories.js';
import { clearGuard, writeGuard, type DatabaseBinding, type Statement } from './d1-database.js';
import { signGasPayload } from './gas-client.js';
import {
  acceptTelegramCommand,
  formatReviewResult,
  telegramMutationStatements,
} from './telegram-delivery-store.js';

type Row = Record<string, unknown>;
function storedJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AppError({ code: 'UPSTREAM_ERROR', message: 'Invalid stored JSON', status: 502 });
  }
}
const jsonRow = z.object({ record_json: z.string() });
const eventRow = z.object({
  user_id: z.string(),
  action: z.string(),
  payload_hash: z.string(),
  fingerprint_scheme: z.string(),
  result_json: z.string().nullable(),
});
const userSchema = z.object({
  user_id: z.string(),
  telegram_chat_id: z.string(),
  timezone: z.string(),
  notifications_enabled: z.boolean(),
  daily_review_limit: z.number().int().positive(),
  reminder_local_hour: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().nonnegative().default(0),
});
const dispatchSchema = z.object({
  dispatch_id: z.string(),
  user_id: z.string(),
  local_date: z.string(),
  status: z.enum(['claimed', 'sent', 'failed', 'unknown', 'skipped']),
  claimed_at: z.string(),
  sent_at: z.string(),
  message_id: z.union([z.string(), z.number()]),
  last_error: z.string(),
  attempt_count: z.number().int().nonnegative(),
  claim_token: z.string(),
  version: z.number().int().nonnegative().default(0),
});
function dispatchMirrorStatement(
  db: DatabaseBinding,
  row: z.infer<typeof dispatchSchema>,
  now: string,
): Statement {
  return db
    .prepare(
      'INSERT INTO sync_outbox(event_id,payload_json,committed_at,next_attempt_at) VALUES (?,?,?,?)',
    )
    .bind(
      `dispatch_${row.dispatch_id}_${row.version}`,
      JSON.stringify({
        event_id: `dispatch_${row.dispatch_id}_${row.version}`,
        entities: [{ tab: 'DailyDispatchLog', id: row.dispatch_id, version: row.version, row }],
      }),
      now,
      now,
    );
}
const legacyState = (card: FsrsCard): VocabularyItem['review_state'] =>
  card.state === 'New' ? 'new' : card.state === 'Review' ? 'review' : 'learning';
const activeWord = "w.deleted_at='' AND json_extract(w.record_json,'$.review_state')!='suspended'";

function parse<T>(value: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError({ code: 'UPSTREAM_ERROR', message: 'Invalid stored data', status: 502 });
  return result.data;
}
function decode<T>(row: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  try {
    return parse(storedJson(parse(row, jsonRow).record_json) as unknown, schema);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({ code: 'UPSTREAM_ERROR', message: 'Invalid stored data', status: 502 });
  }
}
const conflict = () =>
  new AppError({ code: 'CONFLICT', message: 'Data changed; reload and try again', status: 409 });
const notFound = () =>
  new AppError({ code: 'NOT_FOUND', message: 'Requested item not found', status: 404 });

/** D1 authority. Every durable mutation includes its replay result and mirror job in one batch. */
export class D1RepositoryAdapter implements VocabularyRepository, ReviewRepository {
  public constructor(
    public readonly db: DatabaseBinding,
    private readonly fingerprintKey: string,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  public async fingerprint(action: string, userId: string, data: Row): Promise<string> {
    // Exact GAS field order is intentional: imported Events must still replay across cutover.
    return signGasPayload(JSON.stringify({ action, user_id: userId, data }), this.fingerprintKey);
  }
  private eventLookupStatement(eventId: string): Statement {
    return this.db
      .prepare(
        'SELECT user_id,action,payload_hash,fingerprint_scheme,result_json FROM events WHERE event_id=?',
      )
      .bind(eventId);
  }
  private resolveReplay<T>(
    raw: unknown,
    userId: string,
    action: string,
    hash: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): T | null {
    if (!raw) return null;
    const event = parse(raw, eventRow);
    if (
      event.user_id !== userId ||
      event.action !== action ||
      event.payload_hash !== hash ||
      event.fingerprint_scheme === 'legacy-unverified' ||
      !event.result_json
    )
      throw conflict();
    const result = parse(storedJson(event.result_json) as unknown, schema);
    if (typeof result === 'object' && result !== null && 'duplicate_event' in result)
      return {
        ...result,
        duplicate_event: true,
        ...('idempotent_replay' in result ? { idempotent_replay: true } : {}),
      };
    return result;
  }
  private async replay<T>(
    eventId: string,
    userId: string,
    action: string,
    hash: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T | null> {
    return this.resolveReplay(
      await this.eventLookupStatement(eventId).first(),
      userId,
      action,
      hash,
      schema,
    );
  }
  public wordStatement(word: VocabularyItem): Statement {
    const value = parse(word, vocabularyItemSchema);
    return this.db
      .prepare(
        `INSERT INTO words(word_id,user_id,word_key,created_at,deleted_at,version,record_json)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(word_id) DO UPDATE SET word_key=excluded.word_key,
      deleted_at=excluded.deleted_at,version=excluded.version,record_json=excluded.record_json`,
      )
      .bind(
        value.word_id,
        value.user_id,
        value.word_key,
        value.created_at,
        value.deleted_at,
        value.version,
        JSON.stringify(value),
      );
  }
  public cardStatement(card: FsrsCard): Statement {
    const value = parse(card, fsrsCardSchema);
    return this.db
      .prepare(
        `INSERT INTO cards(card_id,user_id,word_id,due_at_utc,state,is_suspended,row_version,record_json)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET due_at_utc=excluded.due_at_utc,
      state=excluded.state,is_suspended=excluded.is_suspended,row_version=excluded.row_version,record_json=excluded.record_json`,
      )
      .bind(
        value.card_id,
        value.user_id,
        value.word_id,
        value.due_at_utc,
        value.state,
        value.is_suspended ? 1 : 0,
        value.row_version,
        JSON.stringify(value),
      );
  }
  private async commit<T>(params: {
    eventId: string;
    userId: string;
    requestId: string;
    action: string;
    hash: string;
    entityId: string;
    result: T;
    statements: Statement[];
    entities: MirrorEntity[];
    condition?: string;
    bindings?: unknown[];
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    telegram?: { context: TelegramMutationContext; payload: unknown };
  }): Promise<T> {
    const now = this.clock();
    const event = {
      event_id: params.eventId,
      event_type: params.action,
      user_id: params.userId,
      entity_id: params.entityId,
      occurred_at: now,
      created_at: now,
      request_id: params.requestId,
      payload_hash: params.hash,
      result_code: 'OK',
      result_json: JSON.stringify(params.result),
    };
    const guardId = crypto.randomUUID();
    const statements = [
      writeGuard(this.db, guardId, params.condition, params.bindings),
      this.db
        .prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(
          params.eventId,
          params.userId,
          params.action,
          params.entityId,
          now,
          params.hash,
          'd1-hmac-v1',
          event.result_json,
          JSON.stringify(event),
        ),
      ...params.statements,
      ...(params.telegram
        ? telegramMutationStatements(
            this.db,
            params.eventId,
            params.telegram.context,
            params.telegram.payload,
            params.result,
            now,
          )
        : []),
      this.db
        .prepare(
          'INSERT INTO sync_outbox(event_id,payload_json,committed_at,next_attempt_at) VALUES (?,?,?,?)',
        )
        .bind(
          params.eventId,
          JSON.stringify({
            event_id: params.eventId,
            entities: [
              ...params.entities,
              { tab: 'Events', id: params.eventId, version: 1, row: event },
            ],
          }),
          now,
          now,
        ),
      clearGuard(this.db, guardId),
    ];
    const started = performance.now();
    try {
      const result = await this.db.batch(statements);
      logStructured('info', 'repository_operation_complete', params.requestId, {
        backend: 'd1',
        action: params.action,
        duration_ms: Math.round(performance.now() - started),
        rows_read: result.reduce((n, r) => n + r.meta.rows_read, 0),
        rows_written: result.reduce((n, r) => n + r.meta.rows_written, 0),
      });
      return params.result;
    } catch (error) {
      const replay = await this.replay(
        params.eventId,
        params.userId,
        params.action,
        params.hash,
        params.schema,
      );
      if (replay) return replay;
      const state = await this.db
        .prepare("SELECT value FROM system_state WHERE key='writes_enabled'")
        .first<{ value: string }>();
      if (state?.value !== 'true')
        throw new AppError({
          code: 'UNAVAILABLE',
          message: 'Data maintenance in progress',
          status: 503,
          retryable: true,
        });
      if (!(error instanceof Error) || !/constraint|unique|foreign key/i.test(error.message))
        throw new AppError({
          code: 'UNAVAILABLE',
          message: 'Database operation unavailable',
          status: 503,
          retryable: true,
        });
      // Constraint/OCC failures have no partial writes. Retry decisions belong to the caller.
      throw conflict();
    }
  }
  private async getWord(
    userId: string,
    wordId: string,
    includeDeleted = false,
  ): Promise<VocabularyItem> {
    const row = await this.db
      .prepare(
        `SELECT record_json FROM words WHERE user_id=? AND word_id=? ${includeDeleted ? '' : "AND deleted_at=''"}`,
      )
      .bind(userId, wordId)
      .first();
    if (!row) throw notFound();
    return decode(row, vocabularyItemSchema);
  }
  public async upsert(
    userId: string,
    requestId: string,
    input: VocabularyCreateRequest,
  ): Promise<VocabularyCreateResponse> {
    const action = 'vocabulary.upsert';
    const data = {
      word: input.word,
      lemma: input.lemma ?? input.word.toLowerCase(),
      part_of_speech: input.part_of_speech,
      sense_key: input.sense_key,
      meaning_vi: input.meaning_vi,
      ipa: input.ipa ?? '',
      example: input.example,
      source_excerpt: input.source_excerpt,
    };
    const hash = await this.fingerprint(action, userId, data);
    const key = [
      userId,
      normalizeText(data.lemma),
      normalizeText(input.part_of_speech),
      normalizeText(input.sense_key),
    ].join('|');
    // D1 batches these read-only preflight queries in one network round trip.
    // Durable writes still use commit()'s atomic guard/event/entity/outbox batch.
    const preflightStarted = performance.now();
    const [eventRead, wordRead] = await this.db.batch([
      this.eventLookupStatement(input.event_id),
      this.db.prepare('SELECT record_json FROM words WHERE word_key=?').bind(key),
    ]);
    logStructured('info', 'repository_preflight_complete', requestId, {
      backend: 'd1',
      action,
      duration_ms: Math.round(performance.now() - preflightStarted),
      statement_count: 2,
      rows_read: eventRead!.meta.rows_read + wordRead!.meta.rows_read,
    });
    const replay = this.resolveReplay(
      eventRead!.results[0] ?? null,
      userId,
      action,
      hash,
      vocabularyCreateResponseSchema,
    );
    if (replay) return replay;
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = attempt === 0
        ? (wordRead!.results[0] ?? null)
        : await this.db.prepare('SELECT record_json FROM words WHERE word_key=?').bind(key).first();
      const previous = row ? decode(row, vocabularyItemSchema) : null;
      const now = this.clock();
      const word: VocabularyItem = previous
        ? {
            ...previous,
            last_asked_at: now,
            times_asked: previous.times_asked + 1,
            version: previous.version + 1,
            deleted_at: '',
            ...(previous.review_state === 'suspended' ? { review_state: 'new', due_at: now } : {}),
          }
        : {
            word_id: `w_${crypto.randomUUID()}`,
            user_id: userId,
            word_key: key,
            word: data.word.trim(),
            lemma: data.lemma.trim(),
            part_of_speech: input.part_of_speech,
            sense_key: input.sense_key.trim().toLowerCase(),
            meaning_vi: input.meaning_vi,
            ipa: data.ipa,
            example: input.example,
            source_excerpt: input.source_excerpt,
            created_at: now,
            last_asked_at: now,
            times_asked: 1,
            review_state: 'new',
            repetitions: 0,
            interval_days: 0,
            ease_factor: 2.5,
            due_at: now,
            last_reviewed_at: '',
            version: 1,
            deleted_at: '',
          };
      const card = previous
        ? null
        : createInitialFsrsCard({
            cardId: `c_${word.word_id}`,
            wordId: word.word_id,
            userId,
            nowIso: now,
          });
      try {
        return await this.commit({
          eventId: input.event_id,
          userId,
          requestId,
          action,
          hash,
          entityId: word.word_id,
          result: { word_id: word.word_id, created: !previous, duplicate_event: false },
          schema: vocabularyCreateResponseSchema,
          condition: previous
            ? 'EXISTS(SELECT 1 FROM words WHERE user_id=? AND word_id=? AND version=?)'
            : 'NOT EXISTS(SELECT 1 FROM words WHERE word_key=?)',
          bindings: previous ? [userId, word.word_id, previous.version] : [key],
          statements: [this.wordStatement(word), ...(card ? [this.cardStatement(card)] : [])],
          entities: [
            { tab: 'Words', id: word.word_id, version: word.version, row: word },
            ...(card
              ? [{ tab: 'Cards' as const, id: card.card_id, version: card.row_version, row: card }]
              : []),
          ],
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 409 || attempt === 2) throw error;
      }
    }
    throw conflict();
  }
  public async list(
    userId: string,
    _requestId: string,
    query: VocabularyListQuery,
  ): Promise<VocabularyListResponse> {
    const cursor = query.cursor ? await this.getWord(userId, query.cursor, true) : null;
    const search = normalizeText(query.search ?? '');
    const rows = await this.db
      .prepare(
        `SELECT record_json FROM words WHERE user_id=? AND deleted_at=''
      AND (?='' OR lower(json_extract(record_json,'$.word') || ' ' || json_extract(record_json,'$.lemma') || ' ' || json_extract(record_json,'$.meaning_vi')) LIKE ? ESCAPE '\\')
      AND (?='' OR created_at < ? OR (created_at=? AND word_id>?)) ORDER BY created_at DESC,word_id ASC LIMIT ?`,
      )
      .bind(
        userId,
        search,
        `%${search.replace(/[\\%_]/g, '\\$&')}%`,
        cursor?.created_at ?? '',
        cursor?.created_at ?? '',
        cursor?.created_at ?? '',
        cursor?.word_id ?? '',
        query.limit + 1,
      )
      .all();
    const items = rows.results.map((row) => decode(row, vocabularyItemSchema));
    const more = items.length > query.limit;
    if (more) items.pop();
    return { items, next_cursor: more ? items.at(-1)!.word_id : null };
  }
  public async update(
    userId: string,
    requestId: string,
    wordId: string,
    input: VocabularyUpdateRequest,
  ): Promise<VocabularyItem> {
    const action = 'vocabulary.update';
    const hash = await this.fingerprint(action, userId, {
      word_id: wordId,
      meaning_vi: input.meaning_vi,
      example: input.example,
      part_of_speech: input.part_of_speech,
      sense_key: input.sense_key,
      version: input.version,
    });
    const replay = await this.replay(input.event_id, userId, action, hash, vocabularyItemSchema);
    if (replay) return replay;
    const old = await this.getWord(userId, wordId);
    if (old.version !== input.version) throw conflict();
    const word = {
      ...old,
      ...(input.meaning_vi !== undefined ? { meaning_vi: input.meaning_vi } : {}),
      ...(input.example !== undefined ? { example: input.example } : {}),
      part_of_speech: input.part_of_speech ?? old.part_of_speech,
      sense_key: input.sense_key?.trim().toLowerCase() ?? old.sense_key,
      version: old.version + 1,
    };
    word.word_key = [
      userId,
      normalizeText(word.lemma),
      normalizeText(word.part_of_speech),
      normalizeText(word.sense_key),
    ].join('|');
    return this.commit({
      eventId: input.event_id,
      userId,
      requestId,
      action,
      hash,
      entityId: wordId,
      result: word,
      schema: vocabularyItemSchema,
      condition:
        "EXISTS(SELECT 1 FROM words WHERE user_id=? AND word_id=? AND version=? AND deleted_at='')",
      bindings: [userId, wordId, input.version],
      statements: [this.wordStatement(word)],
      entities: [{ tab: 'Words', id: wordId, version: word.version, row: word }],
    });
  }
  public async softDelete(
    userId: string,
    requestId: string,
    wordId: string,
    eventId: string,
  ): Promise<{ word_id: string; deleted: boolean }> {
    const action = 'vocabulary.delete';
    const schema = z.object({ word_id: z.string(), deleted: z.boolean() });
    const hash = await this.fingerprint(action, userId, { word_id: wordId });
    const replay = await this.replay(eventId, userId, action, hash, schema);
    if (replay) return replay;
    const old = await this.getWord(userId, wordId);
    const word: VocabularyItem = {
      ...old,
      deleted_at: this.clock(),
      review_state: 'suspended',
      version: old.version + 1,
    };
    return this.commit({
      eventId,
      userId,
      requestId,
      action,
      hash,
      entityId: wordId,
      result: { word_id: wordId, deleted: true },
      schema,
      condition:
        "EXISTS(SELECT 1 FROM words WHERE user_id=? AND word_id=? AND version=? AND deleted_at='')",
      bindings: [userId, wordId, old.version],
      statements: [this.wordStatement(word)],
      entities: [{ tab: 'Words', id: wordId, version: word.version, row: word }],
    });
  }
  private cardContextStatement(userId: string, target: string): Statement {
    return this.db
      .prepare(
        `SELECT c.record_json AS card_json,w.record_json AS word_json,s.record_json AS settings_json
      FROM cards c JOIN words w ON w.word_id=c.word_id AND w.user_id=c.user_id LEFT JOIN settings s ON s.user_id=c.user_id
      WHERE c.user_id=? AND c.is_suspended=0 AND ${activeWord} AND (c.card_id=? OR c.word_id=?)
      ORDER BY CASE WHEN c.card_id=? THEN 0 WHEN c.card_id='c_' || c.word_id THEN 1 ELSE 2 END,c.card_id LIMIT 1`,
      )
      .bind(userId, target, target, target);
  }
  private decodeCardContext(row: unknown): {
    card: FsrsCard;
    word: VocabularyItem;
    config: FsrsConfig;
  } {
    if (!row) throw notFound();
    const stored = parse(
      row,
      z.object({
        card_json: z.string(),
        word_json: z.string(),
        settings_json: z.string().nullable(),
      }),
    );
    const settings = stored.settings_json
      ? parse(storedJson(stored.settings_json) as unknown, z.record(z.unknown()))
      : {};
    const overrides =
      typeof settings['scheduler_parameters_json'] === 'string' &&
      settings['scheduler_parameters_json']
        ? parse(storedJson(settings['scheduler_parameters_json']) as unknown, z.record(z.unknown()))
        : {};
    if (settings['desired_retention'] !== undefined && settings['desired_retention'] !== '')
      overrides['request_retention'] = Number(settings['desired_retention']);
    if (settings['maximum_interval'] !== undefined && settings['maximum_interval'] !== '')
      overrides['maximum_interval'] = Number(settings['maximum_interval']);
    if (settings['parameters_version'])
      overrides['parameters_version'] = settings['parameters_version'];
    if (settings['timezone']) overrides['timezone'] = settings['timezone'];
    return {
      card: parse(storedJson(stored.card_json) as unknown, fsrsCardSchema),
      word: parse(storedJson(stored.word_json) as unknown, vocabularyItemSchema),
      config: parse(overrides, fsrsConfigSchema),
    };
  }
  public async getCardContext(
    userId: string,
    target: string,
  ): Promise<{ card: FsrsCard; word: VocabularyItem; config: FsrsConfig }> {
    return this.decodeCardContext(await this.cardContextStatement(userId, target).first());
  }
  public async listDue(
    userId: string,
    _requestId: string,
    limit: number,
    nowIso = this.clock(),
  ): Promise<{ items: DueReviewCard[] }> {
    const rows = await this.db
      .prepare(
        `SELECT c.record_json AS card_json,w.record_json AS word_json FROM cards c
      JOIN words w ON w.user_id=c.user_id AND w.word_id=c.word_id WHERE c.user_id=? AND c.is_suspended=0
      AND c.due_at_utc<=? AND ${activeWord} ORDER BY c.due_at_utc,c.card_id LIMIT ?`,
      )
      .bind(userId, nowIso, limit)
      .all();
    return {
      items: rows.results.map((row) => {
        const pair = parse(row, z.object({ card_json: z.string(), word_json: z.string() }));
        const card = parse(storedJson(pair.card_json) as unknown, fsrsCardSchema);
        const word = parse(storedJson(pair.word_json) as unknown, vocabularyItemSchema);
        return parse(
          {
            ...word,
            review_id: `due_${card.card_id}`,
            due_at: card.due_at_utc,
            review_state: legacyState(card),
            repetitions: card.reps,
            interval_days: card.scheduled_days,
            version: card.row_version,
            ...card,
          },
          dueReviewCardSchema,
        );
      }),
    };
  }
  public async preview(
    userId: string,
    _requestId: string,
    cardId: string,
    nowIso = this.clock(),
  ): Promise<ReviewPreviewResponse> {
    const { card, config } = await this.getCardContext(userId, cardId);
    return previewCardToResponse(card, nowIso, config);
  }
  public async recordReview(
    userId: string,
    requestId: string,
    input: ReviewSubmitRequest,
    reviewedAtIso: string,
    telegram?: TelegramMutationContext,
  ): Promise<ReviewSubmitResponse> {
    const action = 'review.record';
    const clientRequest = {
      card_id: input.card_id ?? null,
      word_id: input.word_id ?? null,
      rating: input.rating,
      expected_version: input.expected_version ?? null,
      version: input.version ?? null,
    };
    const hash = await this.fingerprint(action, userId, { client_request: clientRequest });
    // Replay and current Card context are read in one D1 round trip. Replay is
    // still resolved first so a completed event remains replayable after deletion.
    const target = input.card_id ?? input.word_id ?? '';
    const preflightStarted = performance.now();
    const [eventRead, cardRead] = await this.db.batch([
      this.eventLookupStatement(input.event_id),
      this.cardContextStatement(userId, target),
    ]);
    logStructured('info', 'repository_preflight_complete', requestId, {
      backend: 'd1',
      action,
      duration_ms: Math.round(performance.now() - preflightStarted),
      statement_count: 2,
      rows_read: eventRead!.meta.rows_read + cardRead!.meta.rows_read,
    });
    const replay = this.resolveReplay(
      eventRead!.results[0] ?? null,
      userId,
      action,
      hash,
      reviewSubmitResponseSchema,
    );
    if (replay) return replay;
    const initialContext = this.decodeCardContext(cardRead!.results[0] ?? null);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { card, word, config } =
        attempt === 0 ? initialContext : await this.getCardContext(userId, target);
      if (input.word_id && input.word_id !== word.word_id)
        throw new AppError({
          code: 'INVALID_ARGUMENT',
          message: 'Card does not belong to word',
          status: 400,
        });
      if ((input.expected_version ?? input.version ?? card.row_version) !== card.row_version)
        throw conflict();
      const scheduled = scheduleNextFsrsReview(card, input.rating, reviewedAtIso, config);
      const next = scheduled.next_card;
      const reviewId = `rv_${crypto.randomUUID()}`;
      const result = parse(
        {
          review_id: reviewId,
          card_id: card.card_id,
          word_id: word.word_id,
          next_due_at: next.due_at_utc,
          interval_days: next.scheduled_days,
          repetitions: next.reps,
          ease_factor: 2.5,
          review_state: legacyState(next),
          state: next.state,
          stability: next.stability,
          difficulty: next.difficulty,
          reps: next.reps,
          lapses: next.lapses,
          row_version: next.row_version,
          idempotent_replay: false,
          duplicate_event: false,
        },
        reviewSubmitResponseSchema,
      );
      const audit = {
        review_id: reviewId,
        event_id: input.event_id,
        user_id: userId,
        card_id: card.card_id,
        word_id: word.word_id,
        rating: input.rating,
        reviewed_at: reviewedAtIso,
        old_due_at: card.due_at_utc,
        new_due_at: next.due_at_utc,
        old_interval_days: card.scheduled_days,
        new_interval_days: next.scheduled_days,
        previous_state: card.state,
        next_state: next.state,
        stability: next.stability,
        difficulty: next.difficulty,
        review_log_json: scheduled.review_log_json,
        previous_version: card.row_version,
        next_version: next.row_version,
        scheduler_version: next.scheduler_version,
        parameters_version: next.parameters_version,
        previous_card_json: JSON.stringify(card),
        next_card_json: JSON.stringify(next),
      };
      const updatedWord = {
        ...word,
        review_state: legacyState(next),
        repetitions: next.reps,
        interval_days: next.scheduled_days,
        due_at: next.due_at_utc,
        last_reviewed_at: reviewedAtIso,
        version: word.version + 1,
      };
      try {
        return await this.commit({
          eventId: input.event_id,
          userId,
          requestId,
          action,
          hash,
          entityId: reviewId,
          result,
          schema: reviewSubmitResponseSchema,
          ...(telegram
            ? {
                telegram: {
                  context: telegram,
                  payload: {
                    kind: telegram.messageId ? 'edit' : 'send',
                    text: formatReviewResult(input.rating, result.next_due_at),
                  },
                },
              }
            : {}),
          condition: `EXISTS(SELECT 1 FROM cards c JOIN words w ON w.word_id=c.word_id AND w.user_id=c.user_id
          WHERE c.user_id=? AND c.card_id=? AND c.row_version=? AND c.is_suspended=0 AND w.version=? AND ${activeWord})`,
          bindings: [userId, card.card_id, card.row_version, word.version],
          statements: [
            this.cardStatement(next),
            this.wordStatement(updatedWord),
            this.db
              .prepare('INSERT INTO reviews VALUES (?,?,?,?,?,?,?)')
              .bind(
                reviewId,
                input.event_id,
                userId,
                card.card_id,
                word.word_id,
                reviewedAtIso,
                JSON.stringify(audit),
              ),
          ],
          entities: [
            { tab: 'Words', id: word.word_id, version: updatedWord.version, row: updatedWord },
            { tab: 'Cards', id: card.card_id, version: next.row_version, row: next },
            { tab: 'Reviews', id: reviewId, version: 1, row: audit },
          ],
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 409 || attempt === 2) throw error;
      }
    }
    throw conflict();
  }
  public async getStats(
    userId: string,
    _requestId: string,
    nowIso = this.clock(),
  ): Promise<ReviewStatsResponse> {
    const day = new Date(Date.parse(nowIso) + 7 * 3600000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${day}T00:00:00.000Z`) - 7 * 3600000).toISOString();
    const end = new Date(Date.parse(start) + 86400000).toISOString();
    const [cardTotals, reviewTotals] = await this.db.batch([
      this.db
        .prepare(
          `SELECT COUNT(*) AS total_active_cards,COALESCE(SUM(c.state='New'),0) AS new_cards,
        COALESCE(SUM(c.state='Learning'),0) AS learning_cards,COALESCE(SUM(c.state='Review'),0) AS review_cards,
        COALESCE(SUM(c.state='Relearning'),0) AS relearning_cards,COALESCE(SUM(c.due_at_utc<?),0) AS due_today
        FROM cards c JOIN words w ON w.user_id=c.user_id AND w.word_id=c.word_id WHERE c.user_id=?
        AND c.is_suspended=0 AND ${activeWord}`,
        )
        .bind(end, userId),
      this.db
        .prepare(
          `SELECT COUNT(*) AS total_reviews_count,COALESCE(SUM(reviewed_at>=? AND reviewed_at<?),0) AS completed_today
        FROM reviews WHERE user_id=?`,
        )
        .bind(start, end, userId),
    ]);
    return parse(
      {
        ...parse(cardTotals!.results[0], z.record(z.unknown())),
        ...parse(reviewTotals!.results[0], z.record(z.unknown())),
      },
      reviewStatsResponseSchema,
    );
  }

  public async updateUserPreferences(
    userId: string,
    requestId: string,
    eventId: string,
    prefs: {
      telegram_chat_id?: string;
      notifications_enabled?: boolean;
      daily_review_limit?: number;
    },
    telegram?: TelegramMutationContext,
  ): Promise<{ updated: boolean; notifications_enabled: boolean }> {
    const action = 'user.preferences';
    const schema = z.object({ updated: z.boolean(), notifications_enabled: z.boolean() });
    const hash = await this.fingerprint(action, userId, prefs);
    const replay = await this.replay(eventId, userId, action, hash, schema);
    if (replay) return replay;
    const row = await this.db
      .prepare('SELECT record_json FROM users WHERE user_id=?')
      .bind(userId)
      .first();
    const now = this.clock();
    const old = row
      ? decode(row, userSchema)
      : {
          user_id: userId,
          telegram_chat_id: userId.replace(/^telegram:/, ''),
          timezone: 'Asia/Ho_Chi_Minh',
          notifications_enabled: true,
          daily_review_limit: 10,
          reminder_local_hour: 8,
          created_at: now,
          updated_at: now,
          version: 0,
        };
    const user = parse({ ...old, ...prefs, updated_at: now, version: old.version + 1 }, userSchema);
    return this.commit({
      eventId,
      userId,
      requestId,
      action,
      hash,
      entityId: userId,
      result: { updated: true, notifications_enabled: user.notifications_enabled },
      schema,
      ...(telegram
        ? {
            telegram: {
              context: telegram,
              payload: { kind: 'send', text: telegram.confirmationText ?? 'Đã cập nhật cài đặt.' },
            },
          }
        : {}),
      condition: row
        ? 'EXISTS(SELECT 1 FROM users WHERE user_id=? AND record_json=?)'
        : 'NOT EXISTS(SELECT 1 FROM users WHERE user_id=?)',
      bindings: row ? [userId, parse(row, jsonRow).record_json] : [userId],
      statements: [
        this.db
          .prepare(
            'INSERT INTO users VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET record_json=excluded.record_json',
          )
          .bind(userId, JSON.stringify(user)),
      ],
      entities: [{ tab: 'Users', id: userId, version: user.version, row: user }],
    });
  }

  public async acceptTelegramCommand(
    userId: string,
    _requestId: string,
    updateId: number,
    chatId: string,
    payload: unknown,
  ): Promise<void> {
    await acceptTelegramCommand(this.db, userId, updateId, chatId, payload, this.clock());
  }
  public async claimDailyDigest(
    userId: string,
    requestId: string,
    localDate: string,
    limit: number,
    nowIso = this.clock(),
  ): Promise<DailyDigestClaimResult> {
    const dispatchId = `digest_${localDate}_${userId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const userRow = await this.db
      .prepare('SELECT record_json FROM users WHERE user_id=?')
      .bind(userId)
      .first();
    const user = userRow ? decode(userRow, userSchema) : null;
    const base = {
      dispatch_id: dispatchId,
      already_dispatched: false,
      notifications_enabled: user?.notifications_enabled ?? true,
      telegram_chat_id: user?.telegram_chat_id ?? userId.replace(/^telegram:/, ''),
      due_cards: [] as DueReviewCard[],
    };
    if (!base.notifications_enabled) return base;
    const existing = await this.db
      .prepare('SELECT record_json FROM daily_dispatches WHERE user_id=? AND local_date=?')
      .bind(userId, localDate)
      .first();
    const old = existing ? decode(existing, dispatchSchema) : null;
    const attempts = old?.attempt_count ?? 0;
    const age = Date.parse(nowIso) - Date.parse(old?.claimed_at ?? nowIso);
    // A crashed send may already have reached Telegram. Record uncertainty instead of
    // reclaiming it and potentially sending the same daily reminder twice.
    if (old?.status === 'claimed' && age >= 120_000) {
      const unknown = {
        ...old,
        status: 'unknown' as const,
        last_error: 'Claim expired; send outcome unknown',
        version: old.version + 1,
      };
      const guard = crypto.randomUUID();
      try {
        await this.db.batch([
          writeGuard(
            this.db,
            guard,
            'EXISTS(SELECT 1 FROM daily_dispatches WHERE dispatch_id=? AND record_json=?)',
            [dispatchId, parse(existing, jsonRow).record_json],
          ),
          this.db
            .prepare(
              "UPDATE daily_dispatches SET status='unknown',record_json=? WHERE dispatch_id=?",
            )
            .bind(JSON.stringify(unknown), dispatchId),
          dispatchMirrorStatement(this.db, unknown, nowIso),
          clearGuard(this.db, guard),
        ]);
      } catch (error) {
        if (!(error instanceof Error && /constraint|unique/i.test(error.message))) throw error;
      }
      return { ...base, already_dispatched: true };
    }
    if (
      old &&
      (old.status !== 'failed' || attempts >= 3 || age < 30000 * 2 ** Math.max(0, attempts - 1))
    )
      return { ...base, already_dispatched: true };
    const due = await this.listDue(
      userId,
      requestId,
      Math.min(limit, user?.daily_review_limit ?? limit),
      nowIso,
    );
    if (!due.items.length) return base;
    const claimToken = crypto.randomUUID();
    const row = dispatchSchema.parse({
      dispatch_id: dispatchId,
      user_id: userId,
      local_date: localDate,
      status: 'claimed',
      claimed_at: nowIso,
      sent_at: '',
      message_id: '',
      last_error: '',
      attempt_count: attempts + 1,
      claim_token: claimToken,
      version: (old?.version ?? 0) + 1,
    });
    const guard = crypto.randomUUID();
    try {
      await this.db.batch([
        writeGuard(
          this.db,
          guard,
          `( ${
            old
              ? "EXISTS(SELECT 1 FROM daily_dispatches WHERE user_id=? AND local_date=? AND claim_token=? AND status='failed')"
              : 'NOT EXISTS(SELECT 1 FROM daily_dispatches WHERE user_id=? AND local_date=?)'
          } ) AND (${
            userRow
              ? 'EXISTS(SELECT 1 FROM users WHERE user_id=? AND record_json=?)'
              : 'NOT EXISTS(SELECT 1 FROM users WHERE user_id=?)'
          })`,
          [
            ...(old ? [userId, localDate, old.claim_token] : [userId, localDate]),
            ...(userRow ? [userId, parse(userRow, jsonRow).record_json] : [userId]),
          ],
        ),
        this.db
          .prepare(
            `INSERT INTO daily_dispatches VALUES (?,?,?,?,?,?,?) ON CONFLICT(dispatch_id) DO UPDATE
          SET status=excluded.status,claim_token=excluded.claim_token,attempt_count=excluded.attempt_count,record_json=excluded.record_json`,
          )
          .bind(
            dispatchId,
            userId,
            localDate,
            'claimed',
            claimToken,
            attempts + 1,
            JSON.stringify(row),
          ),
        dispatchMirrorStatement(this.db, row, nowIso),
        clearGuard(this.db, guard),
      ]);
    } catch (error) {
      if (error instanceof Error && /constraint|unique/i.test(error.message))
        return { ...base, already_dispatched: true };
      throw new AppError({
        code: 'UNAVAILABLE',
        message: 'Digest storage unavailable',
        status: 503,
        retryable: true,
      });
    }
    return { ...base, claim_token: claimToken, due_cards: due.items };
  }
  public async finishDailyDigest(
    userId: string,
    _requestId: string,
    input: {
      dispatch_id: string;
      claim_token: string;
      status: 'sent' | 'failed' | 'unknown';
      message_id?: number;
    },
  ): Promise<{ updated: boolean }> {
    const now = this.clock();
    const stored = await this.db
      .prepare('SELECT record_json FROM daily_dispatches WHERE user_id=? AND dispatch_id=?')
      .bind(userId, input.dispatch_id)
      .first();
    if (!stored) throw conflict();
    const old = decode(stored, dispatchSchema);
    if (old.claim_token !== input.claim_token) throw conflict();
    if (old.status === input.status && old.message_id === (input.message_id ?? ''))
      return { updated: true };
    if (old.status !== 'claimed') throw conflict();
    const row = {
      ...old,
      status: input.status,
      sent_at: input.status === 'sent' ? now : '',
      message_id: input.message_id ?? '',
      last_error: input.status === 'sent' ? '' : `Telegram send ${input.status}`,
      version: old.version + 1,
    };
    const guard = crypto.randomUUID();
    try {
      await this.db.batch([
        writeGuard(
          this.db,
          guard,
          'EXISTS(SELECT 1 FROM daily_dispatches WHERE dispatch_id=? AND record_json=?)',
          [input.dispatch_id, parse(stored, jsonRow).record_json],
        ),
        this.db
          .prepare('UPDATE daily_dispatches SET status=?,record_json=? WHERE dispatch_id=?')
          .bind(row.status, JSON.stringify(row), row.dispatch_id),
        dispatchMirrorStatement(this.db, row, now),
        clearGuard(this.db, guard),
      ]);
    } catch (error) {
      if (error instanceof Error && /constraint|unique/i.test(error.message)) throw conflict();
      throw new AppError({
        code: 'UNAVAILABLE',
        message: 'Digest storage unavailable',
        status: 503,
        retryable: true,
      });
    }
    return { updated: true };
  }
}
