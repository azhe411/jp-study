/**
 * 词汇量测试：每个词频段抽 6 个真词（3 道"认不认识" + 3 道四选一释义）+ 12 个假词，共 60 题。
 *
 * 估算：每段"认识率"先按假词误报率校正（hit − fa）/（1 − fa），再乘以该段的词数，逐段相加。
 * 四选一答对才算认识，因此它同时是"说认识但其实不认识"的验证题。
 */
import { randomInt } from 'node:crypto';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  JLPT_LEVELS,
  VOCAB_FREQUENCY_BANDS,
  VOCAB_TEST_ITEMS,
  VOCAB_TEST_TTL_MINUTES,
  VOCAB_TO_JLPT,
  type JlptLevel,
} from '../../../shared/constants';
import type { VocabTestResult, VocabTestStartResult } from '../../../shared/types';
import { FAKE_WORDS, VOCAB_WORDS, type VocabWord } from '../content/vocab';
import { withTx } from '../db/pool';
import { pageByCreated } from '../db/records';
import { AppError, notFound } from '../lib/errors';
import { camelRow, uuid } from '../lib/util';
import { Lit, PageQuery, Uuid, WriteMeta } from '../schemas';

type Row = Record<string, unknown>;

export const vocabResultToApi = (row: Row) => camelRow<VocabTestResult>(row, ['version', 'updated_at', 'deleted_at']);

interface StoredItem {
  itemId: string;
  kind: 'yesNo' | 'choice';
  word: string;
  options: string[] | null;
  answerIndex: number | null;
  band: number | null;
  fake: boolean;
}

const PER_BAND = 6;
const FAKES = VOCAB_TEST_ITEMS - PER_BAND * VOCAB_FREQUENCY_BANDS.length;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function choiceOptions(w: VocabWord): { options: string[]; answerIndex: number } {
  const distractors = shuffle(VOCAB_WORDS.filter((x) => x.meaningZh !== w.meaningZh)).slice(0, 3).map((x) => x.meaningZh);
  const options = shuffle([w.meaningZh, ...distractors]);
  return { options, answerIndex: options.indexOf(w.meaningZh) };
}

export function buildTest(): StoredItem[] {
  const items: StoredItem[] = [];
  for (const band of VOCAB_FREQUENCY_BANDS) {
    shuffle(VOCAB_WORDS.filter((w) => w.band === band))
      .slice(0, PER_BAND)
      .forEach((w, i) => {
        const choice = i % 2 === 1;
        items.push({ itemId: '', kind: choice ? 'choice' : 'yesNo', word: w.word, ...(choice ? choiceOptions(w) : { options: null, answerIndex: null }), band, fake: false });
      });
  }
  for (const word of shuffle(FAKE_WORDS).slice(0, FAKES)) {
    items.push({ itemId: '', kind: 'yesNo', word, options: null, answerIndex: null, band: null, fake: true });
  }
  return shuffle(items).map((it, i) => ({ ...it, itemId: `v${i + 1}` }));
}

export function estimate(items: StoredItem[], answers: Map<string, { known?: boolean; choiceIndex?: number }>) {
  const knows = (it: StoredItem) => {
    const a = answers.get(it.itemId);
    return it.kind === 'choice' ? a?.choiceIndex === it.answerIndex : a?.known === true;
  };
  const fakes = items.filter((it) => it.fake);
  const fa = fakes.length ? fakes.filter(knows).length / fakes.length : 0;

  let prev = 0;
  let total = 0;
  const bands = VOCAB_FREQUENCY_BANDS.map((upTo) => {
    const inBand = items.filter((it) => it.band === upTo);
    const hit = inBand.length ? inBand.filter(knows).length / inBand.length : 0;
    const rate = fa >= 1 ? 0 : Math.max(0, Math.min(1, (hit - fa) / (1 - fa)));
    total += rate * (upTo - prev);
    prev = upTo;
    return { upTo, knownRate: Math.round(rate * 100) / 100 };
  });
  const estimatedVocab = Math.round(total / 10) * 10;
  const jlptEstimate = (VOCAB_TO_JLPT.find((x) => estimatedVocab >= x.minVocab)?.level ?? 'N5') as JlptLevel;
  return { estimatedVocab, jlptEstimate, falseAlarmRate: Math.round(fa * 100) / 100, bands };
}

export const vocabTestRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/vocab-test/start',
    { schema: { body: Type.Object({ ...WriteMeta, startLevel: Type.Optional(Lit(JLPT_LEVELS)) }, { additionalProperties: false }) } },
    async (req): Promise<VocabTestStartResult> => {
      const items = buildTest();
      const testId = uuid();
      const expiresAt = new Date(Date.now() + VOCAB_TEST_TTL_MINUTES * 60_000);
      await app.db.query('INSERT INTO vocab_tests (id, user_id, items, expires_at) VALUES ($1, $2, $3, $4)', [
        testId, req.userId, JSON.stringify(items), expiresAt,
      ]);
      return { testId, expiresAt: expiresAt.toISOString(), items: items.map(({ itemId, kind, word, options }) => ({ itemId, kind, word, options })) };
    },
  );

  app.post(
    '/vocab-test/submit',
    {
      schema: {
        body: Type.Object(
          {
            ...WriteMeta,
            testId: Uuid,
            answers: Type.Array(
              Type.Object(
                { itemId: Type.String({ maxLength: 10 }), known: Type.Optional(Type.Boolean()), choiceIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })) },
                { additionalProperties: false },
              ),
              { maxItems: VOCAB_TEST_ITEMS },
            ),
            durationMs: Type.Integer({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req): Promise<VocabTestResult> =>
      withTx(app.db, async (tx) => {
        const { rows } = await tx.query('SELECT * FROM vocab_tests WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.body.testId, req.userId]);
        const test = rows[0];
        if (!test) throw notFound('测试不存在');
        if (test.submitted_at) {
          const done = await tx.query('SELECT * FROM vocab_test_results WHERE test_id = $1', [test.id]);
          return vocabResultToApi(done.rows[0]);
        }
        // 契约 §4："词汇测试过期"属业务不可处理 → 422
        if ((test.expires_at as Date).getTime() < Date.now()) throw new AppError('UNPROCESSABLE', '测试已超过 60 分钟，请重新开始');

        const r = estimate(test.items as StoredItem[], new Map(req.body.answers.map((a) => [a.itemId, a])));
        const ins = await tx.query(
          `INSERT INTO vocab_test_results (id, user_id, test_id, estimated_vocab, jlpt_estimate, false_alarm_rate, bands)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [uuid(), req.userId, test.id, r.estimatedVocab, r.jlptEstimate, r.falseAlarmRate, JSON.stringify(r.bands)],
        );
        await tx.query('UPDATE vocab_tests SET submitted_at = now() WHERE id = $1', [test.id]);
        return vocabResultToApi(ins.rows[0]);
      }),
  );

  app.get('/vocab-test/history', { schema: { querystring: Type.Object(PageQuery) } }, async (req) =>
    pageByCreated(app.db, 'vocab_test_results', req.userId, {}, req.query, vocabResultToApi),
  );
};
