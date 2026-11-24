/**
 * 场景与场景对话。
 * 场景是代码里的内容库，掌握情况由该用户已结束对话的最高分推出（≥ SCENARIO_MASTERY_SCORE 即掌握）。
 * AI 调用一律放在事务之外：模型慢，不能让数据库连接陪着它等。
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  CONVERSATION_STATUSES,
  DIFFICULTY_LEVELS,
  SCENARIO_CATEGORIES,
  SCENARIO_MASTERY_SCORE,
  SPEECH_REGISTERS,
  type DifficultyLevel,
  type SpeechRegister,
} from '../../../shared/constants';
import type { Conversation, CreateConversationResult, Message, Scenario, SendMessageResult } from '../../../shared/types';
import { LESSON_BY_ID } from '../content/curriculum';
import { SCENARIO_BY_ID, SCENARIOS, type ScenarioDef } from '../content/scenarios';
import { getOwned, softDelete, withTx, type Queryable } from '../db/pool';
import { AppError, notFound, versionConflict } from '../lib/errors';
import { camelRow, clampLimit, decodeCursor, encodeCursor, paginate, uuid } from '../lib/util';
import { DeleteQuery, IdParams, Lit, PageQuery, VersionedMeta, WriteMeta } from '../schemas';
import { userAi } from '../services/aiKeys';
import { aiConversationFinish, aiConversationOpening, aiConversationTurn, type AiReply, type TurnHistory } from '../services/aiTasks';

type Row = Record<string, unknown>;

export const conversationToApi = (row: Row) => camelRow<Conversation>(row);
export const messageToApi = (row: Row) => camelRow<Message>(row, ['version', 'updated_at', 'deleted_at']);

/** 一段对话的上限：再长就该结束、拿分、开新的一段了 */
const MAX_MESSAGES = 80;
/** 喂给模型的最近几轮 */
const HISTORY_WINDOW = 20;

function scenarioOrThrow(id: string): ScenarioDef {
  const s = SCENARIO_BY_ID.get(id);
  if (!s) throw notFound('场景不存在');
  return s;
}

/** v1.5.0：「lesson:课程id」是按某一课临时拼出的场景 —— 只用这一课及之前学过的句型聊天 */
const LESSON_SCENARIO = /^lesson:([a-z0-9-]{1,40})$/;

async function scenarioFor(db: Queryable, id: string): Promise<ScenarioDef> {
  const m = LESSON_SCENARIO.exec(id);
  if (!m) return scenarioOrThrow(id);
  const def = LESSON_BY_ID.get(m[1]);
  if (!def || def.kind === 'guide' || def.content?.kanaRows) throw notFound('这一课没有对话练习');
  const content = def.content ?? (await db.query('SELECT content FROM lesson_content WHERE lesson_id = $1', [def.id])).rows[0]?.content;
  const level = ((DIFFICULTY_LEVELS as readonly string[]).includes(def.part) ? def.part : 'N5') as DifficultyLevel;
  const examples = ((content?.sections ?? []) as Array<{ examples: Array<{ ja: string }> }>).flatMap((s) => s.examples.map((e) => e.ja));
  return {
    id,
    category: 'dailyLife',
    title: `本课对话：${def.title}`,
    titleJa: '今日の課で話そう',
    description: `用「${def.title}」学到的句型和词，跟 AI 聊几句。`,
    level,
    register: 'polite',
    aiRole: '友好耐心的日本朋友。只用这一课及之前学过的语法和常用词说话，句子简短，引导学生用上本课的句型',
    userRole: '刚学完这一课的学生',
    goals: def.points.slice(0, 3).map((p) => `用上：${p}`),
    keyPhrases: examples.slice(0, 4),
  };
}

async function progressOf(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT scenario_id, count(*)::int AS attempts, max(score)::int AS best
       FROM conversations WHERE user_id = $1 AND deleted_at IS NULL AND status = 'finished'
      GROUP BY scenario_id`,
    [userId],
  );
  return new Map(rows.map((r) => [r.scenario_id as string, { attempts: r.attempts as number, best: r.best as number | null }]));
}

function scenarioToApi(s: ScenarioDef, p?: { attempts: number; best: number | null }): Scenario {
  const best = p?.best ?? null;
  return { ...s, progress: { attempts: p?.attempts ?? 0, bestScore: best, mastered: best !== null && best >= SCENARIO_MASTERY_SCORE } };
}

const replyRow = (conversationId: string, r: AiReply, at: Date) => ({
  id: uuid(),
  conversation_id: conversationId,
  role: 'assistant',
  content: r.content,
  translation_zh: r.translationZh,
  reading: r.reading,
  feedback: null,
  created_at: at,
});

async function insertMessage(q: Queryable, userId: string, m: Row) {
  const { rows } = await q.query(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, translation_zh, reading, feedback, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [m.id, userId, m.conversation_id, m.role, m.content, m.translation_zh, m.reading, m.feedback === null ? null : JSON.stringify(m.feedback), m.created_at],
  );
  return rows[0];
}

export const conversationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /* ───────────── 场景 ───────────── */

  app.get(
    '/scenarios',
    {
      schema: {
        querystring: Type.Object({
          category: Type.Optional(Lit(SCENARIO_CATEGORIES)),
          level: Type.Optional(Lit(DIFFICULTY_LEVELS)),
          register: Type.Optional(Lit(SPEECH_REGISTERS)),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      const { category, level, register, cursor } = req.query;
      // 内容库接口默认一次给满 100 条
      const lim = clampLimit(req.query.limit ?? 100);
      const start = (decodeCursor(cursor)?.k[0] as number | undefined) ?? 0;
      const matched = SCENARIOS.map((s, i) => ({ s, i })).filter(
        ({ s, i }) => i >= start && (!category || s.category === category) && (!level || s.level === level) && (!register || s.register === register),
      );
      const progress = await progressOf(app.db, req.userId);
      const items = matched.slice(0, lim);
      const next = matched[lim];
      return {
        items: items.map(({ s }) => scenarioToApi(s, progress.get(s.id))),
        nextCursor: next ? encodeCursor({ k: [next.i], id: next.s.id }) : null,
      };
    },
  );

  app.get('/scenarios/:scenarioId', { schema: { params: Type.Object({ scenarioId: Type.String({ maxLength: 80 }) }) } }, async (req) => {
    const s = await scenarioFor(app.db, req.params.scenarioId);
    return scenarioToApi(s, (await progressOf(app.db, req.userId)).get(s.id));
  });

  /* ───────────── 对话 ───────────── */

  app.get(
    '/conversations',
    {
      schema: {
        querystring: Type.Object({
          scenarioId: Type.Optional(Type.String({ maxLength: 80 })),
          status: Type.Optional(Lit(CONVERSATION_STATUSES)),
          ...PageQuery,
        }),
      },
    },
    async (req) => {
      const { scenarioId, status, cursor, limit } = req.query;
      const lim = clampLimit(limit);
      const c = decodeCursor(cursor);
      const { rows } = await app.db.query(
        `SELECT * FROM conversations
          WHERE user_id = $1 AND deleted_at IS NULL
            AND ($2::text IS NULL OR scenario_id = $2)
            AND ($3::text IS NULL OR status = $3)
            AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
          ORDER BY created_at DESC, id DESC LIMIT $6`,
        [req.userId, scenarioId ?? null, status ?? null, c ? c.k[0] : null, c?.id ?? null, lim + 1],
      );
      const page = paginate(rows, lim, (r) => ({ k: [(r.created_at as Date).toISOString()], id: r.id as string }));
      return { items: page.items.map(conversationToApi), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/conversations',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: Type.Object(
          { ...WriteMeta, scenarioId: Type.String({ minLength: 1, maxLength: 80 }), register: Type.Optional(Lit(SPEECH_REGISTERS)) },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      const s = await scenarioFor(app.db, req.body.scenarioId);
      const register = (req.body.register ?? s.register) as SpeechRegister;
      // 先拿到开场白，再落库：AI 不在，就不留下一段空对话
      const opening = await aiConversationOpening(await userAi(app, req.userId), s, register);
      const result = await withTx(app.db, async (tx): Promise<CreateConversationResult> => {
        const id = uuid();
        const { rows } = await tx.query(
          `INSERT INTO conversations (id, user_id, scenario_id, register, title, message_count) VALUES ($1, $2, $3, $4, $5, 1) RETURNING *`,
          [id, req.userId, s.id, register, s.title],
        );
        const msg = await insertMessage(tx, req.userId, replyRow(id, opening, new Date()));
        return { conversation: conversationToApi(rows[0]), openingMessage: messageToApi(msg) };
      });
      return reply.code(201).send(result);
    },
  );

  app.get('/conversations/:id', { schema: { params: IdParams } }, async (req) =>
    conversationToApi(await getOwned(app.db, 'conversations', req.userId, req.params.id)),
  );

  app.patch(
    '/conversations/:id',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: IdParams, body: Type.Object({ ...VersionedMeta, status: Type.Literal('finished') }, { additionalProperties: false }) },
    },
    async (req) => {
      const conv = await getOwned(app.db, 'conversations', req.userId, req.params.id);
      if (conv.status === 'finished') return conversationToApi(conv);
      const { baseVersion } = req.body;
      if (baseVersion !== undefined && baseVersion !== conv.version) throw versionConflict(conv.version as number, conversationToApi(conv));

      const { rows: msgs } = await app.db.query(
        `SELECT role, content FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL AND role <> 'system' ORDER BY created_at, id`,
        [conv.id],
      );
      const history = msgs as unknown as TurnHistory[];
      const { score, summary } = history.some((m) => m.role === 'user')
        ? await aiConversationFinish(await userAi(app, req.userId), await scenarioFor(app.db, conv.scenario_id as string), conv.register as SpeechRegister, history)
        : { score: 0, summary: '这次还没有开口练习，下次试着完成场景里的目标吧。' };

      const { rows } = await app.db.query(
        `UPDATE conversations SET status = 'finished', score = $3, summary = $4, finished_at = now(), version = version + 1
          WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING *`,
        [conv.id, req.userId, score, summary],
      );
      // 结束请求并发到达：后到的那个直接返回已结束的结果
      return conversationToApi(rows[0] ?? (await getOwned(app.db, 'conversations', req.userId, req.params.id)));
    },
  );

  app.delete('/conversations/:id', { schema: { params: IdParams, querystring: DeleteQuery } }, async (req, reply) => {
    await softDelete(app.db, 'conversations', req.userId, req.params.id, req.query.baseVersion, conversationToApi);
    return reply.code(204).send();
  });

  /* ───────────── 消息 ───────────── */

  app.get(
    '/conversations/:id/messages',
    {
      schema: {
        params: IdParams,
        querystring: Type.Object({
          cursor: PageQuery.cursor,
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
      },
    },
    async (req) => {
      await getOwned(app.db, 'conversations', req.userId, req.params.id);
      const lim = clampLimit(req.query.limit ?? 100, 200);
      const c = decodeCursor(req.query.cursor);
      const { rows } = await app.db.query(
        `SELECT * FROM messages
          WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL
            AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
          ORDER BY created_at, id LIMIT $5`,
        [req.params.id, req.userId, c ? c.k[0] : null, c?.id ?? null, lim + 1],
      );
      const page = paginate(rows, lim, (r) => ({ k: [(r.created_at as Date).toISOString()], id: r.id as string }));
      return { items: page.items.map(messageToApi), nextCursor: page.nextCursor };
    },
  );

  app.post(
    '/conversations/:id/messages',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: IdParams,
        body: Type.Object({ ...WriteMeta, content: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
      },
    },
    async (req): Promise<SendMessageResult> => {
      const conv = await getOwned(app.db, 'conversations', req.userId, req.params.id);
      if (conv.status === 'finished') throw new AppError('UNPROCESSABLE', '这段对话已经结束，请开始新的对话');
      if ((conv.message_count as number) + 2 > MAX_MESSAGES) {
        throw new AppError('UNPROCESSABLE', '这段对话已经很长了，先结束拿个评分，再开新的一段吧');
      }
      const content = req.body.content.trim();
      if (!content) throw new AppError('VALIDATION_FAILED', '消息不能为空', [{ path: '/content', message: '不能为空' }]);

      const { rows: recent } = await app.db.query(
        `SELECT role, content FROM (
           SELECT role, content, created_at, id FROM messages
            WHERE conversation_id = $1 AND deleted_at IS NULL AND role <> 'system'
            ORDER BY created_at DESC, id DESC LIMIT $2
         ) t ORDER BY created_at, id`,
        [conv.id, HISTORY_WINDOW],
      );
      const turn = await aiConversationTurn(
        await userAi(app, req.userId),
        await scenarioFor(app.db, conv.scenario_id as string),
        conv.register as SpeechRegister,
        recent as unknown as TurnHistory[],
        content,
      );

      return withTx(app.db, async (tx) => {
        // 用户消息与回复相差 1 毫秒，保证按时间排序时一问一答
        const at = new Date();
        const user = await insertMessage(tx, req.userId, {
          id: uuid(), conversation_id: conv.id, role: 'user', content, translation_zh: null, reading: null, feedback: turn.feedback, created_at: at,
        });
        const assistant = await insertMessage(tx, req.userId, replyRow(conv.id as string, turn.reply, new Date(at.getTime() + 1)));
        const { rows } = await tx.query(
          'UPDATE conversations SET message_count = message_count + 2 WHERE id = $1 AND user_id = $2 RETURNING *',
          [conv.id, req.userId],
        );
        return { userMessage: messageToApi(user), assistantMessage: messageToApi(assistant), conversation: conversationToApi(rows[0]) };
      });
    },
  );
};
