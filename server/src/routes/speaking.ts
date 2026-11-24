/**
 * 朗读与影子跟读：参考文本由客户端给出（来自句库、阅读、听力材料或自定义），服务端只负责评分与记录。
 * 来源是句库里的句子时，顺带用该句的假名读音参与比对，汉字识别结果与假名识别结果都能对上。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { SPEAKING_MODES, SPEAKING_SOURCE_TYPES, type RecognitionMethod } from '../../../shared/constants';
import type { SpeakingAttempt } from '../../../shared/types';
import { AppError } from '../lib/errors';
import { attemptTime, camelRow, clampLimit, decodeCursor, paginate, uuid } from '../lib/util';
import { Lit, Nullable, PageQuery, WriteMeta } from '../schemas';
import { scoreSpeech } from '../services/scoring';
import { AttemptFields, requireSelfScore } from './phrases';

type Row = Record<string, unknown>;

export const speakingAttemptToApi = (row: Row) => camelRow<SpeakingAttempt>(row, ['version', 'updated_at', 'deleted_at']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const speakingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/speaking/attempts',
    {
      schema: {
        querystring: Type.Object({
          mode: Type.Optional(Lit(SPEAKING_MODES)),
          sourceType: Type.Optional(Lit(SPEAKING_SOURCE_TYPES)),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      const { mode, sourceType, cursor, limit } = req.query;
      const lim = clampLimit(limit);
      const c = decodeCursor(cursor);
      const { rows } = await app.db.query(
        `SELECT * FROM speaking_attempts
          WHERE user_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR mode = $2)
            AND ($3::text IS NULL OR source_type = $3)
            AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
          ORDER BY created_at DESC, id DESC LIMIT $6`,
        [req.userId, mode ?? null, sourceType ?? null, c ? c.k[0] : null, c?.id ?? null, lim + 1],
      );
      const page = paginate(rows, lim, (r) => ({ k: [(r.created_at as Date).toISOString()], id: r.id as string }));
      return { items: page.items.map(speakingAttemptToApi), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/speaking/attempts',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            ...AttemptFields,
            mode: Lit(SPEAKING_MODES),
            sourceType: Lit(SPEAKING_SOURCE_TYPES),
            sourceId: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
            referenceText: Type.String({ minLength: 1, maxLength: 3000 }),
            referenceReading: Type.Optional(Nullable(Type.String({ maxLength: 3000 }))),
            transcript: Type.String({ maxLength: 3000 }),
            durationMs: Type.Integer({ minimum: 0, maximum: 1_800_000 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      requireSelfScore(b.method, b.selfScore);
      const at = attemptTime(b.attemptedAt);
      const id = b.id ?? uuid();

      const dup = await app.db.query('SELECT * FROM speaking_attempts WHERE id = $1', [id]);
      if (dup.rows[0]) {
        if (dup.rows[0].user_id !== req.userId) throw new AppError('UNPROCESSABLE', 'id 已被占用');
        return reply.code(201).send(speakingAttemptToApi(dup.rows[0]));
      }

      let referenceReading: string | null = b.referenceReading?.trim() || null;
      if (b.sourceType === 'phrase' && b.sourceId && UUID_RE.test(b.sourceId)) {
        const { rows } = await app.db.query(
          'SELECT ja, reading FROM phrases WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
          [b.sourceId, req.userId],
        );
        // 只有参考文本确实是这句话时，读音才对得上
        if (rows[0] && rows[0].ja === b.referenceText.trim()) referenceReading = rows[0].reading;
      }

      const { scores, diff } = scoreSpeech({
        reference: b.referenceText,
        referenceReading,
        transcript: b.transcript,
        method: b.method as RecognitionMethod,
        durationMs: b.durationMs,
        selfScore: b.selfScore,
      });
      const { rows } = await app.db.query(
        `INSERT INTO speaking_attempts (id, user_id, mode, source_type, source_id, reference_text, transcript, method, duration_ms, scores, diff, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id, req.userId, b.mode, b.sourceType, b.sourceId ?? null, b.referenceText, b.transcript, b.method, b.durationMs,
          JSON.stringify(scores), JSON.stringify(diff), at],
      );
      return reply.code(201).send(speakingAttemptToApi(rows[0] ?? (await app.db.query('SELECT * FROM speaking_attempts WHERE id = $1', [id])).rows[0]));
    },
  );
};
