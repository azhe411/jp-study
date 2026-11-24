/**
 * 内容库驱动的练习：听力、阅读、发音、敬语/惯用语、汉字。
 * 内容在代码里（content/*），用户这边只存练习记录；判分以服务端为准，答错的顺手写进错题本。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  DIFFICULTY_LEVELS,
  EXPRESSION_DRILL_MODES,
  EXPRESSION_TYPES,
  JLPT_LEVELS,
  KANJI_DRILL_MODES,
  LISTENING_MODES,
  PRONUNCIATION_CATEGORIES,
  PRONUNCIATION_MODES,
  RECOGNITION_METHODS,
  type MistakeCategory,
} from '../../../shared/constants';
import type {
  DictationResult,
  ExpressionAttempt,
  ExpressionItem,
  Kanji,
  KanjiAttempt,
  ListeningAttempt,
  PronunciationAttempt,
  ReadingAttempt,
} from '../../../shared/types';
import { EXPRESSION_BY_ID, EXPRESSIONS } from '../content/expressions';
import { KANJI, KANJI_BY_ID, readingsOf } from '../content/kanji';
import { LISTENING, LISTENING_BY_ID } from '../content/listening';
import { PAIR_BY_ID, PRONUNCIATION_PAIRS } from '../content/pronunciation';
import { READING_BY_ID, READING_DEFS, readingToApi } from '../content/reading';
import { withTx, type Queryable } from '../db/pool';
import { insertOnce, pageByCreated } from '../db/records';
import { AppError, notFound } from '../lib/errors';
import { attemptTime, camelRow, clampLimit, decodeCursor, encodeCursor, uuid } from '../lib/util';
import { IsoDateTime, Lit, PageQuery, Uuid, WriteMeta } from '../schemas';
import { diffChars, normalizeJa } from '../services/scoring';
import { upsertMistake } from './mistakes';

type Row = Record<string, unknown>;
const ATTEMPT_OMIT = ['version', 'updated_at', 'deleted_at'];

export const listeningAttemptToApi = (r: Row) => camelRow<ListeningAttempt>(r, ATTEMPT_OMIT);
export const readingAttemptToApi = (r: Row) => camelRow<ReadingAttempt>(r, ATTEMPT_OMIT);
export const pronunciationAttemptToApi = (r: Row) => camelRow<PronunciationAttempt>(r, ATTEMPT_OMIT);
export const expressionAttemptToApi = (r: Row) => camelRow<ExpressionAttempt>(r, [...ATTEMPT_OMIT, 'type']);
export const kanjiAttemptToApi = (r: Row) => camelRow<KanjiAttempt>(r, ATTEMPT_OMIT);

/** 内容库分页：游标是下一条在原数组里的下标 */
function pageContent<T>(all: T[], keep: (x: T) => boolean, cursor: string | undefined, limit: number | undefined, idOf: (x: T) => string, def = 20) {
  const lim = clampLimit(limit ?? def);
  const start = (decodeCursor(cursor)?.k[0] as number | undefined) ?? 0;
  const matched = all.map((x, i) => ({ x, i })).filter(({ x, i }) => i >= start && keep(x));
  const next = matched[lim];
  return { items: matched.slice(0, lim).map(({ x }) => x), nextCursor: next ? encodeCursor({ k: [next.i], id: idOf(next.x) }) : null };
}

/** 听写：与原文、读音各比一次取高分；准确度 = 对上的字数 / 两者中较长的一方 */
export function scoreDictation(expected: { text: string; reading: string }, answer: string) {
  const ans = normalizeJa(answer);
  let best = { accuracy: 0, diff: diffChars(normalizeJa(expected.text), ans).segments };
  for (const ref of [expected.text, expected.reading].map(normalizeJa)) {
    const { segments, matched } = diffChars(ref, ans);
    const denom = Math.max(Array.from(ref).length, Array.from(ans).length) || 1;
    const accuracy = Math.round((matched / denom) * 100);
    if (accuracy > best.accuracy) best = { accuracy, diff: segments };
  }
  return best;
}

const AttemptMeta = { ...WriteMeta, id: Type.Optional(Uuid), attemptedAt: Type.Optional(IsoDateTime) };

async function recordMistake(q: Queryable, userId: string, m: { category: MistakeCategory; source: string; sourceRef: string; question: string; wrong: string; correct: string; explanation?: string }) {
  if (!m.wrong.trim() && m.source !== 'pronunciation') return;
  await upsertMistake(q, userId, {
    category: m.category,
    source: m.source,
    sourceRef: m.sourceRef,
    question: m.question,
    wrongAnswer: m.wrong,
    correctAnswer: m.correct,
    explanationZh: m.explanation ?? null,
  });
}

export const practiceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /* ───────────── 听力 ───────────── */

  app.get('/listening/materials', { schema: { querystring: Type.Object({ level: Type.Optional(Lit(DIFFICULTY_LEVELS)), ...PageQuery }) } }, async (req) => {
    const page = pageContent(LISTENING, (m) => !req.query.level || m.level === req.query.level, req.query.cursor, req.query.limit, (m) => m.id);
    return { items: page.items.map(({ segments: _segments, ...summary }) => summary), nextCursor: page.nextCursor };
  });

  app.get('/listening/materials/:materialId', { schema: { params: Type.Object({ materialId: Type.String({ maxLength: 80 }) }) } }, async (req) => {
    const m = LISTENING_BY_ID.get(req.params.materialId);
    if (!m) throw notFound('听力材料不存在');
    return m;
  });

  app.post(
    '/listening/dictation',
    {
      config: { idempotent: false },
      schema: {
        body: Type.Object(
          { materialId: Type.String({ maxLength: 80 }), segmentIndex: Type.Integer({ minimum: 0 }), answer: Type.String({ maxLength: 1000 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<DictationResult> => {
      const m = LISTENING_BY_ID.get(req.body.materialId);
      if (!m) throw notFound('听力材料不存在');
      const seg = m.segments[req.body.segmentIndex];
      if (!seg) throw new AppError('VALIDATION_FAILED', '段落序号超出范围', [{ path: '/segmentIndex', message: `0–${m.segments.length - 1}` }]);
      const { accuracy, diff } = scoreDictation(seg, req.body.answer);
      return { materialId: m.id, segmentIndex: seg.index, expected: seg.text, answer: req.body.answer, accuracy, diff };
    },
  );

  app.get(
    '/listening/attempts',
    { schema: { querystring: Type.Object({ materialId: Type.Optional(Type.String({ maxLength: 80 })), mode: Type.Optional(Lit(LISTENING_MODES)), ...PageQuery }) } },
    async (req) =>
      pageByCreated(app.db, 'listening_attempts', req.userId, { material_id: req.query.materialId, mode: req.query.mode }, req.query, listeningAttemptToApi),
  );

  app.post(
    '/listening/attempts',
    {
      schema: {
        body: Type.Object(
          {
            ...AttemptMeta,
            materialId: Type.String({ maxLength: 80 }),
            mode: Lit(LISTENING_MODES),
            durationMs: Type.Integer({ minimum: 0, maximum: 7_200_000 }),
            score: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()])),
            dictationAnswers: Type.Optional(
              Type.Array(Type.Object({ index: Type.Integer({ minimum: 0 }), answer: Type.String({ maxLength: 1000 }) }, { additionalProperties: false }), {
                maxItems: 200,
              }),
            ),
            replays: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const m = LISTENING_BY_ID.get(b.materialId);
      if (!m) throw notFound('听力材料不存在');
      const segmentScores = (b.dictationAnswers ?? [])
        .filter((a) => m.segments[a.index])
        .map((a) => ({ index: a.index, accuracy: scoreDictation(m.segments[a.index], a.answer).accuracy }));
      const avg = segmentScores.length ? Math.round(segmentScores.reduce((s, x) => s + x.accuracy, 0) / segmentScores.length) : null;
      const { row } = await insertOnce(app.db, 'listening_attempts', req.userId, {
        id: b.id ?? uuid(),
        material_id: m.id,
        mode: b.mode,
        duration_ms: b.durationMs,
        score: b.score ?? (b.mode === 'dictation' ? avg : null),
        segment_scores: JSON.stringify(segmentScores),
        replays: b.replays ?? 0,
        created_at: attemptTime(b.attemptedAt),
      });
      return reply.code(201).send(listeningAttemptToApi(row));
    },
  );

  /* ───────────── 阅读 ───────────── */

  app.get('/reading/materials', { schema: { querystring: Type.Object({ level: Type.Optional(Lit(DIFFICULTY_LEVELS)), ...PageQuery }) } }, async (req) => {
    const page = pageContent(READING_DEFS, (d) => !req.query.level || d.level === req.query.level, req.query.cursor, req.query.limit, (d) => d.id);
    return { items: page.items.map((d) => readingToApi(d, false)), nextCursor: page.nextCursor };
  });

  app.get('/reading/materials/:materialId', { schema: { params: Type.Object({ materialId: Type.String({ maxLength: 80 }) }) } }, async (req) => {
    const d = READING_BY_ID.get(req.params.materialId);
    if (!d) throw notFound('阅读材料不存在');
    return readingToApi(d, true);
  });

  app.get(
    '/reading/attempts',
    { schema: { querystring: Type.Object({ materialId: Type.Optional(Type.String({ maxLength: 80 })), ...PageQuery }) } },
    async (req) => pageByCreated(app.db, 'reading_attempts', req.userId, { material_id: req.query.materialId }, req.query, readingAttemptToApi),
  );

  app.post(
    '/reading/attempts',
    {
      schema: {
        body: Type.Object(
          {
            ...AttemptMeta,
            materialId: Type.String({ maxLength: 80 }),
            durationMs: Type.Integer({ minimum: 1000, maximum: 7_200_000 }),
            lookedUpWords: Type.Optional(Type.Array(Type.String({ maxLength: 60 }), { maxItems: 200 })),
            answers: Type.Optional(
              Type.Array(Type.Object({ questionId: Type.String({ maxLength: 20 }), choiceIndex: Type.Integer({ minimum: 0, maximum: 3 }) }, { additionalProperties: false }), {
                maxItems: 50,
              }),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const d = READING_BY_ID.get(b.materialId);
      if (!d) throw notFound('阅读材料不存在');
      const charCount = readingToApi(d, false).charCount;
      let correct: number | null = null;
      if (b.answers?.length) {
        correct = b.answers.filter((a) => d.questions[Number(a.questionId.slice(1)) - 1]?.answerIndex === a.choiceIndex).length;
      }
      const { row } = await insertOnce(app.db, 'reading_attempts', req.userId, {
        id: b.id ?? uuid(),
        material_id: d.id,
        duration_ms: b.durationMs,
        char_count: charCount,
        chars_per_minute: Math.round(charCount / (b.durationMs / 60_000)),
        looked_up_words: b.lookedUpWords ?? [],
        comprehension_correct: correct,
        comprehension_total: b.answers?.length ? d.questions.length : null,
        created_at: attemptTime(b.attemptedAt),
      });
      return reply.code(201).send(readingAttemptToApi(row));
    },
  );

  /* ───────────── 发音（最小对立对） ───────────── */

  app.get(
    '/pronunciation/pairs',
    {
      schema: {
        querystring: Type.Object({
          category: Type.Optional(Lit(PRONUNCIATION_CATEGORIES)),
          cursor: PageQuery.cursor,
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
      },
    },
    async (req) => pageContent(PRONUNCIATION_PAIRS, (p) => !req.query.category || p.category === req.query.category, req.query.cursor, req.query.limit, (p) => p.id, 50),
  );

  app.get(
    '/pronunciation/attempts',
    { schema: { querystring: Type.Object({ pairId: Type.Optional(Type.String({ maxLength: 80 })), ...PageQuery }) } },
    async (req) => pageByCreated(app.db, 'pronunciation_attempts', req.userId, { pair_id: req.query.pairId }, req.query, pronunciationAttemptToApi),
  );

  app.post(
    '/pronunciation/attempts',
    {
      schema: {
        body: Type.Object(
          {
            ...AttemptMeta,
            pairId: Type.String({ maxLength: 80 }),
            mode: Lit(PRONUNCIATION_MODES),
            target: Lit(['a', 'b'] as const),
            chosen: Type.Optional(Lit(['a', 'b'] as const)),
            transcript: Type.Optional(Type.String({ maxLength: 200 })),
            method: Type.Optional(Lit(RECOGNITION_METHODS)),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      // Lit 推不出 'a' | 'b' 这种字面量元组，这里手动收窄
      const b = req.body as unknown as Omit<typeof req.body, 'target' | 'chosen'> & { target: 'a' | 'b'; chosen?: 'a' | 'b' };
      const pair = PAIR_BY_ID.get(b.pairId);
      if (!pair) throw notFound('发音对不存在');
      let correct: boolean;
      if (b.mode === 'listen') {
        if (!b.chosen) throw new AppError('VALIDATION_FAILED', '听辨需要给出选择', [{ path: '/chosen', message: 'mode=listen 时必填' }]);
        correct = b.chosen === b.target;
      } else {
        if (b.transcript === undefined) throw new AppError('VALIDATION_FAILED', '开口模式需要识别结果', [{ path: '/transcript', message: 'mode=speak 时必填' }]);
        const t = normalizeJa(b.transcript);
        const forms = (s: { text: string; reading: string }) => [normalizeJa(s.text), normalizeJa(s.reading)];
        const target = forms(pair[b.target]);
        const other = forms(pair[b.target === 'a' ? 'b' : 'a']);
        // 音高对两边假名相同：识别出假名时没法分辨，判定从宽
        correct = !!t && target.some((f) => t.includes(f)) && (pair.category === 'pitchAccent' || !other.includes(t));
      }
      return withTx(app.db, async (tx) => {
        const { row, created } = await insertOnce(tx, 'pronunciation_attempts', req.userId, {
          id: b.id ?? uuid(),
          pair_id: pair.id,
          mode: b.mode,
          target: b.target,
          chosen: b.chosen ?? null,
          transcript: b.transcript ?? null,
          method: b.method ?? null,
          correct,
          created_at: attemptTime(b.attemptedAt),
        });
        if (created && !correct && b.mode === 'listen') {
          await recordMistake(tx, req.userId, {
            category: 'pronunciation',
            source: 'pronunciation',
            sourceRef: pair.id,
            question: `听辨：${pair.a.text}（${pair.a.reading}）还是 ${pair.b.text}（${pair.b.reading}）？`,
            wrong: pair[b.chosen!].text,
            correct: pair[b.target].text,
            explanation: pair.tip,
          });
        }
        return reply.code(201).send(pronunciationAttemptToApi(row));
      });
    },
  );

  /* ───────────── 敬语 / 惯用语 ───────────── */

  app.get(
    '/expressions/items',
    {
      schema: {
        querystring: Type.Object({
          type: Lit(EXPRESSION_TYPES),
          kind: Type.Optional(Type.String({ maxLength: 20 })),
          level: Type.Optional(Lit(DIFFICULTY_LEVELS)),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      const { type, kind, level } = req.query;
      return pageContent(
        EXPRESSIONS,
        (e) => e.type === type && (!kind || e.kind === kind) && (!level || e.level === level),
        req.query.cursor,
        req.query.limit,
        (e) => e.id,
      );
    },
  );

  app.get(
    '/expressions/attempts',
    { schema: { querystring: Type.Object({ type: Type.Optional(Lit(EXPRESSION_TYPES)), ...PageQuery }) } },
    async (req) => pageByCreated(app.db, 'expression_attempts', req.userId, { type: req.query.type }, req.query, expressionAttemptToApi),
  );

  app.post(
    '/expressions/attempts',
    {
      schema: {
        body: Type.Object(
          {
            ...AttemptMeta,
            itemId: Type.String({ maxLength: 80 }),
            mode: Lit(EXPRESSION_DRILL_MODES),
            answer: Type.String({ maxLength: 300 }),
            correct: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const item = EXPRESSION_BY_ID.get(b.itemId);
      if (!item) throw notFound('条目不存在');
      const correct = b.mode === 'meaning' ? b.correct : judgeForm(item, b.answer, b.correct);
      return withTx(app.db, async (tx) => {
        const { row, created } = await insertOnce(tx, 'expression_attempts', req.userId, {
          id: b.id ?? uuid(),
          item_id: item.id,
          type: item.type,
          mode: b.mode,
          answer: b.answer,
          correct,
          created_at: attemptTime(b.attemptedAt),
        });
        if (created && !correct) {
          const ex = item.examples[0];
          const question =
            b.mode === 'meaning'
              ? `「${item.expression}」是什么意思？`
              : b.mode === 'convert'
                ? `把「${item.plainForm ?? item.meaningZh}」换成更得体的说法`
                : `填空：${ex ? ex.ja.replace(item.expression, '＿＿') : item.meaningZh}`;
          await recordMistake(tx, req.userId, {
            category: item.type === 'keigo' ? 'keigo' : 'idiom',
            source: 'expression',
            sourceRef: item.id,
            question,
            wrong: b.answer,
            correct: b.mode === 'meaning' ? item.meaningZh : item.expression,
            explanation: item.usageNote,
          });
        }
        return reply.code(201).send(expressionAttemptToApi(row));
      });
    },
  );

  /* ───────────── 汉字 ───────────── */

  app.get(
    '/kanji',
    {
      schema: {
        querystring: Type.Object({
          level: Type.Optional(Lit(JLPT_LEVELS)),
          q: Type.Optional(Type.String({ maxLength: 20 })),
          cursor: PageQuery.cursor,
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
      },
    },
    async (req) => {
      const q = req.query.q ? normalizeJa(req.query.q) : null;
      const keep = (k: (typeof KANJI)[number]) =>
        (!req.query.level || k.jlptLevel === req.query.level) &&
        (!q || k.character === req.query.q || readingsOf(k).some((r) => normalizeJa(r) === q));
      const page = pageContent(KANJI, keep, req.query.cursor, req.query.limit, (k) => k.id, 50);
      const { rows } = await app.db.query(
        `SELECT kanji_id, count(*)::int AS attempts, avg(correct::int)::float AS rate, max(created_at) AS last
           FROM kanji_attempts WHERE user_id = $1 AND deleted_at IS NULL AND kanji_id = ANY ($2) GROUP BY kanji_id`,
        [req.userId, page.items.map((k) => k.id)],
      );
      const prog = new Map(rows.map((r) => [r.kanji_id as string, r]));
      const items: Kanji[] = page.items.map((k) => {
        const p = prog.get(k.id);
        return {
          ...k,
          progress: p
            ? { attempts: p.attempts as number, correctRate: Math.round((p.rate as number) * 100) / 100, lastAttemptAt: (p.last as Date).toISOString() }
            : { attempts: 0, correctRate: null, lastAttemptAt: null },
        };
      });
      return { items, nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/kanji/attempts',
    {
      schema: {
        body: Type.Object(
          {
            ...AttemptMeta,
            kanjiId: Type.String({ maxLength: 20 }),
            mode: Lit(KANJI_DRILL_MODES),
            answer: Type.String({ maxLength: 100 }),
            correct: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const k = KANJI_BY_ID.get(b.kanjiId);
      if (!k) throw notFound('汉字不存在');
      // 读音题服务端复核；意思与书写只能信客户端（手写判定在前端）
      const correct = b.mode === 'reading' ? readingsOf(k).map(normalizeJa).includes(normalizeJa(b.answer)) : b.correct;
      return withTx(app.db, async (tx) => {
        const { row, created } = await insertOnce(tx, 'kanji_attempts', req.userId, {
          id: b.id ?? uuid(),
          kanji_id: k.id,
          mode: b.mode,
          answer: b.answer,
          correct,
          created_at: attemptTime(b.attemptedAt),
        });
        if (created && !correct) {
          const q = { reading: `「${k.character}」怎么读？`, meaning: `「${k.character}」是什么意思？`, writing: `写出汉字：${k.kunyomi[0] ?? k.onyomi[0]}（${k.meaningsZh[0]}）` };
          const answer = { reading: [...k.onyomi, ...k.kunyomi].join('、'), meaning: k.meaningsZh.join('、'), writing: k.character };
          await recordMistake(tx, req.userId, {
            category: 'kanji',
            source: 'kanji',
            sourceRef: k.id,
            question: q[b.mode],
            wrong: b.answer,
            correct: answer[b.mode],
          });
        }
        return reply.code(201).send(kanjiAttemptToApi(row));
      });
    },
  );
};

/**
 * 转换 / 填空题的服务端复核：与原形或读音一致即对；
 * 写成活用形（如「召し上がります」）时原形对不上，若客户端判对且词干一致也算对。
 */
function judgeForm(item: ExpressionItem, answer: string, clientCorrect: boolean): boolean {
  const a = normalizeJa(answer);
  if (!a) return false;
  const forms = [item.expression, item.reading].map(normalizeJa);
  if (forms.includes(a)) return true;
  const stems = forms.map((f) => Array.from(f).slice(0, -1).join('')).filter((s) => s.length >= 1);
  return clientCorrect && stems.some((s) => a.startsWith(s));
}
