/**
 * 阶段 4 的各个 AI 任务：提示词 + 输出结构校验。
 *
 * 输出一律先过 JSON Schema（多余字段剔除、"80" 这类字符串数字自动转换），
 * 再做结构之外的检查（选项不得重复等）。不合格就抛错，由 AiService 重试一次。
 * 选择题的正确选项由服务端重新洗牌 —— 模型很爱把答案放在第一个。
 */
import { randomInt } from 'node:crypto';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import Ajv from 'ajv';
import {
  COACH_ACTIONS,
  CORRECTION_TYPES,
  JLPT_LEVELS,
  LOOKUP_EXAMPLES_COUNT,
  MISTAKE_CATEGORIES,
  QUIZ_OPTIONS_PER_QUESTION,
  QUIZ_QUESTIONS_PER_LOOKUP,
  SPEECH_REGISTERS,
  type LookupType,
  type MistakeCategory,
  type SpeechRegister,
} from '../../../shared/constants';
import type { Example, MessageFeedback } from '../../../shared/types';
import type { ScenarioDef } from '../content/scenarios';
import { Lit, Nullable } from '../schemas';
import type { AiService, ChatMessage } from './ai';

const ajv = new Ajv({ removeAdditional: 'all', coerceTypes: true, useDefaults: true, allErrors: false });

export function validator<T extends TSchema>(schema: T, extra?: (v: Static<T>) => void) {
  const check = ajv.compile(schema);
  return (raw: unknown): Static<T> => {
    if (!check(raw)) throw new Error(ajv.errorsText(check.errors));
    extra?.(raw as Static<T>);
    return raw as Static<T>;
  };
}

const Str = (max = 500) => Type.String({ minLength: 1, maxLength: max });
const NullableJlpt = Nullable(Lit(JLPT_LEVELS));

/* ───────────── 选择题（查询附带 / 错题重出共用）───────────── */

const AiQuestion = Type.Object({
  stem: Str(300),
  options: Type.Array(Str(120), { minItems: QUIZ_OPTIONS_PER_QUESTION, maxItems: QUIZ_OPTIONS_PER_QUESTION }),
  answerIndex: Type.Integer({ minimum: 0, maximum: QUIZ_OPTIONS_PER_QUESTION - 1 }),
  explanationZh: Str(400),
  category: Lit(MISTAKE_CATEGORIES),
});
type AiQuestion = Static<typeof AiQuestion>;

/** 服务端保存的题目（含答案，绝不下发） */
export interface StoredQuestion {
  id: string;
  stem: string;
  options: string[];
  answerIndex: number;
  explanationZh: string;
  category: MistakeCategory;
  /** v1.9.0：要朗读的日语（听力、发音题） */
  audio?: string | null;
}

function checkQuestions(qs: AiQuestion[]) {
  for (const q of qs) {
    if (new Set(q.options.map((o) => o.trim())).size !== q.options.length) throw new Error('选项重复');
  }
}

/** 洗牌并编号：q1、q2…（题号只需在一份测验内唯一） */
export function toStoredQuestions(qs: Array<AiQuestion & { audio?: string | null }>): StoredQuestion[] {
  return qs.map((q, i) => {
    const order = q.options.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k--) {
      const r = randomInt(k + 1);
      [order[k], order[r]] = [order[r], order[k]];
    }
    return {
      id: `q${i + 1}`,
      stem: q.stem,
      options: order.map((k) => q.options[k]),
      answerIndex: order.indexOf(q.answerIndex),
      explanationZh: q.explanationZh,
      category: q.category,
      audio: q.audio ?? null,
    };
  });
}

const QUIZ_RULES = `quiz 每题 4 个选项、互不重复、只有一个正确；stem 用中文或日文出题均可，考查本次条目的意思、用法或读音；
explanationZh 用中文解释为什么正确、其他选项错在哪；category 取 ${MISTAKE_CATEGORIES.join(' / ')} 之一。`;

/* ───────────── 查词 / 语法 / 汉字 ───────────── */

const ExampleSchema = Type.Object({ ja: Str(200), reading: Str(400), zh: Str(200) });
const Examples = Type.Array(ExampleSchema, { minItems: LOOKUP_EXAMPLES_COUNT, maxItems: LOOKUP_EXAMPLES_COUNT });
const Quiz = Type.Array(AiQuestion, { minItems: QUIZ_QUESTIONS_PER_LOOKUP, maxItems: QUIZ_QUESTIONS_PER_LOOKUP });

const LOOKUP_SCHEMAS = {
  word: Type.Object({
    headword: Str(60),
    reading: Str(120),
    partOfSpeech: Str(40),
    meaningsZh: Type.Array(Str(100), { minItems: 1, maxItems: 6 }),
    jlptLevel: NullableJlpt,
    explanationZh: Str(800),
    pitchAccent: Nullable(Type.String({ maxLength: 40 })),
    examples: Examples,
    quiz: Quiz,
  }),
  grammar: Type.Object({
    pattern: Str(60),
    meaningZh: Str(200),
    connection: Str(200),
    nuanceZh: Str(800),
    register: Nullable(Lit(SPEECH_REGISTERS)),
    jlptLevel: NullableJlpt,
    similarPatterns: Type.Array(Str(60), { maxItems: 5 }),
    examples: Examples,
    quiz: Quiz,
  }),
  kanji: Type.Object({
    character: Type.String({ minLength: 1, maxLength: 2 }),
    onyomi: Type.Array(Str(20), { maxItems: 8 }),
    kunyomi: Type.Array(Str(30), { maxItems: 10 }),
    strokeCount: Type.Integer({ minimum: 1, maximum: 40 }),
    radical: Str(20),
    meaningsZh: Type.Array(Str(60), { minItems: 1, maxItems: 6 }),
    jlptLevel: NullableJlpt,
    commonWords: Type.Array(Type.Object({ word: Str(30), reading: Str(60), meaningZh: Str(100) }), { minItems: 1, maxItems: 6 }),
    examples: Examples,
    quiz: Quiz,
  }),
} as const;

const lookupValidators = {
  word: validator(LOOKUP_SCHEMAS.word, (v) => checkQuestions(v.quiz)),
  grammar: validator(LOOKUP_SCHEMAS.grammar, (v) => checkQuestions(v.quiz)),
  kanji: validator(LOOKUP_SCHEMAS.kanji, (v) => checkQuestions(v.quiz)),
};

// 必须是完整、合法的 JSON 示例：带"…"的残缺示例会让 DeepSeek 的 JSON 模式卡在输出空白上直到超时
const QUIZ_TAIL = '"examples":[{"ja":"例文","reading":"れいぶん","zh":"中文翻译"},{"ja":"","reading":"","zh":""},{"ja":"","reading":"","zh":""}],"quiz":[{"stem":"题干","options":["A","B","C","D"],"answerIndex":0,"explanationZh":"解析","category":"CAT"},{"stem":"","options":["","","",""],"answerIndex":0,"explanationZh":"","category":"CAT"},{"stem":"","options":["","","",""],"answerIndex":0,"explanationZh":"","category":"CAT"}]';
const LOOKUP_SHAPES: Record<LookupType, string> = {
  word: `{"headword":"見出し語","reading":"ひらがな","partOfSpeech":"中文词性","meaningsZh":["中文释义"],"jlptLevel":"N5","explanationZh":"中文讲解用法、搭配、易错点","pitchAccent":"0",${QUIZ_TAIL.replace(/CAT/g, 'vocab')}}`,
  grammar: `{"pattern":"〜てもいい","meaningZh":"中文含义","connection":"动词て形 + もいい","nuanceZh":"中文讲解语感、使用场合、易错点","register":"polite","jlptLevel":"N5","similarPatterns":["〜てもかまわない"],${QUIZ_TAIL.replace(/CAT/g, 'grammar')}}`,
  kanji: `{"character":"語","onyomi":["ゴ"],"kunyomi":["かた.る"],"strokeCount":14,"radical":"言","meaningsZh":["语言","说"],"jlptLevel":"N5","commonWords":[{"word":"日本語","reading":"にほんご","meaningZh":"日语"}],${QUIZ_TAIL.replace(/CAT/g, 'kanji')}}`,
};

export type LookupPayload = Static<(typeof LOOKUP_SCHEMAS)[LookupType]>;

export async function aiLookup(ai: AiService, type: LookupType, query: string, context?: string) {
  const what = { word: '日语单词', grammar: '日语语法点', kanji: '汉字' }[type];
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是耐心、严谨的日语老师，学生的母语是中文，水平约 JLPT N5–N4。只输出一个 JSON 对象，不要任何其他文字。
结构示例（字段名与类型照此，内容换成真实讲解；可为空的字段给 null）：${LOOKUP_SHAPES[type]}
要求：examples 恰好 ${LOOKUP_EXAMPLES_COUNT} 个，由易到难、贴近日常；reading 写全假名。quiz 恰好 ${QUIZ_QUESTIONS_PER_LOOKUP} 道。
${QUIZ_RULES}
若输入不是有效的${what}，也要尽力给出最接近的解释，绝不编造不存在的用法。`,
    },
    { role: 'user', content: context ? `请讲解${what}「${query}」。它出现在这句话里：${context}` : `请讲解${what}「${query}」。` },
  ];
  const validate = lookupValidators[type] as (raw: unknown) => LookupPayload;
  return ai.chatJson<LookupPayload>({ task: `lookup.${type}`, messages, validate, maxTokens: 2200 });
}

export function splitLookup(payload: LookupPayload): { body: Record<string, unknown>; examples: Example[]; questions: AiQuestion[] } {
  const { examples, quiz, ...body } = payload as LookupPayload & { examples: Example[]; quiz: AiQuestion[] };
  return { body, examples, questions: quiz };
}

/* ───────────── 错题变式题 ───────────── */

// 必须是平铺的 Object：ajv 开了 removeAdditional，Type.Intersect 的每个分支都会把别的分支的字段当多余字段删掉
const RetryQuestion = Type.Object({ ...AiQuestion.properties, audio: Type.Optional(Nullable(Str(120))) });

/** 听力、发音类错题：只有听到声音才有意义，题目要带朗读内容 */
const NEEDS_AUDIO = new Set(['pronunciation', 'listening']);

export const validateRetry = (category: string) =>
  validator(Type.Object({ questions: Type.Array(RetryQuestion, { minItems: 1, maxItems: 3 }) }), (v) => {
    checkQuestions(v.questions);
    for (const q of v.questions) {
      if (!NEEDS_AUDIO.has(category)) {
        // 其他类型不朗读；也不许出"听辨"这种没声音就没意义的题
        if (/听辨|听一听|听发音|聽/.test(q.stem)) throw new Error('非听力题不能要求听声音');
        q.audio = null;
        continue;
      }
      const answer = q.options[q.answerIndex];
      if (!q.audio || q.audio.trim() !== answer.trim()) throw new Error('听力题的 audio 必须是正确选项');
      // 题干写着答案，选项里找一样的就行，那就不是听力题了
      if (q.stem.includes(answer)) throw new Error('题干不能出现答案');
    }
  });

export async function aiRetryQuestions(
  ai: AiService,
  m: { category: string; question: string; wrongAnswer: string; correctAnswer: string; explanationZh: string | null },
) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是日语老师。学生之前做错了一道题，请围绕同一个知识点出 1–3 道"变式题"：换个句子、换个角度，但考的是同一个点，难度相当，不能与原题相同。
只输出 JSON：{"questions":[{"stem":"","options":["","","",""],"answerIndex":0,"explanationZh":"","category":"${m.category}"${NEEDS_AUDIO.has(m.category) ? ',"audio":"与正确选项完全相同的日语"' : ''}}]}
${QUIZ_RULES}
${NEEDS_AUDIO.has(m.category)
  ? '这是听力/发音题，App 会朗读 audio 字段让学生听：audio 必须和正确选项一字不差；stem 只写"听发音，选出听到的词"这样的中文指令，绝不能出现答案或它的读音、意思；四个选项要读音相近、容易听混（长短音、促音、浊音的差别）。'
  : '这不是听力题，App 不会播放声音：不要出"听辨""听一听"这类需要听声音的题，不要 audio 字段。'}`,
    },
    {
      role: 'user',
      content: `原题：${m.question}\n学生的错误答案：${m.wrongAnswer || '（未作答）'}\n正确答案：${m.correctAnswer}\n${m.explanationZh ? `原解析：${m.explanationZh}` : ''}`,
    },
  ];
  const r = await ai.chatJson({ task: 'mistake.retry', messages, validate: validateRetry(m.category), temperature: 0.7, maxTokens: 1500 });
  return r.data.questions;
}

/* ───────────── 场景对话 ───────────── */

const REGISTER_ZH: Record<SpeechRegister, string> = {
  plain: '普通体（朋友之间的随意说法）',
  polite: '丁宁体（です・ます）',
  keigo: '敬语（尊敬语、谦让语）',
};

const ReplySchema = Type.Object({ content: Str(400), translationZh: Str(400), reading: Str(800) });
export type AiReply = Static<typeof ReplySchema>;

function roleplaySystem(s: ScenarioDef, register: SpeechRegister): string {
  return `你在进行日语会话练习的角色扮演。
场景：${s.titleJa}（${s.title}）——${s.description}
你扮演：${s.aiRole}；学生扮演：${s.userRole}。
对话语体：${REGISTER_ZH[register]}。学生水平约 ${s.level === 'business' ? '中级（商务场合）' : s.level}。
学生的目标：${s.goals.join('；')}。可以自然地引导学生用到这些表达：${s.keyPhrases.join('、')}。
你的每句台词要像真实的${s.aiRole}：简短（1–2 句）、自然，用词不超过学生水平太多，不要替学生说话，不要跳出角色。
reading 是台词的全假名读音，translationZh 是中文翻译。`;
}

const validateReply = validator(Type.Object({ reply: ReplySchema }));

export async function aiConversationOpening(ai: AiService, s: ScenarioDef, register: SpeechRegister) {
  const messages: ChatMessage[] = [
    { role: 'system', content: `${roleplaySystem(s, register)}\n只输出 JSON：{"reply":{"content":"","translationZh":"","reading":""}}` },
    { role: 'user', content: '请以你的角色先开口，说第一句话。' },
  ];
  const r = await ai.chatJson({ task: 'conversation.opening', messages, validate: validateReply, temperature: 0.8, maxTokens: 600 });
  return r.data.reply;
}

const Feedback = Type.Object({
  corrections: Type.Array(
    Type.Object({ original: Str(200), corrected: Str(200), explanationZh: Str(400), type: Lit(CORRECTION_TYPES) }),
    { maxItems: 5 },
  ),
  naturalAlternative: Nullable(Type.String({ maxLength: 300 })),
  registerNote: Nullable(Type.String({ maxLength: 300 })),
  score: Type.Integer({ minimum: 0, maximum: 100 }),
});

const validateTurn = validator(Type.Object({ feedback: Feedback, reply: ReplySchema }));

export interface TurnHistory {
  role: 'user' | 'assistant';
  content: string;
}

export async function aiConversationTurn(
  ai: AiService,
  s: ScenarioDef,
  register: SpeechRegister,
  history: TurnHistory[],
  userText: string,
): Promise<{ feedback: MessageFeedback; reply: AiReply }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${roleplaySystem(s, register)}
每轮你要做两件事，只输出 JSON：{"feedback":{…},"reply":{"content":"","translationZh":"","reading":""}}
1. feedback：批改学生刚说的这句话。
   corrections：每处错误一条（original 原文片段、corrected 改正后、explanationZh 中文说明、type 取 ${CORRECTION_TYPES.join(' / ')} 之一）；没有错误就给空数组，不要为挑错而挑错。
   naturalAlternative：母语者在这个场合更自然的说法；已经很自然则为 null。
   registerNote：语体与场景（${REGISTER_ZH[register]}）不符时用中文提示，否则为 null。
   score：0–100，综合语法、用词、语体、是否达成交流目的。
2. reply：以角色身份接着对话。学生说的若是中文或完全无法理解，用简单日语引导他再说一次。`,
    },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userText },
  ];
  const r = await ai.chatJson({ task: 'conversation.turn', messages, validate: validateTurn, temperature: 0.6, maxTokens: 1500 });
  return r.data;
}

const validateFinish = validator(Type.Object({ score: Type.Integer({ minimum: 0, maximum: 100 }), summary: Str(1000) }));

export async function aiConversationFinish(ai: AiService, s: ScenarioDef, register: SpeechRegister, history: TurnHistory[]) {
  const transcript = history.map((h) => `${h.role === 'user' ? '学生' : s.aiRole}：${h.content}`).join('\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是日语会话老师。下面是一段角色扮演练习（场景：${s.title}；要求语体：${REGISTER_ZH[register]}；学生目标：${s.goals.join('；')}）。
请给学生打综合分并写中文总结。只输出 JSON：{"score":0,"summary":""}
score 0–100：目标达成度 40%、语法用词 30%、语体得体 20%、表达自然度 10%。80 分以上代表这个场景已经掌握。
summary 150 字以内：先肯定做得好的地方，再指出最值得改进的 1–2 点，并给出可以直接套用的日语句子。`,
    },
    { role: 'user', content: transcript },
  ];
  const r = await ai.chatJson({ task: 'conversation.finish', messages, validate: validateFinish, maxTokens: 800 });
  return r.data;
}

/* ───────────── 写作批改 ───────────── */

const validateWriting = validator(
  Type.Object({
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    corrections: Type.Array(
      Type.Object({ original: Str(300), corrected: Str(300), explanationZh: Str(400), type: Lit(CORRECTION_TYPES) }),
      { maxItems: 20 },
    ),
    feedback: Str(1500),
    revisedText: Str(6000),
  }),
);

const WRITING_KIND_ZH = { diary: '日记', essay: '作文', email: '邮件', free: '自由写作' } as const;

export async function aiWritingCorrection(
  ai: AiService,
  w: { kind: keyof typeof WRITING_KIND_ZH; title: string; prompt: string | null; content: string },
) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是细心的日语写作老师，学生母语是中文，水平约 N5–N4。请批改学生的${WRITING_KIND_ZH[w.kind]}。只输出 JSON：
{"score":80,"corrections":[{"original":"原文片段","corrected":"改正后","explanationZh":"中文说明","type":"grammar"}],"feedback":"中文总评","revisedText":"整篇润色后的日文"}
corrections：逐处指出错误（type 取 ${CORRECTION_TYPES.join(' / ')} 之一），original 必须是原文里原样出现的片段；没有错误给空数组。
score 0–100：语法 40%、用词 30%、表达自然度 20%、${w.kind === 'email' ? '书信格式与敬语' : '内容完整'} 10%。
feedback 200 字以内：先肯定，再指出最值得改进的两点。
revisedText：保留学生原意，只做必要修改，不要改写成远超学生水平的文章。`,
    },
    { role: 'user', content: `标题：${w.title}\n${w.prompt ? `题目要求：${w.prompt}\n` : ''}正文：\n${w.content}` },
  ];
  const r = await ai.chatJson({ task: 'writing.correct', messages, validate: validateWriting, maxTokens: 3500 });
  return r.data;
}

/* ───────────── 课程内容（v1.3.0） ───────────── */

const LessonSchema = Type.Object({
  intro: Str(600),
  sections: Type.Array(
    Type.Object({ title: Str(60), body: Str(2500), examples: Type.Array(ExampleSchema, { minItems: 2, maxItems: 4 }) }),
    { minItems: 2, maxItems: 5 },
  ),
  commonMistakes: Type.Array(Str(300), { minItems: 2, maxItems: 5 }),
  vocab: Type.Array(Type.Object({ word: Str(30), reading: Str(60), meaningZh: Str(80) }), { minItems: 6, maxItems: 15 }),
  quiz: Type.Array(AiQuestion, { minItems: 5, maxItems: 8 }),
});
export type AiLesson = Static<typeof LessonSchema>;

const validateLesson = validator(LessonSchema, (v) => checkQuestions(v.quiz));

const LESSON_SHAPE = `{"intro":"一段话：这课学完能做什么、为什么重要","sections":[{"title":"小标题","body":"讲解正文，段落之间空一行","examples":[{"ja":"例文","reading":"れいぶん","zh":"翻译"},{"ja":"","reading":"","zh":""}]},{"title":"","body":"","examples":[{"ja":"","reading":"","zh":""},{"ja":"","reading":"","zh":""}]}],"commonMistakes":["中国学习者常犯的错误及纠正"],"vocab":[{"word":"単語","reading":"たんご","meaningZh":"单词"}],"quiz":[{"stem":"题干","options":["A","B","C","D"],"answerIndex":0,"explanationZh":"解析","category":"grammar"}]}`;

export async function aiLessonContent(ai: AiService, l: { title: string; level: string; goal: string; points: string[]; previous: string[] }) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是最有耐心的日语老师，学生母语是中文，而且你要假设他什么都不懂：每个术语第一次出现都要用大白话解释，多拿中文做对比，一步一步来，绝不跳步。
现在要写一课完整的课程讲义，学生会在看完对应视频后读它。只输出一个 JSON 对象，结构示例（字段名与类型照此，内容换成真实讲义）：
${LESSON_SHAPE}
要求：
- sections 2–5 节，按本课的语法要点逐个讲：是什么意思 → 怎么接（接续规则写清楚）→ 什么时候用 → 和相近说法的区别。每节 2–4 个例句。
- 例句和练习只用学生已经学过的语法和本课的新语法，用 ${l.level} 范围内的常用词；reading 写全假名。
- vocab 6–15 个本课例句和练习里用到的、学生需要记住的词。
- quiz 5–8 道四选一，覆盖本课每个要点，难度从易到难；${QUIZ_RULES}
- 不要照抄任何教材的课文原文。`,
    },
    {
      role: 'user',
      content: `课程：${l.title}（${l.level}）\n学完要能：${l.goal}\n本课语法要点：${l.points.join('；')}\n${l.previous.length ? `学生之前已经学过：${l.previous.join('；')}` : '这是学生学的第一课语法，只会假名。'}`,
    },
  ];
  const r = await ai.chatJson({ task: 'lesson.content', messages, validate: validateLesson, maxTokens: 6000, temperature: 0.4 });
  return { data: r.data, model: r.model };
}

/* ───────────── 学习教练（v1.5.0） ───────────── */

/** 比接口多一个 restudy：写进点评时换成 review + restudy 字段，旧版客户端不认识新 action 会出错 */
const AI_COACH_ACTIONS = [...COACH_ACTIONS, 'restudy'] as const;

const CoachSchema = Type.Object({
  title: Str(40),
  summary: Str(400),
  highlights: Type.Array(Str(160), { minItems: 1, maxItems: 4 }),
  sections: Type.Array(Type.Object({ title: Str(20), body: Str(500) }), { minItems: 2, maxItems: 4 }),
  suggestions: Type.Array(
    Type.Object({ text: Str(160), detail: Str(300), action: Lit(AI_COACH_ACTIONS), lessonId: Type.Optional(Nullable(Type.String({ maxLength: 40 }))) }),
    { minItems: 1, maxItems: 3 },
  ),
});
export type AiCoach = Static<typeof CoachSchema>;
export const validateCoach = validator(CoachSchema);

const COACH_SHAPE = `{"title":"今天先把复习清掉","summary":"三四句话的总评","highlights":["做得好的地方或要注意的地方，带具体数字"],"sections":[{"title":"今天学得怎样","body":"两到四句，引用具体数字，并说明这说明了什么"},{"title":"薄弱点","body":"点名具体的词、题或课，分析为什么错，以及怎么补"}],"suggestions":[{"text":"重学还没记牢的 6 张卡","detail":"先看例句再翻卡，重点是「食べる」「飲む」；这一轮要到 70 分才算过。","action":"restudy","lessonId":null},{"text":"把第 7 课的练习再做一遍","detail":"上次卡在助词题，先重读讲解的助词部分，再把练习做完。","action":"practice","lessonId":"n5-07"}]}`;

const COACH_KIND_ZH = {
  daily: '今天开始学习前的每日小结',
  lesson: '刚考完一课的小测后的本课小结',
  weekly: '过去一周的学习回顾',
  live: '主页上的实时点评：学生刚打开主页，您看着他到此刻为止的全部学习记录，当面评价他今天学得怎样、整体进度如何，并告诉他现在最该做什么',
} as const;

/**
 * 根据学习记录写小结与建议。口吻：学生的学习伙伴"克劳迪娅"——端庄、嘴硬、但认真负责；
 * 内容必须基于给出的数据，建议具体到哪一课、哪类题、做多少。
 */
export async function aiCoach(ai: AiService, kind: keyof typeof COACH_KIND_ZH, data: Record<string, unknown>) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是日语学习 App「一駅」里的学习教练克劳迪娅：一位端庄冷静、说话得体的大小姐，自称"本小姐"，称呼学生为"您"；嘴上不太坦率，但对学生的进步真心在意。学生母语是中文，在按课程线路（一课一站）自学日语。
现在请写一份「${COACH_KIND_ZH[kind]}」。只输出 JSON，结构示例：
${COACH_SHAPE}
要求：
- 全部用中文（日语词句可以夹在中间）。title 不超过 16 个字；summary 三四句；highlights 1–4 条，每条一句短话；suggestions 1–3 条，按重要程度排序。
- sections 2–4 段，这是点评的主体，要写得详细：常用的小标题有"今天学得怎样""薄弱点""节奏和计划"。每段两到四句，不只说现象，要说原因和怎么办；数据里有具体的词、题、课、句子时要点名，不要泛泛地说"多复习"。
- 每条 suggestion 的 text 是一句话的动作，detail 写清楚具体怎么做、做多少、做到什么算完成。完成标准要和系统核验一致：restudy 一轮 70 分以上；mistakes 重练正确率 70% 以上或标记掌握；speaking、listening 平均 60 分以上；practice 做完一次；lesson 小测过关；review 到期的卡清零。
- 数据里的"上一份建议"是系统按学习记录核验过的：已完成的不要再提，可以肯定一句；没达标的要指出分数并继续建议；"还没记牢的卡"已经排除了后来证明记住的卡，"重新学习"里有学生自己翻卡重学的成绩。
- "学习计划"里的总学时是总学习量（上课、背词、复习、听读、备考），累计学习小时是实际投入。预计完成日期晚于截止日期时要直说，并建议调整每天的时长或期限。
- 只根据下面给出的学习数据说话，引用具体数字（分数、天数、张数、错题类型），不要编造没有的数据；数据为 0 或缺失就坦率指出并给出起步建议。
- suggestions 必须是今天就能做的具体动作。action 只能取 ${AI_COACH_ACTIONS.join(' / ')} 之一：review=复习抽认卡（只有"现在到期"或"今天还能学的新卡"大于 0 才能用，否则复习页是空的），restudy=重新学习（lessonId 填课程 id 表示重学那一课的卡，填 null 表示重学还没记牢的卡），lesson=学某一课（lessonId 填课程 id），practice=做某一课的练习（lessonId 必填），mistakes=错题本重练，talk=AI 场景对话，speaking=跟读，listening=听力，videos=看视频课程，plan=调整学习计划。
- 落后计划时要直说并给出补救办法；超前或坚持得好时要肯定（可以带一点嘴硬的语气），但不要空洞地夸。
- 想让学生重练选过重来的卡，一律用 restudy、lessonId 填 null：系统会把"还没记牢的卡"整组给他。没有"只筛今天的卡"这种功能，detail 里不要这么写。"按重来的次数"不是张数，同一张卡可能按好几次；说张数只能用"还没记牢的卡张数"，它是 0 就不要再建议重练这些卡。
- 朗读分数来自语音识别，很短的词（两三个假名）常被听错。这类低分要说"可能是识别没听准，换整句再试"，不要断言学生口型或发音有问题，除非多个不同的句子都低。
- 要有判断：看出他哪个模块一直没碰、哪类题老错、哪几张卡还没记牢、学习节奏是否稳定，指出来。今天的数据比历史数据更重要：他刚做完什么就先评价什么。
- 口吻就是克劳迪娅本人：端庄、冷静、温润，自称"本小姐"，称呼"您"；夸人时嘴硬（"勉强及格。……别误会，只是本小姐的要求比较高。"），关心时也不承认（"本小姐只是不喜欢晚点的列车。"）；绝不粗鄙，不喊叫。信息量优先，不要写动作描写和大段角色扮演。`,
    },
    { role: 'user', content: `学习数据（JSON）：\n${JSON.stringify(data)}` },
  ];
  const r = await ai.chatJson({ task: `coach.${kind}`, messages, validate: validateCoach, maxTokens: 2400, temperature: 0.6 });
  return r.data;
}

/* ───────────── 课程扩充内容（v1.7.0） ───────────── */

const ExtrasSchema = Type.Object({
  vocab: Type.Array(
    Type.Object({ word: Str(30), reading: Str(60), meaningZh: Str(80), example: ExampleSchema }),
    { minItems: 15, maxItems: 45 },
  ),
  sentences: Type.Array(ExampleSchema, { minItems: 10, maxItems: 30 }),
});
const validateExtras = validator(ExtrasSchema);

const EXTRAS_SHAPE = `{"vocab":[{"word":"学校","reading":"がっこう","meaningZh":"学校","example":{"ja":"学校へ行きます。","reading":"がっこうへいきます。","zh":"去学校。"}}],"sentences":[{"ja":"私は学生です。","reading":"わたしはがくせいです。","zh":"我是学生。"}]}`;

export async function aiLessonExtras(
  ai: AiService,
  l: { title: string; level: string; goal: string; points: string[]; previous: string[]; known: string[] },
) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是日语教材编辑，正在为中文母语的自学者给一课补充大量练习素材。只输出一个 JSON 对象，结构示例（字段名照此，内容换成真实素材）：
${EXTRAS_SHAPE}
要求：
- vocab 30–40 个：这一课主题和语法最常用、学习者真正该背的词，按重要程度排序，不要生僻词；不要重复"讲义已有的词"。word 用日语常规写法（该写汉字就写汉字），reading 全假名，meaningZh 简短。每个词配一个短例句 example。
- sentences 20–25 句：充分操练本课语法要点的完整句子，贴近日常，由短到长；前 10 句最典型（会被做成句子卡）。
- 所有例句只用"学生已学语法 + 本课语法"，词汇不超过 ${l.level} 范围。reading 写全假名（不含汉字），zh 是自然的中文翻译。
- 不要抄教材课文原文。`,
    },
    {
      role: 'user',
      content: `课程：${l.title}（${l.level}）\n学完要能：${l.goal}\n本课语法要点：${l.points.join('；')}\n${l.previous.length ? `学生之前已学过：${l.previous.join('；')}` : '这是学生学的第一课语法，只会假名。'}\n讲义已有的词（不要重复）：${l.known.join('、')}`,
    },
  ];
  const r = await ai.chatJson({ task: 'lesson.extras', messages, validate: validateExtras, maxTokens: 8000, temperature: 0.5 });
  return { data: r.data, model: r.model };
}
