/**
 * 课程体系与学习计划（契约 §14）。
 *
 * 解锁规则：起点之前的站一律可学；之后按"已过关的最远一站 + 1"逐站解锁。
 * 计划口径：每站有预计分钟数；可用学时 = 剩余天数 × 每天分钟；
 *           落后站数 = 匀速推算今天应到站数 − 实际到站数。
 */
import { randomInt } from 'node:crypto';
import { LESSON_PASS_RATE, type StartLevel, type StudyGoal } from '../../../shared/constants';
import type { Lesson, LessonSummary, PlanPreview, PlanToday, StudyPlan, StudyPlanInput, VideoRef } from '../../../shared/types';
import { BILI_COURSE_ID, CURRICULUM, LESSON_BY_ID, ORDER_OF, lessonMinutes, pageMeta, planMinutes, type LessonDef, type StaticContent } from '../content/curriculum';
import type { Db, Queryable } from '../db/pool';
import { AppError } from '../lib/errors';
import { addDays, camelRow, localDate } from '../lib/util';
import type { AiService } from './ai';
import { PITCH_WORDS } from '../content/kana';
import { KANA_EXAMPLE } from '../content/kanaExamples';
import { aiLessonContent, aiLessonExtras, toStoredQuestions, type StoredQuestion } from './aiTasks';
import { mergeVocab } from './loop';

type Row = Record<string, unknown>;

export const planToApi = (r: Row) => camelRow<StudyPlan>(r);

const START_AT: Record<StartLevel, string> = { zero: 'guide-0', kana: 'n5-01', N5: 'n4-25', N4: 'n3-01', N3: 'n2-01', N2: 'n1-01' };
const END_AT: Record<StudyGoal, string> = { N5: 'n5-24', N4: 'n4-48', N3: 'n3-21', N2: 'n2-12', N1: 'n1-12', travel: 'n5-24', conversation: 'n4-48' };

export const startOrder = (s: StartLevel) => ORDER_OF.get(START_AT[s])!;
export const endOrder = (g: StudyGoal) => ORDER_OF.get(END_AT[g])!;

function videosOf(l: LessonDef): VideoRef[] {
  return l.pages.map((page) => {
    const m = pageMeta(page)!;
    return { courseId: BILI_COURSE_ID, page, title: m.title, durationSec: m.durationSec };
  });
}

/* ───────────── 进度与解锁 ───────────── */

export async function progressMap(q: Queryable, userId: string) {
  const { rows } = await q.query('SELECT lesson_id, status, best_score FROM lesson_progress WHERE user_id = $1 AND deleted_at IS NULL', [userId]);
  return new Map(rows.map((r) => [r.lesson_id as string, { status: r.status as string, bestScore: r.best_score as number | null }]));
}

export async function loadPlan(q: Queryable, userId: string): Promise<Row | null> {
  const { rows } = await q.query('SELECT * FROM study_plans WHERE user_id = $1 AND deleted_at IS NULL', [userId]);
  return rows[0] ?? null;
}

export async function summaries(q: Queryable, userId: string): Promise<LessonSummary[]> {
  const [prog, plan] = await Promise.all([progressMap(q, userId), loadPlan(q, userId)]);
  const start = plan ? startOrder(plan.start_level as StartLevel) : 1;
  let farthest = 0;
  CURRICULUM.forEach((l, i) => {
    if (prog.get(l.id)?.status === 'passed') farthest = Math.max(farthest, i + 1);
  });
  const reach = Math.max(start, farthest + 1);
  return CURRICULUM.map((l, i) => {
    const p = prog.get(l.id);
    const order = i + 1;
    return {
      id: l.id,
      part: l.part,
      order,
      kind: l.kind,
      title: l.title,
      goal: l.goal,
      minutes: lessonMinutes(l),
      videos: videosOf(l),
      status: p?.status === 'passed' ? 'passed' : order <= reach ? 'available' : 'locked',
      bestScore: p?.bestScore ?? null,
    };
  });
}

/* ───────────── 课程内容 ───────────── */

const generating = new Map<string, Promise<StaticContent & { quiz: Parameters<typeof toStoredQuestions>[0] }>>();

/** 取 AI 生成的讲义；没有就生成并缓存。同一课并发请求只生成一次 */
async function aiContent(db: Db, ai: AiService | (() => Promise<AiService>), l: LessonDef) {
  const hit = await db.query('SELECT content FROM lesson_content WHERE lesson_id = $1', [l.id]);
  if (hit.rows[0]) return hit.rows[0].content;
  let p = generating.get(l.id);
  if (!p) {
    // 用户打开时才决定用谁的 Key：讲义缓存全员共享，命中缓存就不需要 Key
    const service = typeof ai === 'function' ? await ai() : ai;
    const idx = CURRICULUM.findIndex((x) => x.id === l.id);
    const previous = CURRICULUM.slice(0, idx).filter((x) => x.kind === 'grammar').flatMap((x) => x.points).slice(-40);
    p = aiLessonContent(service, { title: l.title, level: l.part, goal: l.goal, points: l.points, previous })
      .then(async ({ data, model }) => {
        const content = { ...data, kanaRows: null };
        await db.query(
          'INSERT INTO lesson_content (lesson_id, content, model) VALUES ($1, $2, $3) ON CONFLICT (lesson_id) DO NOTHING',
          [l.id, JSON.stringify(content), model],
        );
        return content;
      })
      .finally(() => generating.delete(l.id));
    generating.set(l.id, p);
  }
  return p;
}

/** 预生成（部署后在后台跑，免得用户第一次打开等半分钟） */
export async function warmLesson(db: Db, ai: AiService, id: string) {
  const l = LESSON_BY_ID.get(id);
  if (l && !l.content) await aiContent(db, ai, l);
}

/** 生成一课的扩充内容（更多生词 + 例句 + 句子）；已有的跳过。warmExtras 脚本批量调用 */
export async function warmExtras(db: Db, ai: AiService, id: string): Promise<'done' | 'skip'> {
  const l = LESSON_BY_ID.get(id);
  if (!l || l.content) return 'skip';
  if ((await db.query('SELECT 1 FROM lesson_extras WHERE lesson_id = $1', [id])).rows[0]) return 'skip';
  const c = await aiContent(db, ai, l);
  const idx = CURRICULUM.findIndex((x) => x.id === id);
  const previous = CURRICULUM.slice(0, idx).filter((x) => x.kind === 'grammar').flatMap((x) => x.points).slice(-40);
  const { data, model } = await aiLessonExtras(ai, { title: l.title, level: l.part, goal: l.goal, points: l.points, previous, known: (c.vocab as Array<{ word: string }>).map((w) => w.word) });
  await db.query('INSERT INTO lesson_extras (lesson_id, vocab, sentences, model) VALUES ($1, $2, $3, $4) ON CONFLICT (lesson_id) DO NOTHING', [
    id, JSON.stringify(data.vocab), JSON.stringify(data.sentences), model,
  ]);
  return 'done';
}

/* 假名课与入门课的小测：从字表随机出题，不用 AI */

type AiQuizQuestion = Parameters<typeof toStoredQuestions>[0][number];

function pick<T>(xs: T[], n: number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function kanaQuiz(l: LessonDef): StoredQuestion[] {
  if (l.id === 'kana-5') {
    return toStoredQuestions([
      { stem: '日语的"声调"主要靠什么区分？', options: ['音的高低', '四个声调', '音的长短', '音量大小'], answerIndex: 0, explanationZh: '日语靠一个词内部各拍的高低区分，没有中文那样的四声。', category: 'pronunciation' },
      { stem: '声调标记 ⓪（平板型）是什么意思？', options: ['第一拍低，后面高，接助词也高', '第一拍高，后面低', '第二拍高，之后降', '每拍一样高'], answerIndex: 0, explanationZh: '平板型：第一拍低，从第二拍起一直高。', category: 'pronunciation' },
      { stem: '「箸（筷子）」和「橋（桥）」的区别在于？', options: ['声调高低不同', '读音完全不同', '一个有长音', '一个有促音'], answerIndex: 0, explanationZh: '两个都读 はし，箸 是头高型，橋 是尾高型。', category: 'pronunciation' },
      { stem: '刚开始学，声调最好怎么练？', options: ['跟着音频模仿', '先把所有词的声调背下来', '用中文四声去套', '完全不用管'], answerIndex: 0, explanationZh: '先求说清楚，声调靠大量模仿慢慢形成语感。', category: 'pronunciation' },
    ]);
  }
  // ぢ/じ、づ/ず 读音相同：按读音去重，免得出现两个一样的选项
  const cells = [...new Map((l.content?.kanaRows ?? []).flat().map((c) => [c.romaji, c])).values()];
  const qs = pick(cells, Math.min(10, cells.length)).map((c, i) => {
    const others = pick(cells.filter((x) => x.romaji !== c.romaji), 3);
    const toRomaji = i % 2 === 0;
    const options = toRomaji ? [c.romaji, ...others.map((o) => o.romaji)] : [c.kana, ...others.map((o) => o.kana)];
    return {
      stem: toRomaji ? `「${c.kana}」怎么读？` : `读音 ${c.romaji} 对应哪个假名？`,
      options,
      answerIndex: 0,
      explanationZh: `${c.kana} 读作 ${c.romaji}。`,
      category: 'pronunciation' as const,
    };
  });
  return toStoredQuestions(qs);
}

/** 用本课单词表出的题：读音、词义、日语说法三种轮着来，每次抽到的词不同 */
function vocabQuestions(vocab: Lesson['vocab'], n: number): AiQuizQuestion[] {
  const hasKanji = (s: string) => /[\u4e00-\u9fff]/.test(s);
  const words = [...new Map(vocab.filter((w) => w.word && w.reading && w.meaningZh).map((w) => [w.word, w])).values()];
  const others = (right: string, pool: string[]) => pick([...new Set(pool.filter((x) => x && x !== right))], 3);
  const out: AiQuizQuestion[] = [];
  for (const w of pick(words, words.length)) {
    if (out.length >= n) break;
    const explanationZh = `${w.word}（${w.reading}）：${w.meaningZh}。`;
    const kinds = [
      // 写法和中文一样的词（学生 = 学生）问意思没有意义，只问读音
      hasKanji(w.word) && w.reading !== w.word ? { stem: `「${w.word}」怎么读？`, right: w.reading, pool: words.map((x) => x.reading) } : null,
      w.meaningZh !== w.word ? { stem: `「${w.word}」是什么意思？`, right: w.meaningZh, pool: words.map((x) => x.meaningZh) } : null,
      w.meaningZh !== w.word ? { stem: `「${w.meaningZh}」用日语怎么说？`, right: w.word, pool: words.map((x) => x.word) } : null,
    ].filter((k): k is NonNullable<typeof k> => !!k);
    const k = kinds[out.length % kinds.length] ?? kinds[0];
    if (!k) continue;
    const wrong = others(k.right, k.pool);
    if (wrong.length < 3) continue;
    out.push({ stem: k.stem, options: [k.right, ...wrong], answerIndex: 0, explanationZh, category: 'vocab' });
  }
  return out;
}

/** 讲义题抽 5 道 + 单词题 5 道：重新做时真的换一份题 */
function lessonQuiz(quiz: AiQuizQuestion[], vocab: Lesson['vocab']): StoredQuestion[] {
  // 题干里写着答案的题（「より」的读音是？）不考
  const fair = quiz.filter((q) => {
    const a = q.options[q.answerIndex];
    return !(a.length >= 2 && q.stem.includes(a));
  });
  return toStoredQuestions(pick([...pick(fair, 5), ...vocabQuestions(vocab, 5)], 10));
}

/** 考试旁边的单词表：假名课没有讲义生词，列每个假名的例词；声调课列对比词 */
function wordListOf(def: LessonDef): Lesson['vocab'] {
  if (def.id === 'kana-5') return PITCH_WORDS;
  const words = (def.content?.kanaRows ?? []).flat().flatMap((c) => {
    const ex = KANA_EXAMPLE.get(c.kana);
    return ex ? [{ word: ex.word, reading: ex.word, meaningZh: ex.zh }] : [];
  });
  return [...new Map(words.map((w) => [w.word, w])).values()];
}

function guideQuiz(): StoredQuestion[] {
  return toStoredQuestions([
    { stem: '日语一句话里通常混用哪几种字？', options: ['平假名、片假名、汉字', '只有汉字', '只有假名', '罗马字和汉字'], answerIndex: 0, explanationZh: '三种字混着写：平假名写语法成分，片假名写外来语，汉字写实词。', category: 'other' },
    { stem: '「コーヒー」这样的外来语一般用什么写？', options: ['片假名', '平假名', '汉字', '罗马字'], answerIndex: 0, explanationZh: '外来语、外国人名地名一般用片假名。', category: 'other' },
    { stem: '日语句子的动词一般放在哪里？', options: ['句末', '句首', '主语后面', '随便放'], answerIndex: 0, explanationZh: '日语是"主语—宾语—动词"的语序，动词放在最后。', category: 'grammar' },
    { stem: '每天在本软件里，最推荐的顺序是？', options: ['先复习，再学新课', '只学新课', '只看视频', '一周集中学一次'], answerIndex: 0, explanationZh: '先复习巩固旧内容，再学新课，记得最牢。', category: 'other' },
  ]);
}

export async function lessonFor(db: Db, ai: () => Promise<AiService>, userId: string, id: string): Promise<{ lesson: Lesson; questions: StoredQuestion[] }> {
  const def = LESSON_BY_ID.get(id);
  if (!def) throw new AppError('NOT_FOUND', '这一课不存在');
  const summary = (await summaries(db, userId)).find((s) => s.id === id)!;
  if (summary.status === 'locked') throw new AppError('FORBIDDEN', '先通过前面的课程，这一站才会解锁');

  let content: StaticContent & { quiz?: Parameters<typeof toStoredQuestions>[0] };
  let questions: StoredQuestion[] = [];
  let generated = false;
  if (def.content) {
    content = def.content;
    questions = def.kind === 'guide' ? guideQuiz() : kanaQuiz(def);
  } else {
    content = await aiContent(db, ai, def);
    generated = true;
  }
  const extras = generated ? (await db.query('SELECT vocab, sentences FROM lesson_extras WHERE lesson_id = $1', [id])).rows[0] : null;
  if (generated) questions = lessonQuiz(content.quiz!, mergeVocab(content.vocab, extras?.vocab));
  const lesson: Lesson = {
    ...summary,
    intro: content.intro,
    sections: content.sections,
    commonMistakes: content.commonMistakes,
    vocab: mergeVocab(content.vocab, extras?.vocab),
    sentences: extras?.sentences ?? [],
    kanaRows: content.kanaRows ?? null,
    wordList: def.kind === 'kana' ? wordListOf(def) : mergeVocab(content.vocab, extras?.vocab),
    quiz: { quizId: '', expiresAt: '', questions: [] },
    generated,
  };
  return { lesson, questions };
}

/* ───────────── 过关 ───────────── */

export function scoreOf(questions: StoredQuestion[], answers: Array<{ question_id: string; correct: boolean }>) {
  const correct = questions.filter((q) => answers.find((a) => a.question_id === q.id)?.correct).length;
  const rate = questions.length ? correct / questions.length : 0;
  return { score: Math.round(rate * 100), passed: rate >= LESSON_PASS_RATE };
}

/* ───────────── 计划估算 ───────────── */

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);

function range(input: Pick<StudyPlanInput, 'startLevel' | 'goal'>) {
  const s = startOrder(input.startLevel);
  const e = endOrder(input.goal);
  return CURRICULUM.slice(s - 1, Math.max(s, e));
}

export function preview(input: StudyPlanInput, today: string, passed: Set<string> = new Set()): PlanPreview {
  const lessons = range(input);
  const todo = lessons.filter((l) => !passed.has(l.id));
  // 总学习量，不只是把课过一遍：课上的分钟数见 lessonMinutes
  const totalMinutes = todo.reduce((sum, l) => sum + planMinutes(l), 0);
  const days = Math.max(1, dayDiff(today, input.targetDate) + 1);
  const finishDays = Math.max(1, Math.ceil(totalMinutes / input.dailyMinutes));
  return {
    lessonCount: lessons.length,
    estimatedHours: Math.round(totalMinutes / 6) / 10,
    availableHours: Math.round((days * input.dailyMinutes) / 6) / 10,
    feasible: days * input.dailyMinutes >= totalMinutes,
    projectedFinish: addDays(today, finishDays - 1),
    minutesNeeded: Math.ceil(totalMinutes / days),
    lessonsPerDay: Math.round((todo.length / days) * 100) / 100,
  };
}

export async function planToday(db: Db, userId: string, tz: string): Promise<PlanToday> {
  const today = localDate(tz);
  const planRow = await loadPlan(db, userId);
  const all = await summaries(db, userId);
  const studied = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM time_logs WHERE user_id = $1 AND deleted_at IS NULL AND (started_at AT TIME ZONE $2)::date = $3::date
       UNION ALL SELECT 1 FROM review_logs WHERE user_id = $1 AND deleted_at IS NULL AND (reviewed_at AT TIME ZONE $2)::date = $3::date
       UNION ALL SELECT 1 FROM quiz_answers WHERE user_id = $1 AND (answered_at AT TIME ZONE $2)::date = $3::date
     ) AS yes`,
    [userId, tz, today],
  );
  const studiedToday = studied.rows[0].yes as boolean;
  const minutesToday = Number(
    (
      await db.query(
        `SELECT round(coalesce(sum(duration_ms), 0) / 60000.0)::int AS m FROM time_logs
          WHERE user_id = $1 AND deleted_at IS NULL AND (started_at AT TIME ZONE $2)::date = $3::date`,
        [userId, tz, today],
      )
    ).rows[0].m,
  );

  if (!planRow) {
    const next = all.filter((l) => l.status === 'available').slice(0, 1);
    return { plan: null, nextLessons: next, passedCount: all.filter((l) => l.status === 'passed').length, totalCount: all.length, behindBy: 0, projectedFinish: null, studiedToday, minutesToday };
  }
  const plan = planToApi(planRow);
  const ids = new Set(range(plan).map((l) => l.id));
  const inPlan = all.filter((l) => ids.has(l.id));
  const passed = inPlan.filter((l) => l.status === 'passed');
  const p = preview(plan, today, new Set(passed.map((l) => l.id)));
  const totalDays = Math.max(1, dayDiff(plan.startDate, plan.targetDate) + 1);
  const elapsed = Math.min(totalDays, Math.max(0, dayDiff(plan.startDate, today)));
  // 高级别每站的量大得多，不能按站数匀速算：按学习量算今天应该走到第几站
  const load = (id: string) => planMinutes(LESSON_BY_ID.get(id)!);
  const budget = (inPlan.reduce((s, l) => s + load(l.id), 0) * elapsed) / totalDays;
  let spent = 0;
  let expected = 0;
  for (const l of inPlan) {
    spent += load(l.id);
    if (spent > budget) break;
    expected++;
  }
  const perDay = Math.min(3, Math.max(1, Math.ceil(p.lessonsPerDay)));
  return {
    plan,
    nextLessons: inPlan.filter((l) => l.status !== 'passed').slice(0, perDay),
    passedCount: passed.length,
    totalCount: inPlan.length,
    behindBy: expected - passed.length,
    projectedFinish: passed.length >= inPlan.length ? today : p.projectedFinish,
    studiedToday,
    minutesToday,
  };
}

