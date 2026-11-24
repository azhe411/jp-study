/**
 * shared/constants.ts —— 契约冻结版 v1.2.0（v1.1.0：原生 App 支持，见 CONTRACT.md §12；v1.2.0：当日档位同步、离线冷启动、最低客户端版本；v1.3.0：学习计划、课程体系、视频课程、应用更新，见 CONTRACT.md §14–§16；v1.4.0：用户自带 AI Key，§17）
 *
 * 所有枚举的唯一来源。前后端只从这里取值，不在别处手写字符串。
 * 每个枚举同时导出 `as const` 数组与对应的联合类型，
 * 数组供运行时校验（Fastify schema / zod），类型供编译期约束。
 */

export const CONTRACT_VERSION = '1.13.0' as const;
export const API_PREFIX = '/api/v1' as const;

/* ───────────────────────── 通用 ───────────────────────── */

export const PAGINATION = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

export const SYNC_LIMITS = {
  pushMaxOps: 200,
  pullDefaultLimit: 500,
  pullMaxLimit: 1000,
  /** 墓碑（软删除记录）保留天数；游标早于此值时 pull 返回 410 */
  tombstoneRetentionDays: 90,
} as const;

export const IDEMPOTENCY = {
  /** clientOpId 记录保留天数 */
  retentionDays: 30,
  /** 响应头：命中重放时为 "true" */
  replayHeader: 'Idempotent-Replayed',
} as const;

export const AUTH = {
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 30,
  refreshCookieName: 'jp_rt',
  refreshCookiePath: '/api/v1/auth',
  passwordMinLength: 8,
  passwordMaxLength: 128,
} as const;

/**
 * 客户端平台（v1.1.0）。由请求头 X-Client-Platform 声明，缺省视为 web。
 * web     —— 浏览器 / PWA：refresh token 走 httpOnly cookie
 * android —— Capacitor 打包的 APK：refresh token 走响应体，存系统安全存储
 * desktop —— Tauri 打包的 Windows 程序：同 android
 */
export const CLIENT_PLATFORMS = ['web', 'android', 'desktop'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];
export const CLIENT_PLATFORM_HEADER = 'X-Client-Platform';
/** 以响应体交付 refresh token 的平台 */
export const BODY_TOKEN_PLATFORMS = ['android', 'desktop'] as const satisfies ReadonlyArray<ClientPlatform>;

/** 原生壳的页面来源；服务端 CORS 默认放行这些（可用环境变量 CORS_ORIGINS 覆盖） */
export const APP_ORIGINS = [
  'https://localhost', // Capacitor（androidScheme: 'https'）
  'http://localhost',
  'tauri://localhost', // Tauri（macOS/Linux）
  'http://tauri.localhost', // Tauri（Windows）
  'https://tauri.localhost',
] as const;

export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export type JlptLevel = (typeof JLPT_LEVELS)[number];

/** 难度：与 JLPT 对齐，另加 business（商务/学术实用） */
export const DIFFICULTY_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1', 'business'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

/** 语体：普通体 / 丁宁体（です・ます）/ 敬语（尊敬・谦让） */
export const SPEECH_REGISTERS = ['plain', 'polite', 'keigo'] as const;
export type SpeechRegister = (typeof SPEECH_REGISTERS)[number];

/* ───────────────────────── 错误码 ───────────────────────── */

export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  INVALID_JSON: 400,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  REFRESH_TOKEN_INVALID: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  VERSION_CONFLICT: 409,
  SYNC_CURSOR_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  IDEMPOTENCY_KEY_REUSED: 422,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  AI_BAD_OUTPUT: 502,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  /** v1.4.0：没有可用的 AI Key（未填写自己的，也没有共享额度） */
  AI_KEY_REQUIRED: 403,
  /** v1.5.0：朗读音频暂时生成不了（语音服务不可用），客户端退回系统朗读 */
  TTS_UNAVAILABLE: 503,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

/* ───────────────────────── 学习模块 ───────────────────────── */

/** 学习模块：用于任务、时长统计、错题来源等 */
export const STUDY_MODULES = [
  'flashcards',
  'scenario',
  'lookup',
  'mistakes',
  'phrases',
  'speaking',
  'listening',
  'writing',
  'reading',
  'pronunciation',
  'keigo',
  'idiom',
  'kanji',
  'vocabTest',
  'course',
  /** v1.3.0：假名 */
  'kana',
  /** v1.3.0：课程体系中的一课 */
  'lesson',
  'other',
] as const;
export type StudyModule = (typeof STUDY_MODULES)[number];

/* ───────────────────────── 任务与周计划 ───────────────────────── */

/** 最小日 / 标准日 / 冲刺日 */
export const DAY_MODES = ['minimal', 'standard', 'sprint'] as const;
export type DayMode = (typeof DAY_MODES)[number];

export const DAY_MODE_DEFAULT_MINUTES: Record<DayMode, number> = {
  minimal: 15,
  standard: 45,
  sprint: 90,
};

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const TASK_STATUSES = ['todo', 'done', 'skipped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/* ───────────────────────── 抽认卡 / FSRS ───────────────────────── */

export const CARD_STATES = ['new', 'learning', 'review', 'relearning'] as const;
export type CardState = (typeof CARD_STATES)[number];

/** FSRS 评分：1 重来 / 2 困难 / 3 良好 / 4 简单 */
export const REVIEW_RATINGS = [1, 2, 3, 4] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];
export const REVIEW_RATING_LABELS: Record<ReviewRating, 'again' | 'hard' | 'good' | 'easy'> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
};

export const CARD_SOURCES = ['manual', 'import', 'lookup', 'reading', 'mistake', 'phrase', 'kanji', 'lesson'] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

export const CARD_IMPORT_MAX = 2000;

/* ───────────────────────── AI ───────────────────────── */

export const LOOKUP_TYPES = ['word', 'grammar', 'kanji'] as const;
export type LookupType = (typeof LOOKUP_TYPES)[number];

export const QUIZ_QUESTIONS_PER_LOOKUP = 3;
export const QUIZ_OPTIONS_PER_QUESTION = 4;
export const LOOKUP_EXAMPLES_COUNT = 3;
/** quizId 有效期（小时），过期后 quiz/check 返回 404 */
export const QUIZ_TTL_HOURS = 72;

/* ───────────────────────── 场景对话 ───────────────────────── */

export const SCENARIO_CATEGORIES = [
  'travel',
  'dailyLife',
  'social',
  'workplace',
  'academic',
  'culture',
  'emergency',
  'entertainment',
  'emotion',
] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

export const SCENARIO_CATEGORY_LABELS: Record<ScenarioCategory, string> = {
  travel: '旅行',
  dailyLife: '日常生活',
  social: '社交',
  workplace: '职场',
  academic: '学术',
  culture: '文化',
  emergency: '紧急',
  entertainment: '娱乐',
  emotion: '情感',
};

export const SCENARIOS_MIN_PER_CATEGORY = 8;

export const CONVERSATION_STATUSES = ['active', 'finished'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** 场景掌握判定：完成对话且平均分 ≥ 此值 */
export const SCENARIO_MASTERY_SCORE = 80;

/* ───────────────────────── 错题本 ───────────────────────── */

export const MISTAKE_CATEGORIES = [
  'vocab',
  'grammar',
  'kanji',
  'particle',
  'conjugation',
  'keigo',
  'idiom',
  'listening',
  'pronunciation',
  'writing',
  'reading',
  'other',
] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

export const MISTAKE_SOURCES = [
  'quiz',
  'conversation',
  'writing',
  'dictation',
  'reading',
  'pronunciation',
  'expression',
  'kanji',
  'vocabTest',
  'manual',
] as const;
export type MistakeSource = (typeof MISTAKE_SOURCES)[number];

export const MISTAKE_SORTS = ['errorCountDesc', 'lastWrongDesc', 'createdDesc'] as const;
export type MistakeSort = (typeof MISTAKE_SORTS)[number];

/* ───────────────────────── 句库 ───────────────────────── */

export const PHRASE_BOOKS = ['travel', 'life'] as const;
export type PhraseBook = (typeof PHRASE_BOOKS)[number];

/* ───────────────────────── 朗读 / 跟读 ───────────────────────── */

/** reading=看文朗读，shadowing=影子跟读 */
export const SPEAKING_MODES = ['reading', 'shadowing'] as const;
export type SpeakingMode = (typeof SPEAKING_MODES)[number];

export const SPEAKING_SOURCE_TYPES = ['phrase', 'reading', 'listening', 'scenario', 'custom'] as const;
export type SpeakingSourceType = (typeof SPEAKING_SOURCE_TYPES)[number];

/** 识别不可用时客户端上报的方式 */
/** nativeSpeech（v1.1.0）：原生壳调用系统语音识别（安卓 SpeechRecognizer 等） */
/** v1.6.0：offlineSpeech = App 内置的离线识别（Vosk 日语小模型），精度较低，评分从宽 */
export const RECOGNITION_METHODS = ['webSpeech', 'nativeSpeech', 'offlineSpeech', 'selfAssessed', 'textCompare'] as const;
export type RecognitionMethod = (typeof RECOGNITION_METHODS)[number];

/* ───────────────────────── 听力 ───────────────────────── */

/** blind=盲听，subtitle=字幕，intensive=精听，dictation=听写 */
export const LISTENING_MODES = ['blind', 'subtitle', 'intensive', 'dictation'] as const;
export type ListeningMode = (typeof LISTENING_MODES)[number];

export const DIFF_OPS = ['equal', 'insert', 'delete', 'replace'] as const;
export type DiffOp = (typeof DIFF_OPS)[number];

/* ───────────────────────── 写作 ───────────────────────── */

export const WRITING_KINDS = ['diary', 'essay', 'email', 'free'] as const;
export type WritingKind = (typeof WRITING_KINDS)[number];

export const WRITING_STATUSES = ['draft', 'submitted', 'corrected', 'failed'] as const;
export type WritingStatus = (typeof WRITING_STATUSES)[number];

export const CORRECTION_TYPES = [
  'grammar',
  'vocab',
  'particle',
  'conjugation',
  'kanji',
  'register',
  'naturalness',
  'punctuation',
] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export const WRITING_MAX_CHARS = 4000;

/* ───────────────────────── 发音 ───────────────────────── */

export const PRONUNCIATION_CATEGORIES = [
  'longVowel',
  'sokuon',
  'hatsuon',
  'dakuon',
  'youon',
  'pitchAccent',
  'other',
] as const;
export type PronunciationCategory = (typeof PRONUNCIATION_CATEGORIES)[number];

/** listen=听辨选择，speak=开口读 */
export const PRONUNCIATION_MODES = ['listen', 'speak'] as const;
export type PronunciationMode = (typeof PRONUNCIATION_MODES)[number];

/* ───────────────────────── 敬语 / 惯用语 ───────────────────────── */

export const EXPRESSION_TYPES = ['keigo', 'idiom'] as const;
export type ExpressionType = (typeof EXPRESSION_TYPES)[number];

export const KEIGO_KINDS = ['sonkeigo', 'kenjougo', 'teineigo'] as const;
export type KeigoKind = (typeof KEIGO_KINDS)[number];

/** 惯用语细分：惯用句 / 四字熟语 / 谚语 / 拟声拟态 */
export const IDIOM_KINDS = ['kanyouku', 'yojijukugo', 'kotowaza', 'onomatopoeia'] as const;
export type IdiomKind = (typeof IDIOM_KINDS)[number];

export const EXPRESSION_DRILL_MODES = ['meaning', 'convert', 'fillBlank'] as const;
export type ExpressionDrillMode = (typeof EXPRESSION_DRILL_MODES)[number];

/* ───────────────────────── 汉字 ───────────────────────── */

export const KANJI_DRILL_MODES = ['reading', 'meaning', 'writing'] as const;
export type KanjiDrillMode = (typeof KANJI_DRILL_MODES)[number];

/* ───────────────────────── 词汇量测试 ───────────────────────── */

export const VOCAB_TEST_ITEM_KINDS = ['yesNo', 'choice'] as const;
export type VocabTestItemKind = (typeof VOCAB_TEST_ITEM_KINDS)[number];

/** 词频分段（按频率排名上界），用于抽样与估算 */
export const VOCAB_FREQUENCY_BANDS = [500, 1000, 2000, 3000, 5000, 8000, 12000, 20000] as const;
export const VOCAB_TEST_ITEMS = 60;
export const VOCAB_TEST_TTL_MINUTES = 60;

/** 估算词汇量 → JLPT 等级下界（粗略经验值） */
export const VOCAB_TO_JLPT: ReadonlyArray<{ minVocab: number; level: JlptLevel }> = [
  { minVocab: 10000, level: 'N1' },
  { minVocab: 6000, level: 'N2' },
  { minVocab: 3700, level: 'N3' },
  { minVocab: 1500, level: 'N4' },
  { minVocab: 0, level: 'N5' },
];

/* ───────────────────────── 课程（B 站外链） ───────────────────────── */

export const COURSE_PLATFORMS = ['bilibili', 'youtube', 'other'] as const;
export type CoursePlatform = (typeof COURSE_PLATFORMS)[number];

export const COURSE_STATUSES = ['planned', 'inProgress', 'paused', 'completed'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/* ───────────────────────── 设置 ───────────────────────── */

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const FURIGANA_MODES = ['always', 'unknownOnly', 'never'] as const;
export type FuriganaMode = (typeof FURIGANA_MODES)[number];

/* ───────────────────────── 导入导出 ───────────────────────── */

export const IMPORT_MODES = ['merge', 'replace'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const EXPORT_FORMAT_VERSION = 1;

/* ───────────────────────── 同步 ───────────────────────── */

/**
 * 可同步实体。pull 返回其全部；push 仅接受 PUSHABLE_ENTITIES。
 * 名称即 SyncChange.entity / SyncOp.entity 的取值。
 */
export const SYNC_ENTITIES = [
  'settings',
  'task',
  /** v1.2.0：某天实际采用的档位。只随 pull 下发，不可 push（改档位会触发服务端生成任务，属于在线操作） */
  'dayPlan',
  'taskTemplate',
  'card',
  'reviewLog',
  'mistake',
  'phrase',
  'phraseAttempt',
  'speakingAttempt',
  'listeningAttempt',
  'readingAttempt',
  'pronunciationAttempt',
  'expressionAttempt',
  'kanjiAttempt',
  'writingEntry',
  'conversation',
  'message',
  'vocabTestResult',
  'course',
  'timeLog',
  'jlptMock',
  /** v1.3.0 */
  'studyPlan',
  'lessonProgress',
  'videoProgress',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/** 离线可写（可进 outbox）的实体 */
export const PUSHABLE_ENTITIES = [
  'settings',
  'task',
  'taskTemplate',
  'card',
  'reviewLog',
  'mistake',
  'phrase',
  'phraseAttempt',
  'speakingAttempt',
  'listeningAttempt',
  'readingAttempt',
  'pronunciationAttempt',
  'expressionAttempt',
  'kanjiAttempt',
  'writingEntry',
  'course',
  'timeLog',
  'jlptMock',
  /** v1.3.0：观看进度可离线记录；学习计划与课程过关需在线（服务端校验） */
  'videoProgress',
] as const satisfies ReadonlyArray<SyncEntity>;
export type PushableEntity = (typeof PUSHABLE_ENTITIES)[number];

/** 只追加（create-only）实体：不会冲突，update/delete 将被 rejected */
export const APPEND_ONLY_ENTITIES = [
  'reviewLog',
  'phraseAttempt',
  'speakingAttempt',
  'listeningAttempt',
  'readingAttempt',
  'pronunciationAttempt',
  'expressionAttempt',
  'kanjiAttempt',
  'timeLog',
] as const satisfies ReadonlyArray<PushableEntity>;

/** 依赖 AI 或服务端状态、必须在线调用的操作（不进 outbox，离线时 UI 置灰） */
export const ONLINE_ONLY_OPERATIONS = [
  /** v1.3.0 */
  'plan.save',
  'lessons.complete',
  /** v1.5.0：本课练习成绩、生成朗读音频、学习教练 */
  'lessons.practice',
  'tts.create',
  'coach.read',
  /** v1.2.0 明确列入：切换当日档位 / 重新生成任务 */
  'tasks.generate',
  'ai.lookup',
  'ai.quizCheck',
  'mistakes.retry',
  'conversations.create',
  'messages.send',
  'writing.submit',
  'vocabTest.start',
  'vocabTest.submit',
  'data.import',
  'data.export',
] as const;
export type OnlineOnlyOperation = (typeof ONLINE_ONLY_OPERATIONS)[number];

export const SYNC_OP_ACTIONS = ['create', 'update', 'delete'] as const;
export type SyncOpAction = (typeof SYNC_OP_ACTIONS)[number];

export const SYNC_RESULT_STATUSES = ['applied', 'duplicate', 'conflict', 'rejected'] as const;
export type SyncResultStatus = (typeof SYNC_RESULT_STATUSES)[number];

/** 冲突解决选项（仅前端 UI 使用，不上送服务端） */
export const CONFLICT_RESOLUTIONS = ['keepLocal', 'keepServer'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

/* ───────────────────────── 学习计划与课程体系（v1.3.0） ───────────────────────── */

/** 学习目标：JLPT 等级或生活目标 */
export const STUDY_GOALS = ['N5', 'N4', 'N3', 'N2', 'N1', 'travel', 'conversation'] as const;
export type StudyGoal = (typeof STUDY_GOALS)[number];

export const STUDY_GOAL_LABELS: Record<StudyGoal, string> = {
  N5: 'JLPT N5', N4: 'JLPT N4', N3: 'JLPT N3', N2: 'JLPT N2', N1: 'JLPT N1', travel: '去日本旅行够用', conversation: '能进行日常会话',
};

/** 起点：完全零基础 / 会假名 / 已有某级水平 */
export const START_LEVELS = ['zero', 'kana', 'N5', 'N4', 'N3', 'N2'] as const;
export type StartLevel = (typeof START_LEVELS)[number];

/** 课程体系的阶段（线路上的区段） */
export const CURRICULUM_PARTS = ['guide', 'kana', 'N5', 'N4', 'N3', 'N2', 'N1'] as const;
export type CurriculumPart = (typeof CURRICULUM_PARTS)[number];

export const LESSON_KINDS = ['guide', 'kana', 'grammar'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_STATUSES = ['locked', 'available', 'passed'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/** 过关线：课程小测得分率 ≥ 此值才算到站 */
export const LESSON_PASS_RATE = 0.8;

/* ───────────────────────── 学习闭环（v1.5.0） ───────────────────────── */

/** 今日路线的站点类型：复习 → 看视频 → 本课练习 → 过关小测 */
export const ROUTE_STEP_KINDS = ['review', 'video', 'practice', 'quiz'] as const;
export type RouteStepKind = (typeof ROUTE_STEP_KINDS)[number];

/** 朗读音频的声音（服务端 TTS_VOICE 的默认值；客户端据此直接拼缓存地址） */
export const TTS_VOICE = 'ja-JP-NanamiNeural';
export const TTS_MAX_CHARS = 400;

/** 预设抽认卡所在的牌组 */
export const LESSON_DECK = '课程';
export const KANA_DECK = '五十音';
/** v1.7.0：每课挑一部分句子做成句子卡（看日文想意思），放在单独的牌组 */
export const SENTENCE_DECK = '课程句子';
export const SENTENCE_CARDS_PER_LESSON = 10;
/** v1.6.0：预设只到当前这一站（0）；还没学到的课的词不提前放，免得五十音没认全就来片假名 */
export const SEED_AHEAD = 0;

/** v1.8.0：这个版本起，安装包才允许从国内下载镜像（裸 IP + http）更新；更早的版本更新器会拒绝 http，继续走香港 */
export const MIRROR_MIN_CLIENT_VERSION = '0.13.0';

/** v1.6.0：学习阶段 —— 由当前所在的站决定，各练习模块据此调整难度 */
export const LEARNING_STAGES = ['kana', 'N5', 'N4', 'N3', 'N2', 'N1', 'done'] as const;
export type LearningStage = (typeof LEARNING_STAGES)[number];

/** 学习教练：每日小结 / 每课小结 / 每周回顾 */
/** live（v1.7.0）：主页上的实时点评，随学习记录变化而更新 */
export const COACH_KINDS = ['daily', 'lesson', 'weekly', 'live'] as const;
export type CoachKind = (typeof COACH_KINDS)[number];
/** 教练建议能跳转到的地方 */
export const COACH_ACTIONS = ['review', 'lesson', 'practice', 'mistakes', 'talk', 'speaking', 'listening', 'videos', 'plan'] as const;
export type CoachAction = (typeof COACH_ACTIONS)[number];

/** 提醒时间 HH:mm（用户本地时间） */
export const REMINDER_TIME_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';

/* ───────────────────────── 用户自带 AI Key（v1.4.0） ───────────────────────── */

/** own：用自己填的 Key；shared：用服务器的共享 Key（站长授予）；none：都没有，AI 功能不可用 */
export const AI_KEY_SOURCES = ['own', 'shared', 'none'] as const;
export type AiKeySource = (typeof AI_KEY_SOURCES)[number];
