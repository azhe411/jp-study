/**
 * 学习闭环（契约 v1.5.0 §19）：把"计划 → 今天学哪几站 → 每站分几步 → 学过的词进复习"串成一条线。
 *
 *   预设抽认卡：从计划起点到"当前站 + SEED_AHEAD"的每一课，把生词（假名课是假名）放进牌组。
 *              每课只放一次，记在 lesson_card_seeds —— 用户删掉的卡不会再被塞回来。
 *              新卡每天放出多少仍由设置里的"每日新卡上限"决定，不会一下子压过来。
 *   今日路线：复习 → 每课（看视频 → 本课练习 → 过关小测）。每一步是否完成都由真实记录判断：
 *              视频看到 85% 以上、练习得过分、小测过关、到期卡片清空。
 */
import { KANA_DECK, LESSON_DECK, SEED_AHEAD, SENTENCE_CARDS_PER_LESSON, SENTENCE_DECK, type LearningStage, type StartLevel } from '../../../shared/constants';
import type { DailyRoute, Example, LessonSummary, RouteStep, StageInfo } from '../../../shared/types';
import { LESSON_BY_ID, type StaticContent } from '../content/curriculum';
import { KANA_EXAMPLE } from '../content/kanaExamples';
import type { Db, Queryable } from '../db/pool';
import { insertCard } from '../routes/cards';
import { localDate } from '../lib/util';
import { loadPlan, planToday, startOrder, summaries } from './learning';
import { loadSettings } from './settings';

type Vocab = Array<StaticContent['vocab'][number] & { example?: Example | null }>;
type Content = Pick<StaticContent, 'vocab' | 'kanaRows'> & { sentences?: Example[] };
/** 预设卡的版本：2 = 含扩充内容（生词带例句、句子卡）。老用户已经放过的课会按版本补一次 */
const SEED_VERSION = 2;

async function contentOf(q: Queryable, id: string): Promise<Content | null> {
  const def = LESSON_BY_ID.get(id);
  if (!def) return null;
  if (def.content) return def.content;
  const { rows } = await q.query(
    'SELECT c.content, e.vocab, e.sentences FROM lesson_content c LEFT JOIN lesson_extras e ON e.lesson_id = c.lesson_id WHERE c.lesson_id = $1',
    [id],
  );
  if (!rows[0]) return null;
  return { ...rows[0].content, vocab: mergeVocab(rows[0].content.vocab, rows[0].vocab), sentences: rows[0].sentences ?? [] };
}

/** 一课要放进牌组的卡：普通课是生词，假名课是字表里的每个假名 */
function cardsOf(c: Content): SeedCard[] {
  if (c.kanaRows?.length) {
    const seen = new Set<string>();
    return c.kanaRows.flat().flatMap((cell) => {
      const front = cell.kana.replace(/（.*?）/g, '').trim();
      // 声调课的表（はし:1）是高低标记，不是读音，不做卡
      if (!front || seen.has(front) || /^[0-9]+$/.test(cell.romaji)) return [];
      seen.add(front);
      const ex = KANA_EXAMPLE.get(front);
      return [{ deck: KANA_DECK, front, back: cell.romaji, reading: null, example: ex?.word ?? null, exampleTranslation: ex?.zh ?? null }];
    });
  }
  const words: SeedCard[] = (c.vocab as Vocab).map((w) => ({
    deck: LESSON_DECK, front: w.word, back: w.meaningZh, reading: w.reading && w.reading !== w.word ? w.reading : null,
    example: w.example?.ja ?? null, exampleTranslation: w.example?.zh ?? null,
  }));
  const sentences: SeedCard[] = (c.sentences ?? []).slice(0, SENTENCE_CARDS_PER_LESSON).map((s) => ({
    deck: SENTENCE_DECK, front: s.ja, back: s.zh, reading: s.reading && s.reading !== s.ja ? s.reading : null, example: null, exampleTranslation: null,
  }));
  return [...words, ...sentences];
}

/** 讲义里的生词 + 扩充的生词，按写法去重（讲义里的在前） */
export function mergeVocab(base: Vocab, extra: Vocab | null | undefined): Vocab {
  const byWord = new Map<string, Vocab[number]>();
  for (const w of base) byWord.set(w.word, w);
  for (const w of extra ?? []) {
    const had = byWord.get(w.word);
    byWord.set(w.word, had ? { ...had, example: w.example ?? had.example } : w);
  }
  return [...byWord.values()];
}

/** 本该已经有预设卡的课：计划起点 → 第一个没过关的课 + SEED_AHEAD */
export async function seedTargets(q: Queryable, userId: string): Promise<string[]> {
  const [all, plan] = await Promise.all([summaries(q, userId), loadPlan(q, userId)]);
  const start = plan ? startOrder(plan.start_level as StartLevel) : 1;
  const current = all.find((l) => l.order >= start && l.status !== 'passed')?.order ?? all.length;
  return all.filter((l) => l.order >= start && l.order <= current + SEED_AHEAD).map((l) => l.id);
}

/**
 * 把还没放过的课的卡放进去，返回新加的卡数。内容还没生成的课先跳过，下次再放。
 * 顺带撤回"放早了"的课（0.9.0 曾提前放一站）：超出范围、而且一张都还没学过的预设卡收回，等学到那一课再放。
 */
export async function seedLessonCards(q: Queryable, userId: string): Promise<number> {
  const targets = await seedTargets(q, userId);
  if (!targets.length) return 0;
  const early = await q.query('SELECT lesson_id FROM lesson_card_seeds WHERE user_id = $1 AND NOT (lesson_id = ANY($2))', [userId, targets]);
  const passed = new Set((await summaries(q, userId)).filter((l) => l.status === 'passed').map((l) => l.id));
  for (const r of early.rows) {
    const id = r.lesson_id as string;
    if (passed.has(id)) continue;
    const touched = await q.query(
      `SELECT 1 FROM cards WHERE user_id = $1 AND source = 'lesson' AND source_ref = $2 AND deleted_at IS NULL AND (state <> 'new' OR reps > 0) LIMIT 1`,
      [userId, id],
    );
    if (touched.rows[0]) continue;
    await q.query(
      `UPDATE cards SET deleted_at = now(), version = version + 1 WHERE user_id = $1 AND source = 'lesson' AND source_ref = $2 AND deleted_at IS NULL`,
      [userId, id],
    );
    await q.query('DELETE FROM lesson_card_seeds WHERE user_id = $1 AND lesson_id = $2', [userId, id]);
  }
  const { rows } = await q.query('SELECT lesson_id, v FROM lesson_card_seeds WHERE user_id = $1 AND lesson_id = ANY($2)', [userId, targets]);
  const seeded = new Map(rows.map((r) => [r.lesson_id as string, r.v as number]));
  let added = 0;
  for (const id of targets) {
    const had = seeded.get(id);
    if (had !== undefined && had >= SEED_VERSION) continue;
    const c = await contentOf(q, id);
    if (!c) continue;
    // 扩充内容还没生成好的普通课：先放讲义里的词，版本留在 1，内容好了下次补
    const ready = !!c.kanaRows?.length || !!c.sentences?.length || !!LESSON_BY_ID.get(id)?.content;
    let n = 0;
    for (const card of cardsOf(c)) {
      // 同牌组同正面的已经有了就不重复。补旧课（had 有值）时连用户删掉的也算"有"，删了就不再塞回来
      const dup = await q.query(
        `SELECT id, example, deleted_at FROM cards WHERE user_id = $1 AND deck = $2 AND front = $3 ${had === undefined ? 'AND deleted_at IS NULL' : ''} LIMIT 1`,
        [userId, card.deck, card.front],
      );
      if (dup.rows[0]) {
        // 老卡补上例句（翻面时能看到），不动复习进度
        if (!dup.rows[0].deleted_at && !dup.rows[0].example && card.example) {
          await q.query('UPDATE cards SET example = $2, example_translation = $3, version = version + 1 WHERE id = $1', [dup.rows[0].id, card.example, card.exampleTranslation]);
        }
        continue;
      }
      if (await insertCard(q, userId, { front: card.front, back: card.back, reading: card.reading, example: card.example, exampleTranslation: card.exampleTranslation, sourceRef: id }, card.deck, 'lesson')) n++;
    }
    await q.query(
      `INSERT INTO lesson_card_seeds (user_id, lesson_id, cards, v) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET cards = lesson_card_seeds.cards + EXCLUDED.cards, v = EXCLUDED.v`,
      [userId, id, n, ready ? SEED_VERSION : 1],
    );
    added += n;
  }
  return added;
}

interface SeedCard {
  deck: string;
  front: string;
  back: string;
  reading: string | null;
  example: string | null;
  exampleTranslation: string | null;
}

/* ───────────── 今日路线 ───────────── */

const PRACTICE_MINUTES = 10;
const QUIZ_MINUTES = 5;
/** 视频看到这个比例就算看过：片尾常有几分钟闲聊 */
const VIDEO_DONE_RATIO = 0.85;

async function reviewStep(q: Queryable, userId: string, tz: string): Promise<RouteStep | null> {
  const settings = await loadSettings(q, userId);
  const { rows } = await q.query(
    `SELECT
       (SELECT count(*) FROM cards WHERE user_id = $1 AND deleted_at IS NULL AND NOT suspended)::int AS total,
       (SELECT count(*) FROM cards WHERE user_id = $1 AND deleted_at IS NULL AND NOT suspended AND state <> 'new' AND due <= now())::int AS due,
       (SELECT count(*) FROM cards WHERE user_id = $1 AND deleted_at IS NULL AND NOT suspended AND state = 'new')::int AS fresh,
       (SELECT count(*) FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL AND state_before = 'new'
           AND (reviewed_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS learned,
       (SELECT count(*) FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL
           AND (reviewed_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS today`,
    [userId, tz],
  );
  const r = rows[0];
  // 牌组还是空的（第 0 站）：没什么可复习，别先送一个打勾的"完成"
  if (r.total === 0) return null;
  const newLeft = Math.min(r.fresh, Math.max(0, settings.newCardsPerDay - r.learned));
  const left = r.due + newLeft;
  const detail = left === 0
      ? r.today ? `今天复习了 ${r.today} 张，到期的都清空了` : '今天没有到期的卡片'
      : `到期 ${r.due} 张${newLeft ? ` · 新卡 ${newLeft} 张` : ''}`;
  return { id: 'review', kind: 'review', lessonId: null, title: '复习抽认卡', detail, minutes: Math.max(1, Math.round(left * 0.25)), done: left === 0, link: '/review' };
}

async function lessonSteps(q: Queryable, userId: string, l: LessonSummary): Promise<RouteStep[]> {
  const steps: RouteStep[] = [];
  // 已过关的课：视频和练习就算跳过了也不再追着要，否则路线永远走不完
  const passed = l.status === 'passed';
  if (l.videos.length) {
    const { rows } = await q.query(
      `SELECT page, position_sec, duration_sec, completed FROM video_progress
        WHERE user_id = $1 AND course_id = $2 AND page = ANY($3) AND deleted_at IS NULL`,
      [userId, l.videos[0].courseId, l.videos.map((v) => v.page)],
    );
    const seen = (page: number, dur: number) => {
      const p = rows.find((x) => x.page === page);
      return !!p && (p.completed || p.position_sec >= (p.duration_sec || dur) * VIDEO_DONE_RATIO);
    };
    const watched = l.videos.filter((v) => seen(v.page, v.durationSec)).length;
    const minutes = Math.round((l.videos.reduce((s, v) => s + v.durationSec, 0) / 60) * 1.2);
    steps.push({
      id: `${l.id}:video`, kind: 'video', lessonId: l.id, title: '看视频',
      detail: l.videos.length > 1 ? `${l.videos.length} 集，已看完 ${watched} 集` : watched ? '已看完' : '中途退出也会记住看到哪里',
      minutes, done: passed || watched === l.videos.length, link: `/learn/${l.id}#video`,
    });
  }
  const { rows } = await q.query('SELECT practice_best FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2 AND deleted_at IS NULL', [userId, l.id]);
  const best = rows[0]?.practice_best as number | null | undefined;
  if (l.kind === 'guide') {
    // 第 0 站还没学假名，没有练习：读完讲解就可以直接小测
    steps.push({ id: `${l.id}:read`, kind: 'practice', lessonId: l.id, title: '读讲解', detail: '日语长什么样、每天怎么用这个软件', minutes: PRACTICE_MINUTES, done: passed, link: `/learn/${l.id}` });
  } else {
    steps.push({
      id: `${l.id}:practice`, kind: 'practice', lessonId: l.id, title: '读讲解，做本课练习',
      detail: best == null ? '听音选词、例句听辨、跟读，都用这一课的内容' : `练习最好成绩 ${best} 分`,
      minutes: PRACTICE_MINUTES, done: passed || best != null, link: `/learn/${l.id}/practice`,
    });
  }
  steps.push({
    id: `${l.id}:quiz`, kind: 'quiz', lessonId: l.id, title: '过关小测',
    detail: l.status === 'passed' ? `已过关${l.bestScore != null ? ` · ${l.bestScore} 分` : ''}` : '答对 80% 解锁下一站',
    minutes: QUIZ_MINUTES, done: l.status === 'passed', link: `/learn/${l.id}#quiz`,
  });
  return steps;
}

export async function dailyRoute(db: Db, userId: string): Promise<DailyRoute> {
  const { timezone } = await loadSettings(db, userId);
  const date = localDate(timezone);
  const cardsSeeded = await seedLessonCards(db, userId);
  const [today, all] = await Promise.all([planToday(db, userId, timezone), summaries(db, userId)]);
  // 今天已经过关的课也留在路线上（打勾），这样完成后不会"跳走"
  const { rows } = await db.query(
    `SELECT lesson_id FROM lesson_progress WHERE user_id = $1 AND deleted_at IS NULL AND status = 'passed'
        AND (passed_at AT TIME ZONE $2)::date = $3::date`,
    [userId, timezone, date],
  );
  const passedToday = new Set(rows.map((r) => r.lesson_id as string));
  const perDay = Math.max(1, today.nextLessons.length);
  const doneLessons = all.filter((l) => passedToday.has(l.id));
  const lessons = [...doneLessons, ...today.nextLessons.slice(0, Math.max(0, perDay - doneLessons.length))];

  const review = await reviewStep(db, userId, timezone);
  const steps: RouteStep[] = review ? [review] : [];
  for (const l of lessons) steps.push(...(await lessonSteps(db, userId, l)));
  return { date, lessons, steps, doneCount: steps.filter((s) => s.done).length, cardsSeeded };
}

/* ───────────── 学习阶段（v1.6.0） ───────────── */

const SENTENCE_LIMIT = 24;

/** 当前所在阶段，以及能拿来练习的"已学过"的材料：各练习模块据此调整难度，不超纲 */
export async function stageInfo(db: Db, userId: string): Promise<StageInfo> {
  const [all, plan] = await Promise.all([summaries(db, userId), loadPlan(db, userId)]);
  const start = plan ? startOrder(plan.start_level as StartLevel) : 1;
  const current = all.find((l) => l.order >= start && l.status !== 'passed') ?? null;
  const reach = current?.order ?? all.length;
  const stage: LearningStage = !current ? 'done' : current.part === 'guide' || current.part === 'kana' ? 'kana' : current.part;

  const known = new Set<string>();
  for (const l of all) {
    if (l.part !== 'kana' || l.order > reach) continue;
    const c = await contentOf(db, l.id);
    for (const cell of c?.kanaRows?.flat() ?? []) for (const ch of cell.kana.replace(/（.*?）/g, '')) known.add(ch);
  }

  const sentences: StageInfo['sentences'] = [];
  for (const l of all.filter((x) => x.order <= reach).reverse()) {
    if (sentences.length >= SENTENCE_LIMIT) break;
    const def = LESSON_BY_ID.get(l.id);
    const c = def?.content ?? (await db.query('SELECT content FROM lesson_content WHERE lesson_id = $1', [l.id])).rows[0]?.content;
    for (const s of (c?.sections ?? []) as StaticContent['sections']) {
      for (const e of s.examples) if (sentences.length < SENTENCE_LIMIT) sentences.push({ ...e, lessonId: l.id, lessonTitle: l.title });
    }
  }
  return { stage, currentLesson: current, knownKana: [...known].join(''), sentences };
}
