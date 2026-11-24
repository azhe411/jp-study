/**
 * 仅开发用：`npm run dev` 打开 `/?preview` 时拦截 /api/v1 请求、返回示例数据，
 * 用来不登录真实账号就检查界面。生产与 App 构建里不会被引用（main.tsx 用 import.meta.env.DEV 守着）。
 */
const now = new Date();
const iso = (d: Date) => d.toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const base = (id: string) => ({ id, createdAt: iso(now), updatedAt: iso(now), deletedAt: null, version: 1 });
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'preview@example.test', displayName: '预览', createdAt: iso(now) };

const task = (n: number, title: string, module: string, minutes: number | null, status = 'todo') => ({
  ...base(`00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`),
  date: today, title, module, targetMinutes: minutes, targetCount: null, status, templateId: 'x', sortOrder: n, link: null, note: null, completedAt: null,
});

const db = {
  tasks: [
    task(1, '复习到期抽认卡', 'flashcards', 15, 'done'),
    task(2, '查 3 个今天遇到的词', 'lookup', 10, 'done'),
    task(3, '餐厅点餐场景对话', 'scenario', 15),
    task(4, '旅行句库跟读 5 句', 'phrases', 10),
    task(5, '听力：在咖啡店点单', 'listening', 10),
    task(6, '错题本重练', 'mistakes', 5),
  ],
};

const card = (n: number, front: string, reading: string, back: string, example?: [string, string]) => ({
  ...base(`00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`),
  deck: '标日初级上', front, back, reading, example: example?.[0] ?? null, exampleTranslation: example?.[1] ?? null, tags: [], source: 'manual', sourceRef: null, jlptLevel: 'N5', suspended: false,
  srs: { state: n % 2 ? 'review' : 'new', due: iso(now), stability: 3, difficulty: 5, elapsedDays: 1, scheduledDays: 1, reps: 2, lapses: 0, lastReviewAt: null },
});

function stats() {
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 86400_000).toISOString().slice(0, 10);
    return { date: d, minutes: [0, 12, 25, 40, 18, 0, 33, 47, 21, 15][i % 10], cardsReviewed: (i * 7) % 30, tasksDone: i % 5 };
  });
  const pts = (vals: number[]) => vals.map((v, i) => ({ date: daily[29 - (vals.length - 1 - i) * 4].date, value: v }));
  return {
    range: { from: daily[0].date, to: today, timezone: 'Asia/Shanghai' },
    streak: { current: 6, longest: 11, studiedToday: true },
    totals: { minutes: 612, cardsReviewed: 438, cardsLearned: 96, tasksDone: 74, conversations: 9, writingEntries: 4 },
    moduleMinutes: [
      { module: 'flashcards', minutes: 214 }, { module: 'scenario', minutes: 132 }, { module: 'phrases', minutes: 88 },
      { module: 'listening', minutes: 71 }, { module: 'lookup', minutes: 56 }, { module: 'mistakes', minutes: 31 },
    ],
    daily,
    mistakes: { total: 37, mastered: 12, open: 25, quizAnswered: 84, quizWrong: 23, errorRate: 0.27 },
    trends: {
      speakingOverall: pts([58, 63, 61, 70, 74, 79]),
      writingScore: pts([62, 68, 71]),
      vocabEstimate: pts([820, 1040]),
      jlptMock: [{ date: daily[10].date, value: 61.5, level: 'N5' }, { date: daily[25].date, value: 72.0, level: 'N5' }],
    },
    scenarioMastery: [
      ['travel', 8, 5, 2, 76], ['dailyLife', 8, 2, 1, 71], ['social', 8, 1, 0, 64], ['workplace', 8, 0, 0, null], ['academic', 8, 0, 0, null],
      ['culture', 8, 1, 1, 82], ['emergency', 8, 0, 0, null], ['entertainment', 8, 2, 0, 69], ['emotion', 8, 0, 0, null],
    ].map(([category, total, attempted, mastered, avgScore]) => ({ category, total, attempted, mastered, avgScore })),
  };
}

function lesson(order: number, id: string, part: string, title: string, status: string, bestScore: number | null = null) {
  return { id, part, order, kind: part === 'guide' ? 'guide' : part === 'kana' ? 'kana' : 'grammar', title, goal: '示例目标', minutes: 60, status, bestScore,
    videos: id === 'kana-1' ? [{ courseId: 'bili-afei-xinbiaori', page: 3, title: '[日语入门]五十音（上）', durationSec: 2647 }] : [] };
}

type Handler = (body: Record<string, unknown> | null, m: RegExpMatchArray) => unknown;
const routes: Array<[string, RegExp, Handler]> = [
  ['POST', /\/auth\/refresh$/, () => ({ accessToken: 'preview', expiresIn: 900, user })],
  ['GET', /\/me$/, () => ({ user, serverTime: iso(new Date()) })],
  ['GET', /\/health$/, () => ({ status: 'ok', version: 'preview', contractVersion: '1.2.0', db: 'ok', ai: 'configured', time: iso(new Date()) })],
  ['GET', /\/settings$/, () => ({
    ...base(user.id),
    data: { timezone: 'Asia/Shanghai', weekPlan: { mon: 'standard', tue: 'standard', wed: 'standard', thu: 'standard', fri: 'minimal', sat: 'sprint', sun: 'minimal' }, dailyGoalMinutes: 45, jlptTarget: 'N4', newCardsPerDay: 20, reviewLimitPerDay: 200, defaultDeck: '默认', speechRate: 1, ttsVoice: null, furiganaMode: 'unknownOnly', theme: 'system', desiredRetention: 0.9 },
  })],
  ['GET', /\/tasks\/today/, () => ({
    date: today, dayMode: 'standard', generated: false, tasks: db.tasks,
    summary: { total: db.tasks.length, done: db.tasks.filter((t) => t.status === 'done').length, plannedMinutes: 65, studiedMinutes: 23, dueCards: 18 },
  })],
  ['PATCH', /\/tasks\/([\w-]+)$/, (b, m) => {
    const t = db.tasks.find((x) => x.id === m[1])!;
    Object.assign(t, { status: b?.status ?? t.status, version: t.version + 1 });
    return t;
  }],
  ['GET', /\/cards\/due/, () => ({
    items: [
      card(1, '食べる', 'たべる', '吃', ['毎朝パンを食べます。', '每天早上吃面包。']),
      card(2, '駅', 'えき', '车站', ['駅まで歩いて十分です。', '走到车站要十分钟。']),
      card(3, '約束', 'やくそく', '约定；约会'),
    ],
    counts: { new: 6, learning: 2, review: 10 },
  })],
  ['GET', /\/cards\/decks$/, () => ({ items: [{ deck: '标日初级上', total: 120, due: 14, new: 20 }, { deck: '默认', total: 31, due: 4, new: 6 }] })],
  ['POST', /\/cards\/([\w-]+)\/review$/, () => ({ card: card(1, '食べる', 'たべる', '吃'), log: {} })],
  ['GET', /\/stats/, () => stats()],
  // v1.4.0
  ['GET', /\/me\/ai-key$/, () => ({ source: 'none', hasOwnKey: false, last4: null, provider: 'deepseek', updatedAt: null })],
  // v1.3.0
  ['GET', /\/plan\/today$/, () => ({ plan: { ...base('p1'), startLevel: 'zero', goal: 'N4', startDate: today, targetDate: '2027-10-29', dailyMinutes: 45, reminderTime: '20:00', lateReminder: true }, nextLessons: [lesson(2, 'kana-1', 'kana', '平假名：五十音图', 'available')], passedCount: 1, totalCount: 54, behindBy: 0, projectedFinish: '2027-08-12', studiedToday: false })],
  ['GET', /\/plan$/, () => ({ ...base('p1'), startLevel: 'zero', goal: 'N4', startDate: today, targetDate: '2027-10-29', dailyMinutes: 45, reminderTime: '20:00', lateReminder: true })],
  ['GET', /\/coach\/live$/, () => ({ ...base('00000000-0000-4000-8000-000000000c01'), kind: 'live', ref: 'current', title: '先把重学补到 70 分', summary: '今天学了 35 分钟，复习 30 张卡，有 11 张选了重来。重学还没记牢的卡只拿了 40 分。', highlights: ['连续学习 4 天', '比计划落后 3 站'], sections: [{ title: '今天学得怎样', body: '复习的量够了，但 11/30 选重来，说明这些词还不稳，尤其是「食べる」和「机」。' }, { title: '薄弱点', body: '发音错题 5 道，「ビル」和「ビール」错了 5 次，长音还没听出来。' }], suggestions: [{ text: '重学还没记牢的 6 张卡', detail: '先看例句再翻卡，一轮到 70 分算过。', action: 'review', restudy: 'hard', lessonId: null, status: 'retry', result: '重学 10 张，第一次就记住 4 张，40 分，70 分才算过' }, { text: '做一次听力练习', detail: '平均 60 分以上算完成。', action: 'listening', lessonId: null, status: 'open', result: null }, { text: '复习到期的卡', detail: '到期清零。', action: 'review', lessonId: null, status: 'done', result: '复习了 30 张，11 张选了重来' }], source: 'ai', readAt: iso(now), refreshing: false })],
  ['GET', /\/lessons\/kana-5$/, () => ({ id: 'kana-5', part: 'kana', order: 6, kind: 'kana', title: '声调入门', goal: '听出高低', minutes: 20, videos: [], status: 'available', bestScore: null, intro: '示例', sections: [], commonMistakes: [], generated: false, vocab: [], sentences: [], kanaRows: [[{ kana: 'はし（箸）', romaji: '1' }, { kana: 'はし（橋）', romaji: '2' }], [{ kana: 'かき（牡蠣）', romaji: '1' }, { kana: 'かき（柿）', romaji: '0' }]], wordList: [{ word: '箸', reading: 'はし', meaningZh: '筷子（高低）' }, { word: '橋', reading: 'はし', meaningZh: '桥（低高）' }], quiz: { quizId: 'q', expiresAt: iso(now), questions: [{ id: 'q1', stem: '示例题', options: ['A', 'B', 'C', 'D'] }] } })],
  ['GET', /\/cards\/restudy\/items/, () => ({ items: [{ ...base('00000000-0000-4000-8000-000000000d01'), front: '食べる', reading: 'たべる', back: '吃', example: null, exampleTranslation: null }, { ...base('00000000-0000-4000-8000-000000000d02'), front: '机', reading: 'つくえ', back: '桌子', example: null, exampleTranslation: null }] })],
  ['POST', /\/cards\/restudy\/rounds$/, () => ({ id: '00000000-0000-4000-8000-000000000d03', score: 50, total: 2, known: 1, previousScore: 40, hardLeft: 1 })],
  ['GET', /\/cards\/restudy$/, () => ({ days: [{ date: today, count: 12, lastScore: 80 }], lessons: [{ lessonId: 'n5-01', order: 5, title: '第 1 课', count: 20, lastScore: null }], hard: { count: 2, lastScore: 40 } })],
  ['POST', /\/plan\/preview$/, (b) => ({ lessonCount: 54, estimatedHours: 98.5, availableHours: 273, feasible: (b?.dailyMinutes as number) >= 20, projectedFinish: '2027-08-12', minutesNeeded: 17, lessonsPerDay: 0.15 })],
  ['GET', /\/curriculum/, () => ({ items: [
    lesson(1, 'guide-0', 'guide', '出发前：日语是什么样的语言', 'passed', 100),
    lesson(2, 'kana-1', 'kana', '平假名：五十音图', 'available'),
    lesson(3, 'kana-2', 'kana', '片假名', 'locked'),
    lesson(4, 'kana-3', 'kana', '浊音、半浊音与长音', 'locked'),
    lesson(7, 'n5-01', 'N5', '第 1 课 · 自我介绍：我是……', 'locked'),
  ] })],
  ['GET', /\/lessons\/([\w-]+)$/, () => ({
    ...lesson(2, 'kana-1', 'kana', '平假名：五十音图', 'available'),
    intro: '平假名是日语最基本的文字。一共 46 个，按"五十音图"排成 10 行 5 列。',
    sections: [{ title: '五十音图怎么读', body: '横着看是"行"，竖着看是"段"。\n\n每个字 = 辅音 + 元音。', examples: [{ ja: 'あい', reading: 'あい', zh: '爱' }, { ja: 'いえ', reading: 'いえ', zh: '家' }] }],
    commonMistakes: ['ぬ 和 め、る 和 ろ 长得像。'],
    vocab: [{ word: 'さかな', reading: 'さかな', meaningZh: '鱼' }],
    kanaRows: [[{ kana: 'あ', romaji: 'a' }, { kana: 'い', romaji: 'i' }, { kana: 'う', romaji: 'u' }, { kana: 'え', romaji: 'e' }, { kana: 'お', romaji: 'o' }], [{ kana: 'か', romaji: 'ka' }, { kana: 'き', romaji: 'ki' }, { kana: 'く', romaji: 'ku' }, { kana: 'け', romaji: 'ke' }, { kana: 'こ', romaji: 'ko' }]],
    quiz: { quizId: 'q', expiresAt: iso(now), questions: [{ id: 'q1', stem: '「か」怎么读？', options: ['ka', 'ki', 'sa', 'ta'] }] },
    generated: false,
  })],
  ['GET', /\/video-courses\/([\w-]+)$/, () => ({ id: 'bili-afei-xinbiaori', title: '新标日 0 基础到中级（阿飞老师）', author: '教日语的阿飞老师', platform: 'bilibili', bvid: 'BV1Bp4y1D747', episodeCount: 200, totalMinutes: 3926, lastPage: 3, completedCount: 1,
    episodes: [
      { page: 2, title: '【必看】课程简介+如何提交作业', section: '入门', durationSec: 557, lessonId: 'guide-0', progress: { positionSec: 557, completed: true, updatedAt: iso(now) } },
      { page: 3, title: '[日语入门]五十音（上）', section: '入门', durationSec: 2647, lessonId: 'kana-1', progress: { positionSec: 812, completed: false, updatedAt: iso(now) } },
      { page: 4, title: '[日语入门]五十音（下）', section: '入门', durationSec: 1291, lessonId: 'kana-2', progress: null },
      { page: 10, title: '第1课：小李是中国人（单词）', section: '初级上', durationSec: 1243, lessonId: 'n5-01', progress: null },
    ] })],
  ['GET', /\/video-courses$/, () => ({ items: [{ id: 'bili-afei-xinbiaori', title: '新标日 0 基础到中级（阿飞老师）', author: '教日语的阿飞老师', platform: 'bilibili', bvid: 'BV1Bp4y1D747', episodeCount: 200, totalMinutes: 3926, lastPage: 3, completedCount: 1 }] })],
  ['GET', /\/courses/, () => ({ items: [], nextCursor: null })],
  // v1.6.0
  ['GET', /\/learn\/stage$/, () => ({ stage: 'kana', currentLesson: lesson(2, 'kana-1', 'kana', '平假名：五十音图', 'available'), knownKana: 'あいうえおかきくけこさしすせそ', sentences: [{ ja: 'あい', reading: 'あい', zh: '爱', lessonId: 'kana-1', lessonTitle: '平假名：五十音图' }] })],
  // v1.5.0
  ['GET', /\/route\/today$/, () => {
    const l = lesson(2, 'kana-1', 'kana', '平假名：五十音图', 'available');
    l.videos = [{ courseId: 'bili-afei-xinbiaori', page: 3, title: '[日语入门]五十音（上）', durationSec: 2647 }];
    const steps = [
      { id: 'review', kind: 'review', lessonId: null, title: '复习抽认卡', detail: '今天复习了 12 张，到期的都清空了', minutes: 1, done: true, link: '/review' },
      { id: 'kana-1:video', kind: 'video', lessonId: 'kana-1', title: '看视频', detail: '约 53 分钟，会记住看到哪里', minutes: 53, done: false, link: '/learn/kana-1#video' },
      { id: 'kana-1:practice', kind: 'practice', lessonId: 'kana-1', title: '读讲解，做本课练习', detail: '听音选词、例句听辨、跟读，都用这一课的内容', minutes: 10, done: false, link: '/learn/kana-1/practice' },
      { id: 'kana-1:quiz', kind: 'quiz', lessonId: 'kana-1', title: '过关小测', detail: '答对 80% 解锁下一站', minutes: 5, done: false, link: '/learn/kana-1#quiz' },
    ];
    return { date: today, lessons: [l], steps, doneCount: 1, cardsSeeded: 46 };
  }],
  ['GET', /\/coach\/(daily|weekly)$/, (_b, m) => ({ id: `c-${m[1]}`, kind: m[1], ref: today, title: '先把五十音的上半张拿下', source: 'ai', createdAt: iso(now), readAt: null,
    summary: '连续学了 6 天，复习也按时清空了。……勉强及格。今天的重点是第 2 站：平假名的前半张表，看完视频就去做练习。',
    highlights: ['抽认卡近 3 天复习 86 次，只选了 4 次"重来"，记得很牢', '第 0 站小测 100 分', '还没碰过跟读：开口练习少了一点'],
    suggestions: [{ text: '看完五十音（上）的视频', action: 'lesson', lessonId: 'kana-1' }, { text: '做第 2 站的听音选假名练习', action: 'practice', lessonId: 'kana-1' }, { text: '去句库跟读 5 句打招呼的话', action: 'speaking', lessonId: null }] })],
  ['GET', /\/coach\/lessons\/([\w-]+)$/, (_b, m) => ({ id: 'c-l', kind: 'lesson', ref: m[1], title: '本站小结', source: 'rules', createdAt: iso(now), readAt: null, summary: '错了两题，都是长得像的字。', highlights: ['ぬ 和 め 分不清'], suggestions: [{ text: '把本课练习再做一遍', action: 'practice', lessonId: m[1] }] })],
  ['POST', /\/coach\/notes\/([\w-]+)\/read$/, () => ({})],
  ['POST', /\/lessons\/([\w-]+)\/practice$/, (b) => ({ progress: {}, score: Math.round(((b?.correct as number) / (b?.total as number)) * 100) })],

];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/api/v1/')) return realFetch(input, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = new URL(url, location.origin).pathname;
  // 朗读音频是公开文件：交给开发服务器代理到真实服务器取
  if (/\/api\/v1\/tts\/[0-9a-f]{40}\.mp3$/.test(path) || path.includes('/api/v1/app/models/')) return realFetch(input, init);
  for (const [m, re, h] of routes) {
    const match = path.match(re);
    if (m === method && match) {
      await new Promise((r) => setTimeout(r, 250));
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify(h(body, match)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  }
  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `预览模式没有 ${method} ${path} 的示例数据`, requestId: 'preview' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
};
console.info('[preview] API 已替换为示例数据');
export {};
