/**
 * 学习教练克劳迪娅（契约 v1.5.0 §20、v1.7.0 §22）：不等学生提问，看着全部学习记录主动点评。
 *
 *   live   —— 主页上的实时点评：学习记录一变（复习了、看了视频、过了关……）就会更新
 *   lesson —— 每次考完一课的小测后写一份：这课哪里没掌握、接下来怎么补
 *   weekly —— 每周一写一份：一周的时长、进度、薄弱项
 *   daily  —— 旧版客户端还在用的每日小结
 *
 * 实时点评的建议会被核验（v1.10.0）：每次取点评都拿"点评写成之后"的学习记录对一遍，
 * 做到了标 done，做了没达标标 retry 并给出成绩，不靠学生自己勾选。
 *
 * live 的更新方式：每次请求先算一个"学习数据指纹"（今天学了多少、各项练习次数、过关数……）。
 *   指纹没变 → 直接给现成的。
 *   指纹变了 → 没有 AI Key：当场按规则写一份。有 Key：先把现成的给出去（refreshing=true），后台让 AI 重写，
 *              页面过几秒再取就是新的。同一用户最多每 10 分钟调用一次 AI（用的是用户自己的额度），失败 5 分钟内不再试。
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CoachKind } from '../../../shared/constants';
import type { CoachNote, CoachSuggestion } from '../../../shared/types';
import { LESSON_BY_ID } from '../content/curriculum';
import { AppError } from '../lib/errors';
import { addDays, camelRow, localDate, uuid } from '../lib/util';
import { aiKeyStatus, userAi } from './aiKeys';
import { aiCoach } from './aiTasks';
import { planToday, preview, summaries } from './learning';
import { HARD_CARD } from './restudy';
import { loadSettings } from './settings';

type Row = Record<string, unknown>;
type Draft = Pick<CoachNote, 'title' | 'summary' | 'highlights' | 'suggestions' | 'sections'>;

const CATEGORY_ZH: Record<string, string> = {
  vocab: '词汇', grammar: '语法', kanji: '汉字', particle: '助词', conjugation: '活用', keigo: '敬语', idiom: '惯用语',
  listening: '听力', pronunciation: '发音', writing: '写作', reading: '阅读', other: '其他',
};
const MODULE_ZH: Record<string, string> = {
  flashcards: '抽认卡', scenario: '场景对话', lookup: 'AI 查询', mistakes: '错题本', phrases: '句库', speaking: '朗读跟读', listening: '听力',
  writing: '写作', reading: '阅读', pronunciation: '发音', keigo: '敬语', idiom: '惯用语', kanji: '汉字', vocabTest: '词汇量测试', course: '外部课程', kana: '假名', lesson: '课程', other: '其他',
};

export const coachToApi = (r: Row, refreshing?: boolean): CoachNote => {
  const c = r.content as Draft;
  return { ...camelRow<Pick<CoachNote, 'id' | 'kind' | 'ref' | 'source' | 'createdAt' | 'readAt'>>(r, ['user_id', 'content', 'fingerprint']), ...c, ...(refreshing === undefined ? {} : { refreshing }) };
};

/** 本周一（按用户时区） */
export function mondayOf(date: string): string {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}

/* ───────────── 全部学习数据 ───────────── */

/** 把一条 SQL 的第一行取出来（全是聚合，一定有一行） */
async function one(app: FastifyInstance, sql: string, params: unknown[]): Promise<Row> {
  return (await app.db.query(sql, params)).rows[0] as Row;
}

async function context(app: FastifyInstance, userId: string, kind: CoachKind, ref: string) {
  const db = app.db;
  const { timezone: tz, newCardsPerDay } = await loadSettings(db, userId);
  const today = localDate(tz);
  const isToday = (col: string) => `(${col} AT TIME ZONE $2)::date = $3::date`;
  const p = [userId, tz, today];

  const [plan, all] = await Promise.all([planToday(db, userId, tz), summaries(db, userId)]);

  // 时长
  const daily = await db.query(
    `SELECT (started_at AT TIME ZONE $2)::date::text AS d, round(sum(duration_ms) / 60000.0)::int AS m
       FROM time_logs WHERE user_id = $1 AND deleted_at IS NULL AND started_at > now() - interval '8 days' GROUP BY 1 ORDER BY 1`,
    [userId, tz],
  );
  const byModule = await db.query(
    `SELECT module, round(sum(duration_ms) / 60000.0)::int AS m, round(sum(duration_ms) FILTER (WHERE ${isToday('started_at')}) / 60000.0)::int AS t
       FROM time_logs WHERE user_id = $1 AND deleted_at IS NULL AND started_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`,
    p,
  );
  const days = await db.query(
    `SELECT DISTINCT (started_at AT TIME ZONE $2)::date::text AS d FROM time_logs
      WHERE user_id = $1 AND deleted_at IS NULL AND started_at > now() - interval '60 days' ORDER BY d DESC`,
    [userId, tz],
  );
  const studied = new Set(days.rows.map((r) => r.d as string));
  let run = 0;
  for (let d = studied.has(today) ? today : addDays(today, -1); studied.has(d); d = addDays(d, -1)) run++;

  // 抽认卡
  const cards = await one(
    app,
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE state <> 'new' AND due <= now())::int AS due,
            count(*) FILTER (WHERE state = 'new')::int AS fresh,
            count(*) FILTER (WHERE state = 'review')::int AS learned,
            count(*) FILTER (WHERE state IN ('learning', 'relearning'))::int AS learning
       FROM cards WHERE user_id = $1 AND deleted_at IS NULL AND NOT suspended`,
    [userId],
  );
  const reviews = await one(
    app,
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE rating = 1)::int AS again,
            count(*) FILTER (WHERE ${isToday('reviewed_at')})::int AS today,
            count(*) FILTER (WHERE ${isToday('reviewed_at')} AND rating = 1)::int AS today_again
       FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL AND reviewed_at > now() - interval '7 days'`,
    p,
  );
  // 复习页能出多少张新卡：受每日额度限制，额度用完时"未学新卡"再多也进不去
  const newToday = (await one(app, `SELECT count(*)::int AS n FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL AND state_before = 'new' AND ${isToday('reviewed_at')}`, p)).n as number;
  const newLeft = Math.min(cards.fresh as number, Math.max(0, newCardsPerDay - newToday));
  const hard = await db.query(
    `SELECT c.front, c.back, c.lapses FROM cards c WHERE c.user_id = $1 AND ${HARD_CARD} ORDER BY c.lapses DESC, c.last_review_at DESC NULLS LAST LIMIT 5`,
    [userId],
  );
  const hardTotal = (await one(app, `SELECT count(*)::int AS n FROM cards c WHERE c.user_id = $1 AND ${HARD_CARD}`, [userId])).n as number;
  const rounds = await db.query(
    `SELECT scope, scope_value, total, known, score, created_at::text AS at FROM restudy_rounds WHERE user_id = $1 AND created_at > now() - interval '14 days' ORDER BY created_at DESC LIMIT 5`,
    [userId],
  );
  const roundCount = (await one(app, `SELECT count(*)::int AS n FROM restudy_rounds WHERE user_id = $1`, [userId])).n as number;
  const allMinutes = (await one(app, `SELECT round(coalesce(sum(duration_ms), 0) / 60000.0)::int AS m FROM time_logs WHERE user_id = $1 AND deleted_at IS NULL`, [userId])).m as number;

  // 错题
  const mistakes = await db.query(
    `SELECT category, count(*)::int AS n FROM mistakes WHERE user_id = $1 AND deleted_at IS NULL AND NOT mastered GROUP BY category ORDER BY n DESC LIMIT 5`,
    [userId],
  );
  const recentMistakes = await db.query(
    `SELECT question, correct_answer, error_count FROM mistakes WHERE user_id = $1 AND deleted_at IS NULL AND NOT mastered ORDER BY last_wrong_at DESC LIMIT 5`,
    [userId],
  );

  // 各项练习（近 7 天 + 今天）
  const attempts = (table: string, extra = '') =>
    one(app, `SELECT count(*)::int AS n, count(*) FILTER (WHERE ${isToday('created_at')})::int AS today ${extra} FROM ${table}
               WHERE user_id = $1 AND deleted_at IS NULL AND created_at > now() - interval '7 days'`, p);
  const overall = `, round(avg((scores->>'overall')::numeric))::int AS avg`;
  const rate = `, round(100.0 * count(*) FILTER (WHERE correct) / NULLIF(count(*), 0))::int AS rate`;
  const [speaking, phrases, listening, reading, writing, pronunciation, kanji, expressions] = await Promise.all([
    attempts('speaking_attempts', overall),
    attempts('phrase_attempts', overall),
    attempts('listening_attempts', `, round(avg(score))::int AS avg`),
    attempts('reading_attempts', `, round(avg(chars_per_minute))::int AS cpm, round(100.0 * sum(comprehension_correct) / NULLIF(sum(comprehension_total), 0))::int AS rate`),
    attempts('writing_entries', `, round(avg((correction->>'score')::numeric))::int AS avg`),
    attempts('pronunciation_attempts', rate),
    attempts('kanji_attempts', rate),
    attempts('expression_attempts', rate),
  ]);
  const lowSpeak = await db.query(
    `SELECT reference_text, transcript, (scores->>'overall')::int AS score FROM speaking_attempts
      WHERE user_id = $1 AND deleted_at IS NULL AND created_at > now() - interval '7 days' ORDER BY (scores->>'overall')::int ASC, created_at DESC LIMIT 3`,
    [userId],
  );
  const talk = await one(
    app,
    `SELECT count(*) FILTER (WHERE status = 'finished')::int AS done, round(avg(score))::int AS avg,
            count(*) FILTER (WHERE ${isToday('created_at')})::int AS today
       FROM conversations WHERE user_id = $1 AND deleted_at IS NULL`,
    p,
  );
  const vocabTest = (await db.query(`SELECT estimated_vocab, jlpt_estimate FROM vocab_test_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId])).rows[0];
  const mock = (await db.query(`SELECT level, total, total_max, taken_at::text FROM jlpt_mocks WHERE user_id = $1 AND deleted_at IS NULL ORDER BY taken_at DESC LIMIT 1`, [userId])).rows[0];
  const videos = await one(app, `SELECT count(*) FILTER (WHERE completed)::int AS done, count(*)::int AS started, count(*) FILTER (WHERE ${isToday('updated_at')})::int AS today FROM video_progress WHERE user_id = $1 AND deleted_at IS NULL`, p);

  // 课程
  const prog = await db.query(
    `SELECT lesson_id, status, best_score, attempts, practice_best, ${isToday('passed_at')} AS passed_today, ${isToday('practiced_at')} AS practiced_today
       FROM lesson_progress WHERE user_id = $1 AND deleted_at IS NULL`,
    p,
  );
  const title = (id: string) => LESSON_BY_ID.get(id)?.title ?? id;
  const weak = prog.rows.filter((r) => r.status === 'passed' && (r.best_score as number) < 90).sort((a, b) => (a.best_score as number) - (b.best_score as number)).slice(0, 5);
  const struggling = prog.rows.filter((r) => r.status !== 'passed' && (r.attempts as number) > 0);

  const current = plan.nextLessons[0] ?? null;
  const passedToday = prog.rows.filter((r) => r.passed_today).map((r) => title(r.lesson_id as string));
  const minutesToday = byModule.rows.reduce((s, r) => s + ((r.t as number) || 0), 0);

  const data: Record<string, unknown> = {
    学习计划: plan.plan
      ? { 目标: plan.plan.goal, 截止日期: plan.plan.targetDate, 每天计划分钟: plan.plan.dailyMinutes, 已过关站数: plan.passedCount, 计划总站数: plan.totalCount, 落后站数: plan.behindBy, 预计完成日期: plan.projectedFinish, 总学时: preview(plan.plan, today).estimatedHours, 累计学习小时: Math.round(allMinutes / 6) / 10 }
      : '还没有制定学习计划',
    当前一站: current ? { id: current.id, 标题: current.title, 学完能: current.goal } : '全部学完了',
    今天: { 日期: today, 学习分钟: minutesToday, 各模块分钟: Object.fromEntries(byModule.rows.filter((r) => r.t).map((r) => [MODULE_ZH[r.module as string] ?? r.module, r.t])), 复习次数: reviews.today, 其中按重来的次数: reviews.today_again, 今天过关的课: passedToday, 今天已经学过: plan.studiedToday },
    连续学习天数: run,
    最近8天每天学习分钟: Object.fromEntries(daily.rows.map((r) => [r.d as string, r.m])),
    近30天各模块分钟: Object.fromEntries(byModule.rows.map((r) => [MODULE_ZH[r.module as string] ?? r.module, r.m])),
    课程: {
      最近过关: all.filter((l) => l.status === 'passed').slice(-5).map((l) => ({ id: l.id, 标题: l.title, 分数: l.bestScore })),
      分数偏低的课: weak.map((r) => ({ id: r.lesson_id, 标题: title(r.lesson_id as string), 分数: r.best_score })),
      考过但还没过关的课: struggling.map((r) => ({ id: r.lesson_id, 标题: title(r.lesson_id as string), 最好成绩: r.best_score, 考了几次: r.attempts })),
    },
    视频: { 看完集数: videos.done, 看过集数: videos.started, 今天看过: videos.today },
    抽认卡: { 现在到期: cards.due, 未学新卡: cards.fresh, 今天还能学的新卡: newLeft, 总数: cards.total, 已进入长期复习: cards.learned, 学习中: cards.learning, 近7天复习次数: reviews.n, 近7天按重来的次数: reviews.again, 还没记牢的卡张数: hardTotal, 还没记牢的卡: hard.rows },
    重新学习: rounds.rows.map((r) => ({ 范围: r.scope === 'hard' ? '还没记牢的卡' : r.scope === 'lesson' ? title(r.scope_value as string) : r.scope_value, 张数: r.total, 第一次就记住: r.known, 分数: r.score, 时间: r.at })),
    未掌握错题按类型: mistakes.rows.map((r) => ({ 类型: CATEGORY_ZH[r.category as string] ?? r.category, 数量: r.n })),
    最近的错题: recentMistakes.rows.map((r) => ({ 题目: r.question, 正确答案: r.correct_answer, 错了几次: r.error_count })),
    近7天练习: {
      朗读跟读: { 次数: speaking.n, 今天: speaking.today, 平均分: speaking.avg, 分数最低的几句: lowSpeak.rows.map((r) => ({ 原文: r.reference_text, 听到的: r.transcript, 分数: r.score })) },
      句库跟读: { 次数: phrases.n, 今天: phrases.today, 平均分: phrases.avg },
      听力: { 次数: listening.n, 今天: listening.today, 平均分: listening.avg },
      阅读: { 次数: reading.n, 今天: reading.today, 每分钟字数: reading.cpm, 理解正确率: reading.rate },
      写作: { 篇数: writing.n, 今天: writing.today, 平均分: writing.avg },
      发音辨析: { 次数: pronunciation.n, 今天: pronunciation.today, 正确率: pronunciation.rate },
      汉字: { 次数: kanji.n, 今天: kanji.today, 正确率: kanji.rate },
      敬语惯用语: { 次数: expressions.n, 今天: expressions.today, 正确率: expressions.rate },
      场景对话: { 完成总数: talk.done, 平均分: talk.avg, 今天: talk.today },
    },
    词汇量测试: vocabTest ? { 估算词汇量: vocabTest.estimated_vocab, 对应水平: vocabTest.jlpt_estimate } : '还没测过',
    模考: mock ? { 级别: mock.level, 得分: mock.total, 满分: mock.total_max, 日期: mock.taken_at } : '还没考过',
  };

  if (kind === 'lesson') {
    const def = LESSON_BY_ID.get(ref);
    const s = all.find((l) => l.id === ref);
    const pr = prog.rows.find((r) => r.lesson_id === ref);
    // 最近一次小测里答错的题
    const quiz = await db.query(
      `SELECT q.questions, array_agg(a.question_id) FILTER (WHERE NOT a.correct) AS wrong
         FROM quizzes q JOIN quiz_answers a ON a.quiz_id = q.id AND a.user_id = q.user_id
        WHERE q.user_id = $1 AND q.source = 'lesson' AND q.source_ref = $2
        GROUP BY q.id, q.questions ORDER BY max(a.answered_at) DESC LIMIT 1`,
      [userId, ref],
    );
    const wrongIds = new Set((quiz.rows[0]?.wrong as string[] | null) ?? []);
    const wrong = ((quiz.rows[0]?.questions as Array<{ id: string; stem: string; options: string[]; answerIndex: number; category: string }>) ?? [])
      .filter((q) => wrongIds.has(q.id))
      .map((q) => ({ 题目: q.stem, 正确答案: q.options[q.answerIndex], 类型: CATEGORY_ZH[q.category] ?? q.category }));
    data.本课 = { id: ref, 标题: def?.title, 语法要点: def?.points, 状态: s?.status, 最好成绩: pr?.best_score ?? null, 考了几次: pr?.attempts ?? 0, 练习最好成绩: pr?.practice_best ?? null, 最近一次答错的题: wrong };
  }

  // 指纹：只取会影响点评的数，分钟数按 10 分钟取整，别每多学一分钟就重写一次
  const fingerprint = createHash('sha1')
    .update(JSON.stringify([
      'v2', today, plan.plan?.version, plan.passedCount, Math.floor(minutesToday / 10), Math.floor((reviews.today as number) / 10), cards.total, cards.due, newLeft, roundCount, hardTotal,
      prog.rows.reduce((s, r) => s + (r.attempts as number), 0), prog.rows.filter((r) => r.practiced_today).length, videos.today, mistakes.rows.reduce((s, r) => s + (r.n as number), 0),
      speaking.today, phrases.today, listening.today, reading.today, writing.today, pronunciation.today, kanji.today, expressions.today, talk.today,
    ]))
    .digest('hex');

  return { data, fingerprint, facts: { minutesToday, reviewsToday: reviews.today as number, againToday: reviews.today_again as number, passedToday, run, due: cards.due as number, fresh: cards.fresh as number, current, plan, mistakes: mistakes.rows, weak, struggling, title, dailyMinutes: plan.plan?.dailyMinutes ?? null, newLeft, hardTotal, hardFronts: hard.rows.map((r) => r.front as string), lastRound: rounds.rows[0] as Row | undefined, recentMistakes: recentMistakes.rows, today } };
}

/* ───────────── 规则版（没有 AI Key 时，同样要像她本人） ───────────── */

function rulesNote(kind: CoachKind, c: Awaited<ReturnType<typeof context>>): Draft {
  const f = c.facts;
  const highlights: string[] = [];
  const suggestions: CoachSuggestion[] = [];
  const goal = f.dailyMinutes;

  if (f.due > 0) suggestions.push({ text: `先把到期的 ${f.due} 张卡片复习掉`, detail: `遗忘曲线排到今天的卡，拖到明天会更难记。大约要 ${Math.max(1, Math.round(f.due * 0.25))} 分钟，到期清零就算完成。`, action: 'review', lessonId: null });
  else if (f.newLeft > 0 && f.reviewsToday === 0) suggestions.push({ text: '今天的新卡还没背，先翻几张', detail: '到期的卡已经清了，翻几张新卡就算完成。', action: 'review', lessonId: null });
  if (f.hardTotal > 0) {
    const words = f.hardFronts.slice(0, 3).map((w) => `「${w}」`).join('');
    const last = f.lastRound?.scope === 'hard' ? `上一轮 ${f.lastRound.score} 分。` : '';
    suggestions.push({ text: `重学还没记牢的 ${f.hardTotal} 张卡`, detail: `${last}重点是${words}。一轮翻完，第一次就记住的比例到 70 分算过；记住的卡会从名单上下来。`, action: 'review', restudy: 'hard', lessonId: null });
  }

  if (kind === 'lesson') {
    const l = c.data.本课 as { id: string; 最好成绩: number | null; 最近一次答错的题: unknown[] };
    const wrong = l.最近一次答错的题.length;
    highlights.push(l.最好成绩 != null ? `这一课最好成绩 ${l.最好成绩} 分${wrong ? `，最近一次错了 ${wrong} 题` : '，全对'}` : '这一课还没有成绩');
    if (wrong) suggestions.unshift({ text: '把本课练习再做一遍，重点看错过的地方', detail: `最近一次错了 ${wrong} 题，先回讲解里找到对应的语法点，再把练习做完。`, action: 'practice', lessonId: l.id });
  }
  const stuck = f.struggling[0];
  if (stuck) {
    highlights.push(`「${f.title(stuck.lesson_id as string)}」考了 ${stuck.attempts} 次还没过，最好 ${stuck.best_score} 分`);
    suggestions.push({ text: `回头把「${f.title(stuck.lesson_id as string)}」的练习再做一遍`, detail: `最好成绩 ${stuck.best_score} 分，还差一点。先把练习做完，再回去考小测。`, action: 'practice', lessonId: stuck.lesson_id as string });
  } else if (f.current) {
    suggestions.push({ text: `继续「${f.current.title}」`, detail: `学完能：${f.current.goal}。小测过关就算完成。`, action: 'lesson', lessonId: f.current.id });
  }
  if (f.mistakes.length) {
    const top = f.mistakes[0];
    highlights.push(`未掌握的错题里「${CATEGORY_ZH[top.category as string] ?? top.category}」最多，有 ${top.n} 道`);
    suggestions.push({ text: '去错题本重练一轮', detail: `从「${CATEGORY_ZH[top.category as string] ?? top.category}」开始。重练正确率到 70%，或者把确实会了的题标记掌握，就算完成。`, action: 'mistakes', lessonId: null });
  }
  if (f.weak[0]) highlights.push(`「${f.title(f.weak[0].lesson_id as string)}」只拿了 ${f.weak[0].best_score} 分，过是过了，并不漂亮`);
  const behind = f.plan.behindBy;
  if (f.plan.plan) {
    if (behind >= 2) highlights.push(`比计划落后 ${behind} 站，这几天每天多走一点就能追上`);
    else if (behind <= -2) highlights.push(`比计划提前 ${-behind} 站`);
    else highlights.push(`进度正常：${f.plan.passedCount}/${f.plan.totalCount} 站`);
    if (f.plan.projectedFinish && f.plan.projectedFinish > f.plan.plan.targetDate) highlights.push(`按每天 ${f.plan.plan.dailyMinutes} 分钟，要到 ${f.plan.projectedFinish} 才能到站，晚于期限 ${f.plan.plan.targetDate}，需要调整计划`);
  } else {
    suggestions.push({ text: '先定一个学习计划，本小姐才好替您排路线', detail: '选好终点、期限和每天能学多久，系统会算出学时和到站日。', action: 'plan', lessonId: null });
  }

  // 今天学得怎样：这是"实时点评"的核心
  let title: string;
  let summary: string;
  if (kind === 'lesson') {
    title = '本站小结';
    summary = '这一站的账，本小姐替您记下了。';
  } else if (kind === 'weekly') {
    title = '本周回顾';
    summary = f.run >= 3 ? `连续学了 ${f.run} 天，这一周还算像样。` : '这一周断断续续的。……本小姐不是在责备您，只是陈述事实。';
  } else if (f.passedToday.length) {
    title = '今天到站了';
    summary = `「${f.passedToday[f.passedToday.length - 1]}」已经过关。勉强及格。……别误会，只是本小姐的要求比较高。`;
  } else if (f.minutesToday === 0 && f.reviewsToday === 0) {
    title = f.run >= 2 ? `别断了这 ${f.run} 天` : f.due > 0 ? '先复习，再上新课' : '今天还没开始';
    summary = f.run >= 2 ? `已经连续 ${f.run} 天了，今天还一分钟都没学。……红茶都泡好了，本小姐可没有在等您。` : '今天的路线已经排好了，从第一步开始就行。……本小姐可没有在等您。';
  } else if (goal && f.minutesToday >= goal) {
    title = '今天的量够了';
    summary = `今天学了 ${f.minutesToday} 分钟，达到了您自己定的 ${goal} 分钟。勉强及格。……早点休息，这只是陈述事实，不是关心。`;
  } else if (f.reviewsToday >= 10 && f.againToday / f.reviewsToday > 0.4) {
    title = '今天忘得有点多';
    summary = `复习了 ${f.reviewsToday} 次，按了 ${f.againToday} 次重来。不要紧，这说明这些词确实需要多见几面。新卡先缓一缓吧。`;
  } else {
    title = '还不错，继续';
    summary = `今天已经学了 ${f.minutesToday} 分钟${f.reviewsToday ? `，复习了 ${f.reviewsToday} 张卡` : ''}${goal ? `，离 ${goal} 分钟还差 ${Math.max(0, goal - f.minutesToday)} 分钟` : ''}。……继续吧，本小姐看着呢。`;
  }
  if (f.run >= 2 && kind === 'live' && f.minutesToday > 0) highlights.push(`已经连续学了 ${f.run} 天`);
  // 分段的详细分析：规则版只陈述能确定的事实
  const sections: NonNullable<Draft['sections']> = [
    { title: '今天学得怎样', body: f.minutesToday || f.reviewsToday ? `今天学了 ${f.minutesToday} 分钟${goal ? `（目标 ${goal} 分钟）` : ''}，复习 ${f.reviewsToday} 次，其中按了 ${f.againToday} 次重来。连续学习 ${f.run} 天。` : `今天还没有学习记录。现在有 ${f.due} 张卡到期，${f.fresh} 张新卡没学。` },
  ];
  const weakParts = [
    f.hardTotal ? `有 ${f.hardTotal} 张卡还没记牢${f.hardFronts.length ? `，比如${f.hardFronts.slice(0, 3).map((w) => `「${w}」`).join('')}` : ''}` : '',
    f.mistakes.length ? `未掌握的错题 ${f.mistakes.reduce((s, r) => s + (r.n as number), 0)} 道，最多的是「${CATEGORY_ZH[f.mistakes[0].category as string] ?? f.mistakes[0].category}」` : '',
    f.weak[0] ? `「${f.title(f.weak[0].lesson_id as string)}」只拿了 ${f.weak[0].best_score} 分` : '',
  ].filter(Boolean);
  sections.push({ title: '薄弱点', body: weakParts.length ? `${weakParts.join('；')}。` : '目前没有明显的薄弱点，但数据还不多，继续往前走。' });
  if (f.plan.plan) sections.push({ title: '节奏和计划', body: `已走 ${f.plan.passedCount}/${f.plan.totalCount} 站，预计 ${f.plan.projectedFinish} 到站，期限是 ${f.plan.plan.targetDate}。` });
  return { title, summary, highlights: highlights.slice(0, 4), sections, suggestions: suggestions.slice(0, 3) };
}

/* ───────────── 取或写 ───────────── */

const sanitize = (r: Awaited<ReturnType<typeof aiCoach>>, hardTotal: number): Draft => ({
  ...r,
  suggestions: r.suggestions.map((s): CoachSuggestion => {
    const lessonId = s.lessonId && LESSON_BY_ID.has(s.lessonId) ? s.lessonId : null;
    if (s.action !== 'restudy') return { text: s.text, detail: s.detail, action: s.action, lessonId };
    return { text: s.text, detail: s.detail, action: 'review', lessonId, restudy: lessonId ? 'lesson' : hardTotal ? 'hard' : 'any' };
  }),
});

async function save(app: FastifyInstance, userId: string, kind: CoachKind, ref: string, content: Draft, source: 'ai' | 'rules', fingerprint: string | null, keepCreatedAt = false) {
  const { rows } = await app.db.query(
    `INSERT INTO coach_notes (id, user_id, kind, ref, content, source, fingerprint) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, kind, ref) DO UPDATE SET content = EXCLUDED.content, source = EXCLUDED.source, fingerprint = EXCLUDED.fingerprint,
       created_at = CASE WHEN $8::boolean THEN coach_notes.created_at ELSE now() END, read_at = NULL
     RETURNING *`,
    [uuid(), userId, kind, ref, JSON.stringify(content), source, fingerprint, keepCreatedAt],
  );
  return rows[0] as Row;
}

/** daily / weekly / lesson：同一 (类型, ref) 只写一次 */
export async function coachNote(app: FastifyInstance, userId: string, kind: CoachKind, ref: string): Promise<CoachNote> {
  const hit = await app.db.query('SELECT * FROM coach_notes WHERE user_id = $1 AND kind = $2 AND ref = $3', [userId, kind, ref]);
  const cached = hit.rows[0];
  if (cached && cached.source === 'ai') return coachToApi(cached);

  const c = await context(app, userId, kind, ref);
  let draft: Draft | null = null;
  try {
    draft = sanitize(await aiCoach(await userAi(app, userId), kind as 'daily' | 'weekly' | 'lesson', c.data), c.facts.hardTotal);
  } catch (e) {
    // 没 Key、AI 不在：已有规则版就沿用，没有就写一份
    if (!(e instanceof AppError)) throw e;
    if (cached) return coachToApi(cached);
  }
  return coachToApi(await save(app, userId, kind, ref, draft ?? rulesNote(kind, c), draft ? 'ai' : 'rules', c.fingerprint));
}

/* ───────────── 建议要能点进去做 ───────────── */

/**
 * 没有到期卡、今天的新卡额度也用完时，复习页是空的：AI 让学生"去复习"，点进去什么也做不了。
 * 还有没记牢的卡就改去重学；连这个也没有，说明这件事已经做完了，直接打勾。
 */
export function routable(s: CoachSuggestion, f: { due: number; newLeft: number; hardTotal: number }): CoachSuggestion {
  if (s.action !== 'review' || s.restudy || f.due > 0 || f.newLeft > 0) return s;
  if (f.hardTotal > 0) return { ...s, restudy: 'hard' };
  return { ...s, restudy: 'any', status: 'done', result: '到期的卡和今天的新卡都学完了，选过重来的卡也都记住了' };
}

/* ───────────── 核验建议 ───────────── */

/** 达标线：写进了 AI 的提示词，改这里要一起改 */
const RESTUDY_PASS = 70;
const MISTAKE_PASS = 70;
const PRACTICE_PASS = 60;

/** 拿"点评写成之后"的学习记录，核对每条建议做了没有、做得够不够 */
async function verify(app: FastifyInstance, userId: string, since: Date | string, list: CoachSuggestion[], f: { due: number; hardTotal: number }): Promise<CoachSuggestion[]> {
  const db = app.db;
  const p = [userId, since];
  const [reviews, rounds, lessons, quizzes, mastered, speaking, listening, talks, videos, planChanged] = await Promise.all([
    db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE rating = 1)::int AS again FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL AND reviewed_at > $2`, p),
    db.query(`SELECT scope, scope_value, total, known, score FROM restudy_rounds WHERE user_id = $1 AND created_at > $2 ORDER BY created_at DESC`, p),
    db.query(`SELECT lesson_id, status, practice_best, passed_at > $2 AS passed_since, practiced_at > $2 AS practiced_since FROM lesson_progress WHERE user_id = $1 AND deleted_at IS NULL`, p),
    db.query(
      `SELECT q.source, q.source_ref, count(*)::int AS total, count(*) FILTER (WHERE a.correct)::int AS correct
         FROM quizzes q JOIN quiz_answers a ON a.quiz_id = q.id AND a.user_id = q.user_id
        WHERE q.user_id = $1 AND q.source IN ('lesson', 'retry') AND a.answered_at > $2 GROUP BY q.source, q.source_ref`,
      p,
    ),
    db.query(`SELECT count(*)::int AS n FROM mistakes WHERE user_id = $1 AND deleted_at IS NULL AND mastered AND mastered_at > $2`, p),
    db.query(
      `SELECT count(*)::int AS n, round(avg(s))::int AS avg FROM (
         SELECT (scores->>'overall')::numeric AS s FROM speaking_attempts WHERE user_id = $1 AND deleted_at IS NULL AND created_at > $2
         UNION ALL SELECT (scores->>'overall')::numeric FROM phrase_attempts WHERE user_id = $1 AND deleted_at IS NULL AND created_at > $2
       ) t`,
      p,
    ),
    db.query(`SELECT count(*)::int AS n, round(avg(score))::int AS avg FROM listening_attempts WHERE user_id = $1 AND deleted_at IS NULL AND created_at > $2`, p),
    db.query(`SELECT count(*)::int AS n, round(avg(score))::int AS avg FROM conversations WHERE user_id = $1 AND deleted_at IS NULL AND status = 'finished' AND finished_at > $2`, p),
    db.query(`SELECT count(*)::int AS n FROM video_progress WHERE user_id = $1 AND deleted_at IS NULL AND updated_at > $2`, p),
    db.query(`SELECT count(*)::int AS n FROM study_plans WHERE user_id = $1 AND deleted_at IS NULL AND updated_at > $2`, p),
  ]);
  const lessonOf = (id: string | null) => lessons.rows.find((r) => r.lesson_id === id);
  const check = (s: CoachSuggestion): Pick<CoachSuggestion, 'status' | 'result'> => {
    const open = { status: 'open' as const, result: null };
    if (s.restudy) {
      // 按日期、按课重学记住的卡一样算数：名单清空就是做到了
      if (s.restudy === 'hard' && f.hardTotal === 0) return { status: 'done', result: '选过重来的卡都记住了' };
      if (s.restudy === 'hard' && rounds.rows.length && !rounds.rows.some((x) => x.scope === 'hard')) return { status: 'open', result: `重学过了，还剩 ${f.hardTotal} 张没记牢` };
      const r = rounds.rows.find((x) => (s.restudy === 'hard' ? x.scope === 'hard' : s.restudy === 'lesson' ? x.scope === 'lesson' && x.scope_value === s.lessonId : true));
      if (!r) return open;
      const text = `重学 ${r.total} 张，第一次就记住 ${r.known} 张，${r.score} 分`;
      return (r.score as number) >= RESTUDY_PASS ? { status: 'done', result: text } : { status: 'retry', result: `${text}，${RESTUDY_PASS} 分才算过` };
    }
    switch (s.action) {
      case 'review': {
        const { n, again } = reviews.rows[0] as { n: number; again: number };
        if (!n) return open;
        const text = `复习了 ${n} 次，按了 ${again} 次重来`;
        return f.due === 0 ? { status: 'done', result: text } : { status: 'open', result: `${text}，还有 ${f.due} 张到期` };
      }
      case 'practice': {
        const l = lessonOf(s.lessonId);
        if (s.lessonId) return l?.practiced_since ? { status: 'done', result: `做过了，这课练习最好 ${l.practice_best} 分` } : open;
        return lessons.rows.some((r) => r.practiced_since) ? { status: 'done', result: '做过练习了' } : open;
      }
      case 'lesson': {
        const q = quizzes.rows.filter((r) => r.source === 'lesson' && (!s.lessonId || r.source_ref === s.lessonId));
        const passed = s.lessonId ? lessonOf(s.lessonId)?.passed_since : lessons.rows.some((r) => r.passed_since);
        if (passed) return { status: 'done', result: '小测过关了' };
        if (!q.length) return open;
        const { correct, total } = q[0] as { correct: number; total: number };
        return lessonOf(q[0].source_ref as string)?.status === 'passed' ? { status: 'done', result: `重考答对 ${correct}/${total}` } : { status: 'retry', result: `小测答对 ${correct}/${total}，还没过关` };
      }
      case 'mistakes': {
        const m = mastered.rows[0].n as number;
        const q = quizzes.rows.filter((r) => r.source === 'retry');
        const total = q.reduce((a, r) => a + (r.total as number), 0);
        const correct = q.reduce((a, r) => a + (r.correct as number), 0);
        if (m) return { status: 'done', result: `标记掌握了 ${m} 道${total ? `，重练答对 ${correct}/${total}` : ''}` };
        if (!total) return open;
        return (correct / total) * 100 >= MISTAKE_PASS ? { status: 'done', result: `重练答对 ${correct}/${total}` } : { status: 'retry', result: `重练答对 ${correct}/${total}，要到 ${MISTAKE_PASS}%` };
      }
      case 'speaking':
      case 'listening':
      case 'talk': {
        const { n, avg } = (s.action === 'speaking' ? speaking : s.action === 'listening' ? listening : talks).rows[0] as { n: number; avg: number | null };
        if (!n) return open;
        const text = `做了 ${n} 次${avg == null ? '' : `，平均 ${avg} 分`}`;
        return avg == null || avg >= PRACTICE_PASS ? { status: 'done', result: text } : { status: 'retry', result: `${text}，要到 ${PRACTICE_PASS} 分` };
      }
      case 'videos':
        return videos.rows[0].n ? { status: 'done', result: `看了 ${videos.rows[0].n} 集` } : open;
      case 'plan':
        // 已有计划时这条的意思是"调整计划"，要真的改过才算
        return planChanged.rows[0].n ? { status: 'done', result: '计划改好了' } : open;
    }
  };
  return list.map((s) => (s.status ? s : { ...s, ...check(s) }));
}

/* ───────────── 实时点评 ───────────── */

const AI_MIN_INTERVAL_MS = 10 * 60_000;
/** 上一份建议有了结果：早点换一份，别让做完的事一直挂着 */
const AI_AFTER_RESULT_MS = 3 * 60_000;
const RULES_BASELINE_MS = 12 * 3600_000;
const AI_FAIL_BACKOFF_MS = 5 * 60_000;
const LIVE_REF = 'current';
const running = new Set<string>();
const failedAt = new Map<string, number>();

function rewriteInBackground(app: FastifyInstance, userId: string, c: Awaited<ReturnType<typeof context>>) {
  if (running.has(userId)) return;
  running.add(userId);
  void (async () => {
    try {
      const draft = sanitize(await aiCoach(await userAi(app, userId), 'live', c.data), c.facts.hardTotal);
      await save(app, userId, 'live', LIVE_REF, draft, 'ai', c.fingerprint);
      failedAt.delete(userId);
    } catch (e) {
      failedAt.set(userId, Date.now());
      app.log.warn({ err: (e as Error).message }, 'coach live rewrite failed');
    } finally {
      running.delete(userId);
    }
  })();
}

export async function liveNote(app: FastifyInstance, userId: string): Promise<CoachNote> {
  const c = await context(app, userId, 'live', LIVE_REF);
  const hit = await app.db.query('SELECT * FROM coach_notes WHERE user_id = $1 AND kind = $2 AND ref = $3', [userId, 'live', LIVE_REF]);
  const row = hit.rows[0] as Row | undefined;
  const fresh = row?.fingerprint === c.fingerprint;
  const verified = async (r: Row, refreshing: boolean): Promise<CoachNote> => {
    const note = coachToApi(r, refreshing);
    const list = note.suggestions.map((s) => routable(s, c.facts));
    return { ...note, suggestions: await verify(app, userId, r.created_at as Date, list, { due: c.facts.due, hardTotal: c.facts.hardTotal }) };
  };

  const hasAi = (await aiKeyStatus(app, userId)).source !== 'none';
  if (!hasAi) {
    // 没有 Key：规则版不花钱，数据一变当场重写
    if (row && fresh && row.source === 'rules') return verified(row, false);
    // 规则版数据一变就重写：核验起点沿用半天内的旧点评，否则刚做完的事立刻又变成"还没做"
    const keep = row?.source === 'rules' && Date.now() - new Date(row.created_at as string).getTime() < RULES_BASELINE_MS;
    return verified(await save(app, userId, 'live', LIVE_REF, rulesNote('live', c), 'rules', c.fingerprint, keep), false);
  }
  if (row && fresh && row.source === 'ai') return verified(row, running.has(userId));

  const before = row ? await verified(row, false) : null;
  const hasResult = before?.suggestions.some((s) => s.status === 'done' || s.status === 'retry');
  if (before) {
    c.data.上一份建议 = before.suggestions.map((s) => ({ 建议: s.text, 状态: s.status === 'done' ? '已完成' : s.status === 'retry' ? '做了但没达标' : '还没做', 结果: s.result }));
  }
  const age = row && row.source === 'ai' ? Date.now() - new Date(row.created_at as string).getTime() : Infinity;
  const failed = failedAt.get(userId);
  const mayCall = age >= (hasResult ? AI_AFTER_RESULT_MS : AI_MIN_INTERVAL_MS) && (!failed || Date.now() - failed >= AI_FAIL_BACKOFF_MS);
  if (mayCall) rewriteInBackground(app, userId, c);
  // AI 写完之前先给一份能看的：有旧的给旧的，一份都没有就当场按规则写
  if (before) return { ...before, refreshing: running.has(userId) };
  return verified(await save(app, userId, 'live', LIVE_REF, rulesNote('live', c), 'rules', null), running.has(userId));
}
