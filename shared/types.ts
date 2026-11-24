/**
 * shared/types.ts —— 契约冻结版 v1.4.0
 *
 * 与 openapi.yaml 一一对应。字段一律 camelCase。
 * 时间：IsoDateTime 为带时区偏移的 ISO 8601（服务端统一输出 UTC "Z"）；
 *       IsoDate 为用户本地日历日 "YYYY-MM-DD"（按 settings.timezone 解释）。
 */

import type {
  AiKeySource,
  CoachAction,
  CoachKind,
  RouteStepKind,
  LearningStage,
  CurriculumPart,
  LessonKind,
  LessonStatus,
  StartLevel,
  StudyGoal,
  CardSource,
  CardState,
  ConversationStatus,
  CorrectionType,
  CoursePlatform,
  CourseStatus,
  DayMode,
  DiffOp,
  DifficultyLevel,
  ErrorCode,
  ExpressionDrillMode,
  ExpressionType,
  FuriganaMode,
  IdiomKind,
  ImportMode,
  JlptLevel,
  KanjiDrillMode,
  KeigoKind,
  ListeningMode,
  LookupType,
  MessageRole,
  MistakeCategory,
  MistakeSource,
  PhraseBook,
  PronunciationCategory,
  PronunciationMode,
  PushableEntity,
  RecognitionMethod,
  ReviewRating,
  ScenarioCategory,
  SpeakingMode,
  SpeakingSourceType,
  SpeechRegister,
  StudyModule,
  SyncEntity,
  SyncOpAction,
  SyncResultStatus,
  TaskStatus,
  Theme,
  VocabTestItemKind,
  Weekday,
  WritingKind,
  WritingStatus,
} from './constants';

/* ═════════════════════════ 基础 ═════════════════════════ */

export type Uuid = string;
export type IsoDateTime = string;
export type IsoDate = string;

/** 所有用户数据实体共有字段 */
export interface BaseEntity {
  id: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** 软删除时间；列表接口默认不返回已删除记录 */
  deletedAt: IsoDateTime | null;
  /** 乐观锁版本号，从 1 开始，每次修改 +1 */
  version: number;
}

/** 所有写请求体共有字段 */
export interface WriteMeta {
  /** 幂等键，UUID v4，由客户端生成；同一操作重试必须复用 */
  clientOpId: Uuid;
}

/** 修改类请求可带：若提供且与服务端不符 → 409 VERSION_CONFLICT */
export interface VersionedWrite extends WriteMeta {
  baseVersion?: number;
}

export interface Page<T> {
  items: T[];
  /** 下一页游标；null 表示没有更多 */
  nextCursor: string | null;
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface ApiError {
  error: {
    code: ErrorCode;
    /** 面向用户的中文友好提示 */
    message: string;
    /** 校验失败时为字段级明细；冲突时含 serverRecord */
    details?: ValidationIssue[] | ConflictDetails | Record<string, unknown>;
    requestId: string;
  };
}

export interface ValidationIssue {
  /** JSON Pointer，如 "/cards/3/front" */
  path: string;
  message: string;
}

export interface ConflictDetails {
  serverVersion: number;
  serverRecord: unknown;
}

/* ═════════════════════════ 认证 ═════════════════════════ */

export interface User {
  id: Uuid;
  email: string;
  displayName: string;
  createdAt: IsoDateTime;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  /** 可选：设备标识，用于 refresh token 按设备管理 */
  deviceId?: string;
}

/**
 * web：refresh token 通过 httpOnly cookie 下发，不出现在响应体。
 * android / desktop（X-Client-Platform）：额外在响应体返回 refreshToken，且不设 cookie。
 */
export interface AuthResult {
  accessToken: string;
  /** 秒 */
  expiresIn: number;
  /** 仅原生 App：新的 refresh token（每次刷新都会轮换，必须覆盖保存） */
  refreshToken?: string;
  /** 仅原生 App：refresh token 有效期（秒） */
  refreshExpiresIn?: number;
  user: User;
}

/** POST /auth/refresh、/auth/logout 的请求体：仅原生 App 使用；web 不传，走 cookie */
export interface RefreshRequest {
  refreshToken?: string;
}

export interface MeResponse {
  user: User;
  /** 服务端当前时间，用于客户端时钟偏移校准 */
  serverTime: IsoDateTime;
}

/* ═════════════════════════ 设置 ═════════════════════════ */

export interface SettingsData {
  /** IANA 时区，默认 "Asia/Shanghai" */
  timezone: string;
  /** 每周默认档位 */
  weekPlan: Record<Weekday, DayMode>;
  dailyGoalMinutes: number;
  jlptTarget: JlptLevel;
  newCardsPerDay: number;
  reviewLimitPerDay: number;
  defaultDeck: string;
  /** TTS 语速 0.5–1.5 */
  speechRate: number;
  /** 优先使用的 speechSynthesis voice 名称；null=自动 */
  ttsVoice: string | null;
  furiganaMode: FuriganaMode;
  theme: Theme;
  /** FSRS 目标保留率 0.7–0.97 */
  desiredRetention: number;
}

export interface Settings extends BaseEntity {
  data: SettingsData;
}

export interface PutSettingsRequest extends VersionedWrite {
  data: SettingsData;
}

/* ═════════════════════════ 任务与模板 ═════════════════════════ */

export interface Task extends BaseEntity {
  date: IsoDate;
  title: string;
  module: StudyModule;
  targetMinutes: number | null;
  targetCount: number | null;
  status: TaskStatus;
  templateId: Uuid | null;
  sortOrder: number;
  /** 可选外链（如 B 站课程某集） */
  link: string | null;
  note: string | null;
  completedAt: IsoDateTime | null;
}

export interface CreateTaskRequest extends WriteMeta {
  /** 可选：客户端生成的 UUID，离线创建时必须提供 */
  id?: Uuid;
  date: IsoDate;
  title: string;
  module: StudyModule;
  targetMinutes?: number | null;
  targetCount?: number | null;
  sortOrder?: number;
  link?: string | null;
  note?: string | null;
}

export interface PatchTaskRequest extends VersionedWrite {
  title?: string;
  module?: StudyModule;
  date?: IsoDate;
  targetMinutes?: number | null;
  targetCount?: number | null;
  status?: TaskStatus;
  sortOrder?: number;
  link?: string | null;
  note?: string | null;
}

/**
 * v1.2.0：某天实际采用的档位（只读同步实体 dayPlan）。
 * 由 GET /tasks/today 首次访问当天时按 settings.weekPlan 写入，或由 POST /tasks/generate 改写；每个用户每天至多一条，不会被删除。
 * 离线时：本地有当天记录就用它；没有就按 settings.weekPlan 推断，联网后以服务端为准。
 */
export interface DayPlan extends BaseEntity {
  date: IsoDate;
  dayMode: DayMode;
}

export interface TodayResponse {
  date: IsoDate;
  dayMode: DayMode;
  /** 是否由本次请求按模板生成 */
  generated: boolean;
  tasks: Task[];
  summary: {
    total: number;
    done: number;
    plannedMinutes: number;
    studiedMinutes: number;
    dueCards: number;
  };
}

export interface GenerateTasksRequest extends WriteMeta {
  date: IsoDate;
  dayMode: DayMode;
  /** true：删除当日由模板生成且未完成的任务后重新生成 */
  regenerate?: boolean;
}

export interface TaskTemplate extends BaseEntity {
  title: string;
  module: StudyModule;
  /** 出现在哪些档位 */
  dayModes: DayMode[];
  /** 出现在哪些星期；空数组=每天 */
  weekdays: Weekday[];
  targetMinutes: number | null;
  targetCount: number | null;
  sortOrder: number;
  active: boolean;
  link: string | null;
}

export interface CreateTaskTemplateRequest extends WriteMeta {
  id?: Uuid;
  title: string;
  module: StudyModule;
  dayModes: DayMode[];
  weekdays?: Weekday[];
  targetMinutes?: number | null;
  targetCount?: number | null;
  sortOrder?: number;
  active?: boolean;
  link?: string | null;
}

export type PatchTaskTemplateRequest = VersionedWrite &
  Partial<Omit<CreateTaskTemplateRequest, 'id' | 'clientOpId'>>;

/* ═════════════════════════ 抽认卡 ═════════════════════════ */

export interface FsrsState {
  state: CardState;
  due: IsoDateTime;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReviewAt: IsoDateTime | null;
}

export interface Card extends BaseEntity {
  deck: string;
  front: string;
  back: string;
  reading: string | null;
  example: string | null;
  exampleTranslation: string | null;
  tags: string[];
  source: CardSource;
  /** 来源实体 id（如 readingMaterialId、mistakeId） */
  sourceRef: string | null;
  jlptLevel: JlptLevel | null;
  suspended: boolean;
  srs: FsrsState;
}

export interface CardInput {
  id?: Uuid;
  deck?: string;
  front: string;
  back: string;
  reading?: string | null;
  example?: string | null;
  exampleTranslation?: string | null;
  tags?: string[];
  source?: CardSource;
  sourceRef?: string | null;
  jlptLevel?: JlptLevel | null;
}

export interface CreateCardRequest extends WriteMeta, CardInput {}

export interface PatchCardRequest extends VersionedWrite {
  deck?: string;
  front?: string;
  back?: string;
  reading?: string | null;
  example?: string | null;
  exampleTranslation?: string | null;
  tags?: string[];
  jlptLevel?: JlptLevel | null;
  suspended?: boolean;
}

export interface ImportCardsRequest extends WriteMeta {
  /** 未在单卡指定 deck 时使用 */
  deck: string;
  cards: CardInput[];
  /** 以 deck+front 判重；true 时重复项更新，false 时跳过 */
  updateExisting?: boolean;
}

export interface ImportCardsResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
}

export interface DueCardsResponse {
  items: Card[];
  counts: { new: number; learning: number; review: number };
}

export interface ReviewLog {
  id: Uuid;
  cardId: Uuid;
  rating: ReviewRating;
  reviewedAt: IsoDateTime;
  durationMs: number;
  stateBefore: CardState;
  scheduledDaysAfter: number;
  createdAt: IsoDateTime;
}

export interface ReviewCardRequest extends WriteMeta {
  /** 离线复习时客户端生成的 ReviewLog id */
  id?: Uuid;
  rating: ReviewRating;
  reviewedAt: IsoDateTime;
  durationMs: number;
}

export interface ReviewCardResult {
  card: Card;
  log: ReviewLog;
}

export interface DeckSummary {
  deck: string;
  total: number;
  due: number;
  new: number;
}

/* ═════════════════════════ AI 查询 ═════════════════════════ */

export interface Example {
  ja: string;
  reading: string;
  zh: string;
}

export interface QuizQuestion {
  id: string;
  stem: string;
  options: string[];
  /** v1.9.0：听力、发音题要朗读的日语；有它时题干不会出现答案，界面要提供播放按钮 */
  audio?: string | null;
}

export interface Quiz {
  quizId: Uuid;
  expiresAt: IsoDateTime;
  questions: QuizQuestion[];
}

export interface LookupRequest {
  type: LookupType;
  query: string;
  /** 可选：所在句子，提升释义准确度 */
  context?: string;
}

interface LookupBase {
  type: LookupType;
  query: string;
  examples: Example[];
  quiz: Quiz;
  /** 是否命中服务端缓存 */
  cached: boolean;
}

export interface WordLookup extends LookupBase {
  type: 'word';
  headword: string;
  reading: string;
  partOfSpeech: string;
  meaningsZh: string[];
  jlptLevel: JlptLevel | null;
  explanationZh: string;
  pitchAccent: string | null;
}

export interface GrammarLookup extends LookupBase {
  type: 'grammar';
  pattern: string;
  meaningZh: string;
  connection: string;
  nuanceZh: string;
  register: SpeechRegister | null;
  jlptLevel: JlptLevel | null;
  similarPatterns: string[];
}

export interface KanjiLookup extends LookupBase {
  type: 'kanji';
  character: string;
  onyomi: string[];
  kunyomi: string[];
  strokeCount: number;
  radical: string;
  meaningsZh: string[];
  jlptLevel: JlptLevel | null;
  commonWords: Array<{ word: string; reading: string; meaningZh: string }>;
}

export type LookupResult = WordLookup | GrammarLookup | KanjiLookup;

export interface QuizCheckRequest extends WriteMeta {
  quizId: Uuid;
  answers: Array<{ questionId: string; choiceIndex: number }>;
  /** 答错的题自动进错题本，默认 true */
  recordMistakes?: boolean;
}

export interface QuizCheckResult {
  correctCount: number;
  total: number;
  results: Array<{
    questionId: string;
    correct: boolean;
    choiceIndex: number;
    answerIndex: number;
    explanationZh: string;
    mistakeId: Uuid | null;
  }>;
}

/* ═════════════════════════ 场景对话 ═════════════════════════ */

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  titleJa: string;
  description: string;
  level: DifficultyLevel;
  register: SpeechRegister;
  /** AI 扮演的角色 */
  aiRole: string;
  /** 学习者扮演的角色 */
  userRole: string;
  goals: string[];
  keyPhrases: string[];
  /** 当前用户掌握情况 */
  progress: { attempts: number; bestScore: number | null; mastered: boolean };
}

export interface Conversation extends BaseEntity {
  scenarioId: string;
  register: SpeechRegister;
  status: ConversationStatus;
  title: string;
  messageCount: number;
  /** 结束时由 AI 给出的综合分 0–100 */
  score: number | null;
  summary: string | null;
  finishedAt: IsoDateTime | null;
}

export interface CreateConversationRequest extends WriteMeta {
  scenarioId: string;
  /** 不传则用场景默认语体 */
  register?: SpeechRegister;
}

export interface CreateConversationResult {
  conversation: Conversation;
  /** AI 开场白 */
  openingMessage: Message;
}

export interface PatchConversationRequest extends VersionedWrite {
  status: 'finished';
}

export interface Correction {
  original: string;
  corrected: string;
  explanationZh: string;
  type: CorrectionType;
}

export interface MessageFeedback {
  corrections: Correction[];
  /** 更自然的说法 */
  naturalAlternative: string | null;
  /** 语体是否与场景匹配的提示 */
  registerNote: string | null;
  score: number;
}

export interface Message {
  id: Uuid;
  conversationId: Uuid;
  role: MessageRole;
  content: string;
  /** assistant 消息的中文翻译 */
  translationZh: string | null;
  reading: string | null;
  /** user 消息的批改；assistant 消息为 null */
  feedback: MessageFeedback | null;
  createdAt: IsoDateTime;
}

export interface SendMessageRequest extends WriteMeta {
  content: string;
}

export interface SendMessageResult {
  userMessage: Message;
  assistantMessage: Message;
  conversation: Conversation;
}

/* ═════════════════════════ 错题本 ═════════════════════════ */

export interface Mistake extends BaseEntity {
  category: MistakeCategory;
  source: MistakeSource;
  sourceRef: string | null;
  question: string;
  wrongAnswer: string;
  correctAnswer: string;
  explanationZh: string | null;
  errorCount: number;
  lastWrongAt: IsoDateTime;
  mastered: boolean;
  masteredAt: IsoDateTime | null;
  tags: string[];
}

export interface CreateMistakeRequest extends WriteMeta {
  id?: Uuid;
  category: MistakeCategory;
  source?: MistakeSource;
  sourceRef?: string | null;
  question: string;
  wrongAnswer: string;
  correctAnswer: string;
  explanationZh?: string | null;
  tags?: string[];
}

export interface PatchMistakeRequest extends VersionedWrite {
  category?: MistakeCategory;
  explanationZh?: string | null;
  mastered?: boolean;
  tags?: string[];
  /** true 时 errorCount+1、lastWrongAt=now（重做再错） */
  incrementError?: boolean;
}

export interface RetryMistakeResult {
  mistakeId: Uuid;
  /** 新出的变式题，用 /ai/quiz/check 判分 */
  quiz: Quiz;
}

/* ═════════════════════════ 句库 / 跟读 ═════════════════════════ */

export interface Phrase extends BaseEntity {
  book: PhraseBook;
  category: string;
  ja: string;
  reading: string;
  zh: string;
  note: string | null;
  /** 是否系统内置（内置句可编辑备注但不可删除） */
  builtin: boolean;
  favorite: boolean;
  bestScore: number | null;
  attemptCount: number;
}

export interface CreatePhraseRequest extends WriteMeta {
  id?: Uuid;
  book: PhraseBook;
  category: string;
  ja: string;
  reading: string;
  zh: string;
  note?: string | null;
}

export interface PatchPhraseRequest extends VersionedWrite {
  category?: string;
  ja?: string;
  reading?: string;
  zh?: string;
  note?: string | null;
  favorite?: boolean;
}

export interface SpeechScores {
  accuracy: number;
  fluency: number;
  completeness: number;
  overall: number;
}

export interface PhraseAttempt {
  id: Uuid;
  phraseId: Uuid;
  transcript: string;
  method: RecognitionMethod;
  durationMs: number;
  scores: SpeechScores;
  diff: DiffSegment[];
  createdAt: IsoDateTime;
}

export interface PhraseAttemptRequest extends WriteMeta {
  id?: Uuid;
  transcript: string;
  method: RecognitionMethod;
  durationMs: number;
  /** method=selfAssessed 时客户端自评 0–100 */
  selfScore?: number;
  attemptedAt?: IsoDateTime;
}

/* ═════════════════════════ 朗读 / 影子跟读 ═════════════════════════ */

export interface DiffSegment {
  op: DiffOp;
  /** 参考文本片段 */
  expected: string;
  /** 用户实际片段 */
  actual: string;
}

export interface SpeakingAttempt {
  id: Uuid;
  mode: SpeakingMode;
  sourceType: SpeakingSourceType;
  sourceId: string | null;
  referenceText: string;
  transcript: string;
  method: RecognitionMethod;
  durationMs: number;
  scores: SpeechScores;
  diff: DiffSegment[];
  createdAt: IsoDateTime;
}

export interface CreateSpeakingAttemptRequest extends WriteMeta {
  id?: Uuid;
  mode: SpeakingMode;
  sourceType: SpeakingSourceType;
  sourceId?: string | null;
  referenceText: string;
  /** v1.6.0：参考文本的假名读音（可选）；识别结果写成假名时也能对上 */
  referenceReading?: string | null;
  transcript: string;
  method: RecognitionMethod;
  durationMs: number;
  selfScore?: number;
  attemptedAt?: IsoDateTime;
}

/* ═════════════════════════ 听力 / 听写 ═════════════════════════ */

export interface ListeningSegment {
  index: number;
  text: string;
  reading: string;
  zh: string;
  /** 若有音频：起止秒；纯 TTS 材料为 null */
  startSec: number | null;
  endSec: number | null;
}

export interface ListeningMaterialSummary {
  id: string;
  title: string;
  level: DifficultyLevel;
  topic: string;
  durationSec: number | null;
  segmentCount: number;
  /** null 表示使用浏览器 TTS 朗读 */
  audioUrl: string | null;
}

export interface ListeningMaterial extends ListeningMaterialSummary {
  segments: ListeningSegment[];
}

export interface DictationRequest {
  materialId: string;
  segmentIndex: number;
  answer: string;
}

export interface DictationResult {
  materialId: string;
  segmentIndex: number;
  expected: string;
  answer: string;
  accuracy: number;
  diff: DiffSegment[];
}

export interface ListeningAttempt {
  id: Uuid;
  materialId: string;
  mode: ListeningMode;
  durationMs: number;
  /** 0–100；盲听/字幕为自评或理解题得分 */
  score: number | null;
  /** 听写模式：每段准确度 */
  segmentScores: Array<{ index: number; accuracy: number }>;
  replays: number;
  createdAt: IsoDateTime;
}

export interface CreateListeningAttemptRequest extends WriteMeta {
  id?: Uuid;
  materialId: string;
  mode: ListeningMode;
  durationMs: number;
  score?: number | null;
  /** 听写模式：上送每段答案，服务端判分 */
  dictationAnswers?: Array<{ index: number; answer: string }>;
  replays?: number;
  attemptedAt?: IsoDateTime;
}

/* ═════════════════════════ 写作 / 日记 ═════════════════════════ */

export interface WritingCorrection {
  score: number;
  corrections: Correction[];
  feedback: string;
  /** 整篇润色版 */
  revisedText: string;
}

export interface WritingEntry extends BaseEntity {
  kind: WritingKind;
  title: string;
  prompt: string | null;
  content: string;
  status: WritingStatus;
  charCount: number;
  correction: WritingCorrection | null;
  submittedAt: IsoDateTime | null;
}

/** 提交批改（在线）；若 id 已存在（草稿），则提交该草稿 */
export interface SubmitWritingRequest extends WriteMeta {
  id?: Uuid;
  kind: WritingKind;
  title: string;
  prompt?: string | null;
  content: string;
}

/* ═════════════════════════ 阅读 ═════════════════════════ */

export interface ReadingMaterialSummary {
  id: string;
  title: string;
  level: DifficultyLevel;
  topic: string;
  charCount: number;
}

export interface ReadingMaterial extends ReadingMaterialSummary {
  /** 正文，可含 <ruby> 注音标记 */
  body: string;
  glossary: Array<{ word: string; reading: string; meaningZh: string }>;
  questions: QuizQuestion[];
}

export interface ReadingAttempt {
  id: Uuid;
  materialId: string;
  durationMs: number;
  charCount: number;
  /** 字/分钟 */
  charsPerMinute: number;
  lookedUpWords: string[];
  comprehensionCorrect: number | null;
  comprehensionTotal: number | null;
  createdAt: IsoDateTime;
}

export interface CreateReadingAttemptRequest extends WriteMeta {
  id?: Uuid;
  materialId: string;
  durationMs: number;
  lookedUpWords?: string[];
  answers?: Array<{ questionId: string; choiceIndex: number }>;
  attemptedAt?: IsoDateTime;
}

/* ═════════════════════════ 发音（最小对立对） ═════════════════════════ */

export interface PronunciationPair {
  id: string;
  category: PronunciationCategory;
  a: { text: string; reading: string; meaningZh: string };
  b: { text: string; reading: string; meaningZh: string };
  tip: string;
}

export interface PronunciationAttempt {
  id: Uuid;
  pairId: string;
  mode: PronunciationMode;
  target: 'a' | 'b';
  /** listen 模式：用户选择 */
  chosen: 'a' | 'b' | null;
  /** speak 模式：识别结果 */
  transcript: string | null;
  method: RecognitionMethod | null;
  correct: boolean;
  createdAt: IsoDateTime;
}

export interface CreatePronunciationAttemptRequest extends WriteMeta {
  id?: Uuid;
  pairId: string;
  mode: PronunciationMode;
  target: 'a' | 'b';
  chosen?: 'a' | 'b';
  transcript?: string;
  method?: RecognitionMethod;
  attemptedAt?: IsoDateTime;
}

/* ═════════════════════════ 敬语 / 惯用语 ═════════════════════════ */

export interface ExpressionItem {
  id: string;
  type: ExpressionType;
  /** type=keigo 时为 KeigoKind，type=idiom 时为 IdiomKind */
  kind: KeigoKind | IdiomKind;
  expression: string;
  reading: string;
  /** 敬语：对应的普通形 */
  plainForm: string | null;
  meaningZh: string;
  usageNote: string;
  examples: Example[];
  level: DifficultyLevel;
}

export interface ExpressionAttempt {
  id: Uuid;
  itemId: string;
  mode: ExpressionDrillMode;
  answer: string;
  correct: boolean;
  createdAt: IsoDateTime;
}

export interface CreateExpressionAttemptRequest extends WriteMeta {
  id?: Uuid;
  itemId: string;
  mode: ExpressionDrillMode;
  answer: string;
  /** 客户端判定结果；服务端对 convert/fillBlank 会复核 */
  correct: boolean;
  attemptedAt?: IsoDateTime;
}

/* ═════════════════════════ 汉字 ═════════════════════════ */

export interface Kanji {
  id: string;
  character: string;
  onyomi: string[];
  kunyomi: string[];
  meaningsZh: string[];
  strokeCount: number;
  radical: string;
  jlptLevel: JlptLevel;
  commonWords: Array<{ word: string; reading: string; meaningZh: string }>;
  progress: { attempts: number; correctRate: number | null; lastAttemptAt: IsoDateTime | null };
}

export interface KanjiAttempt {
  id: Uuid;
  kanjiId: string;
  mode: KanjiDrillMode;
  answer: string;
  correct: boolean;
  createdAt: IsoDateTime;
}

export interface CreateKanjiAttemptRequest extends WriteMeta {
  id?: Uuid;
  kanjiId: string;
  mode: KanjiDrillMode;
  answer: string;
  correct: boolean;
  attemptedAt?: IsoDateTime;
}

/* ═════════════════════════ 词汇量测试 ═════════════════════════ */

export interface VocabTestItem {
  itemId: string;
  kind: VocabTestItemKind;
  word: string;
  /** choice 题选项（中文释义）；yesNo 题为 null */
  options: string[] | null;
}

export interface VocabTestStartRequest extends WriteMeta {
  /** 可选：从哪个等级起测 */
  startLevel?: JlptLevel;
}

export interface VocabTestStartResult {
  testId: Uuid;
  expiresAt: IsoDateTime;
  items: VocabTestItem[];
}

export interface VocabTestSubmitRequest extends WriteMeta {
  testId: Uuid;
  answers: Array<{ itemId: string; known?: boolean; choiceIndex?: number }>;
  durationMs: number;
}

export interface VocabTestResult {
  id: Uuid;
  testId: Uuid;
  estimatedVocab: number;
  jlptEstimate: JlptLevel;
  /** 假词/验证题误报率，越低越可信 */
  falseAlarmRate: number;
  bands: Array<{ upTo: number; knownRate: number }>;
  createdAt: IsoDateTime;
}

/* ═════════════════════════ 课程（外链） ═════════════════════════ */

export interface Course extends BaseEntity {
  title: string;
  platform: CoursePlatform;
  url: string;
  totalEpisodes: number | null;
  currentEpisode: number;
  status: CourseStatus;
  note: string | null;
  lastStudiedAt: IsoDateTime | null;
}

export interface CreateCourseRequest extends WriteMeta {
  id?: Uuid;
  title: string;
  platform: CoursePlatform;
  url: string;
  totalEpisodes?: number | null;
  currentEpisode?: number;
  status?: CourseStatus;
  note?: string | null;
}

export type PatchCourseRequest = VersionedWrite &
  Partial<Omit<CreateCourseRequest, 'id' | 'clientOpId'>> & { lastStudiedAt?: IsoDateTime | null };

/* ═════════════════════════ 统计 ═════════════════════════ */

export interface TimeLog {
  id: Uuid;
  module: StudyModule;
  startedAt: IsoDateTime;
  durationMs: number;
  createdAt: IsoDateTime;
}

export interface CreateTimeLogRequest extends WriteMeta {
  id?: Uuid;
  module: StudyModule;
  startedAt: IsoDateTime;
  durationMs: number;
}

export interface JlptMock extends BaseEntity {
  level: JlptLevel;
  takenAt: IsoDate;
  /** 文字语汇・文法 / 读解 / 听解 等分项 */
  sections: Array<{ name: string; score: number; max: number }>;
  total: number;
  totalMax: number;
  source: string | null;
}

export interface CreateJlptMockRequest extends WriteMeta {
  id?: Uuid;
  level: JlptLevel;
  takenAt: IsoDate;
  sections: Array<{ name: string; score: number; max: number }>;
  source?: string | null;
}

export interface TrendPoint {
  date: IsoDate;
  value: number;
}

export interface StatsResponse {
  range: { from: IsoDate; to: IsoDate; timezone: string };
  streak: { current: number; longest: number; studiedToday: boolean };
  totals: {
    minutes: number;
    cardsReviewed: number;
    cardsLearned: number;
    tasksDone: number;
    conversations: number;
    writingEntries: number;
  };
  moduleMinutes: Array<{ module: StudyModule; minutes: number }>;
  daily: Array<{ date: IsoDate; minutes: number; cardsReviewed: number; tasksDone: number }>;
  mistakes: { total: number; mastered: number; open: number; quizAnswered: number; quizWrong: number; errorRate: number };
  trends: {
    speakingOverall: TrendPoint[];
    writingScore: TrendPoint[];
    vocabEstimate: TrendPoint[];
    /** 百分比（total/totalMax*100） */
    jlptMock: Array<TrendPoint & { level: JlptLevel }>;
  };
  scenarioMastery: Array<{ category: ScenarioCategory; total: number; attempted: number; mastered: number; avgScore: number | null }>;
}

/* ═════════════════════════ 导入导出 / 备份 ═════════════════════════ */

export interface ExportBundle {
  formatVersion: number;
  exportedAt: IsoDateTime;
  user: User;
  /** 每个可同步实体的完整记录（含软删除） */
  entities: Partial<Record<SyncEntity, unknown[]>>;
}

export interface ImportDataRequest extends WriteMeta {
  mode: ImportMode;
  bundle: ExportBundle;
}

export interface ImportDataResult {
  mode: ImportMode;
  counts: Partial<Record<SyncEntity, { created: number; updated: number; skipped: number }>>;
}

export interface BackupStatus {
  lastBackupAt: IsoDateTime | null;
  lastBackupSizeBytes: number | null;
  lastVerifiedAt: IsoDateTime | null;
  lastVerifyOk: boolean | null;
  /** 保留的备份份数 */
  retainedCount: number;
}

/* ═════════════════════════ 同步 ═════════════════════════ */

export interface SyncOp {
  clientOpId: Uuid;
  entity: PushableEntity;
  action: SyncOpAction;
  /** 实体 id（create 时由客户端生成；settings 固定为用户 id） */
  id: Uuid;
  /** update/delete 必填：客户端所基于的服务端版本 */
  baseVersion?: number;
  /** create 为完整对象，update 为变更字段（与对应 REST 请求体同构，去掉 clientOpId） */
  data?: Record<string, unknown>;
  /** 操作在客户端发生的时间 */
  clientTimestamp: IsoDateTime;
}

export interface SyncPushRequest {
  deviceId: string;
  ops: SyncOp[];
}

export interface SyncOpResult {
  clientOpId: Uuid;
  entity: PushableEntity;
  id: Uuid;
  status: SyncResultStatus;
  /** applied/duplicate：写入后的版本 */
  version?: number;
  /** applied/duplicate：服务端最终记录（可能经服务端补全，如评分） */
  record?: unknown;
  /** conflict：服务端当前记录 */
  serverRecord?: unknown;
  /** rejected：原因 */
  error?: { code: ErrorCode; message: string };
}

export interface SyncPushResponse {
  results: SyncOpResult[];
  serverTime: IsoDateTime;
}

export interface SyncChange {
  entity: SyncEntity;
  id: Uuid;
  /** 用户级单调递增修订号 */
  rev: number;
  version: number;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
  /** 完整记录；deletedAt 非空时仍返回最后状态 */
  data: unknown;
}

export interface SyncPullResponse {
  changes: SyncChange[];
  /** 下次 pull 传入；即使 changes 为空也会返回 */
  nextCursor: string;
  hasMore: boolean;
  serverTime: IsoDateTime;
}

/* ═════════════════════════ 健康检查 ═════════════════════════ */

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  contractVersion: string;
  db: 'ok' | 'down';
  ai: 'configured' | 'missing';
  time: IsoDateTime;
  /**
   * v1.2.0：服务端仍兼容的最低客户端版本（semver，如 "0.4.0"）。未设置时不返回。
   * 客户端自身版本低于它时，应提示用户安装新版；网页端提示刷新。
   */
  minClientVersion?: string;
}

/* ═════════════════════════ 学习计划（v1.3.0） ═════════════════════════ */

export interface StudyPlanInput {
  startLevel: StartLevel;
  goal: StudyGoal;
  /** 截止日（含），用户本地日历日 */
  targetDate: IsoDate;
  /** 每天计划学习分钟数 */
  dailyMinutes: number;
  /** 每日提醒时间 HH:mm；null 表示不提醒 */
  reminderTime: string | null;
  /** 到晚上 21:00 还没学时再提醒一次 */
  lateReminder: boolean;
}

export interface StudyPlan extends BaseEntity, StudyPlanInput {
  startDate: IsoDate;
}

export interface PutStudyPlanRequest extends VersionedWrite, StudyPlanInput {}

export interface PlanPreview {
  /** 从起点到目标需要走的课程站数 */
  lessonCount: number;
  /** 估算总学时（小时） */
  estimatedHours: number;
  /** 截止日前可用的总学时 */
  availableHours: number;
  feasible: boolean;
  /** 按所填每天时长，预计到站日 */
  projectedFinish: IsoDate;
  /** 想在截止日前到站，每天至少需要的分钟数 */
  minutesNeeded: number;
  /** 每天平均要走的站数（可为小数） */
  lessonsPerDay: number;
}

export interface PlanToday {
  plan: StudyPlan | null;
  /** 今天建议学的课（第一课为下一站） */
  nextLessons: LessonSummary[];
  passedCount: number;
  totalCount: number;
  /** 按计划今天应已到达的站数 − 实际已到站数；正数表示落后 */
  behindBy: number;
  projectedFinish: IsoDate | null;
  /** 今天是否已有学习记录 */
  studiedToday: boolean;
  /** v1.13.0：今天累计学习分钟数。提醒按它是否达到每日目标来决定要不要发 */
  minutesToday?: number;
}

/* ═════════════════════════ 课程体系（v1.3.0） ═════════════════════════ */

export interface VideoRef {
  courseId: string;
  /** 分 P 序号，从 1 开始 */
  page: number;
  title: string;
  durationSec: number;
}

export interface LessonSummary {
  id: string;
  part: CurriculumPart;
  /** 在整条线路上的序号，从 1 开始 */
  order: number;
  kind: LessonKind;
  title: string;
  /** 一句话：学完能做什么 */
  goal: string;
  /** 预计用时（分钟，含视频与练习） */
  minutes: number;
  videos: VideoRef[];
  status: LessonStatus;
  bestScore: number | null;
}

export interface LessonSection {
  title: string;
  /** 讲解，纯文本，段落用空行分隔 */
  body: string;
  examples: Example[];
}

export interface KanaCell {
  kana: string;
  romaji: string;
}

export interface Lesson extends LessonSummary {
  intro: string;
  sections: LessonSection[];
  commonMistakes: string[];
  /** v1.11.0：考试旁边的单词表。普通课同 vocab；假名课是例词；声调课是对比词 */
  wordList?: Array<{ word: string; reading: string; meaningZh: string }>;
  /** v1.7.0：扩充后的生词带例句（example） */
  vocab: Array<{ word: string; reading: string; meaningZh: string; example?: Example | null }>;
  /** v1.7.0：本课的更多句子（讲解里的例句之外），都只用学过的语法 */
  sentences: Example[];
  /** 假名课的字表（按行） */
  kanaRows: KanaCell[][] | null;
  /** 过关小测：答案不下发，判分走 /ai/quiz/check，再调 /lessons/{id}/complete */
  quiz: Quiz;
  /** 内容是否由 AI 生成 */
  generated: boolean;
}

export interface LessonProgress extends BaseEntity {
  lessonId: string;
  status: Exclude<LessonStatus, 'locked'>;
  bestScore: number | null;
  passedAt: IsoDateTime | null;
  attempts: number;
  /** v1.5.0：本课练习的最好成绩 0–100；没练过为 null */
  practiceBest: number | null;
  practicedAt: IsoDateTime | null;
}

export interface CompleteLessonRequest extends WriteMeta {
  quizId: Uuid;
}

export interface CompleteLessonResult {
  progress: LessonProgress;
  /** 本次小测得分 0–100 */
  score: number;
  passed: boolean;
  /** 自动加入抽认卡的生词数 */
  cardsAdded: number;
  nextLesson: LessonSummary | null;
}

/* ═════════════════════════ 视频课程（v1.3.0） ═════════════════════════ */

export interface VideoCourseSummary {
  id: string;
  title: string;
  author: string;
  platform: 'bilibili';
  bvid: string;
  episodeCount: number;
  totalMinutes: number;
  /** 上次看到的分集；没看过为 null */
  lastPage: number | null;
  completedCount: number;
}

export interface VideoEpisode {
  page: number;
  title: string;
  section: string;
  durationSec: number;
  /** 关联的课程站 */
  lessonId: string | null;
  progress: { positionSec: number; completed: boolean; updatedAt: IsoDateTime } | null;
}

export interface VideoCourse extends VideoCourseSummary {
  episodes: VideoEpisode[];
}

export interface VideoProgress extends BaseEntity {
  courseId: string;
  page: number;
  positionSec: number;
  durationSec: number;
  completed: boolean;
}

export interface PutVideoProgressRequest extends WriteMeta {
  positionSec: number;
  completed?: boolean;
}

/* ═════════════════════════ 应用更新（v1.3.0） ═════════════════════════ */

export interface AppManifest {
  /** 界面包（热更新）：App 内下载后替换 Web 资源，不需重装 */
  web: {
    version: string;
    url: string;
    /** v1.8.0：国内镜像（http）。安装包版本 ≥ MIRROR_MIN_CLIENT_VERSION 才能用，失败时退回 url；完整性靠 sha256 */
    mirrorUrl?: string | null;
    sha256: string;
    notes: string;
  } | null;
  /** 安卓安装包：原生部分变化时才需要 */
  android: { version: string; versionCode: number; url: string; sha256?: string | null; notes: string } | null;
  /** Windows：由 Tauri 更新器走 /app/desktop/... */
  desktop: { version: string; sha256?: string | null; notes: string } | null;
}

/* ═════════════════════════ 用户自带 AI Key（v1.4.0） ═════════════════════════ */

export interface AiKeyStatus {
  /** 实际生效的来源：自己的 Key 优先于共享额度 */
  source: AiKeySource;
  /** 是否填写过自己的 Key */
  hasOwnKey: boolean;
  /** 自己 Key 的末 4 位，用于辨认；Key 本身永不下发 */
  last4: string | null;
  provider: 'deepseek';
  updatedAt: IsoDateTime | null;
}

export interface PutAiKeyRequest extends WriteMeta {
  apiKey: string;
}

/* ═════════════════════════ 朗读音频（v1.5.0） ═════════════════════════ */

export interface TtsRequest {
  /** 日语文本，至少含一个假名或汉字，≤ 400 字 */
  text: string;
}

export interface TtsResult {
  /** sha1(voice + "|" + 规整后的文本)，规整 = NFC + 连续空白压成一个空格 + 去首尾空白 */
  key: string;
  /** 相对地址：/api/v1/tts/{key}.mp3（公开、永久缓存） */
  url: string;
  voice: string;
}

/* ═════════════════════════ 学习闭环（v1.5.0） ═════════════════════════ */

export interface RouteStep {
  /** 稳定 id：review，或 {lessonId}:{kind} */
  id: string;
  kind: RouteStepKind;
  lessonId: string | null;
  title: string;
  detail: string;
  minutes: number;
  /** 由真实学习记录判断，不需要手动打勾 */
  done: boolean;
  /** 客户端路由，如 /review、/learn/n5-07、/learn/n5-07/practice */
  link: string;
}

export interface DailyRoute {
  date: IsoDate;
  /** 今天要走的课（来自学习计划；没有计划时为下一站） */
  lessons: LessonSummary[];
  steps: RouteStep[];
  doneCount: number;
  /** 本次请求顺带放进抽认卡的预设卡片数 */
  cardsSeeded: number;
}

export interface LessonPracticeRequest extends WriteMeta {
  correct: number;
  total: number;
}

export interface LessonPracticeResult {
  progress: LessonProgress;
  /** 本次得分 0–100 */
  score: number;
}

export interface CoachSuggestion {
  text: string;
  action: CoachAction;
  /** action 为 lesson / practice 时指向的课 */
  lessonId: string | null;
  /** v1.10.0：具体怎么做、做多少、做到什么算完成 */
  detail?: string | null;
  /** v1.10.0：action 为 review 时，要去"重新学习"而不是常规复习。hard=还没记牢的卡；lesson=lessonId 那一课；any=任选一组 */
  restudy?: 'hard' | 'lesson' | 'any' | null;
  /** v1.10.0（仅实时点评）：服务端按学习记录核验。done=做到了；retry=做了但没达标；open=还没做 */
  status?: 'open' | 'done' | 'retry';
  /** v1.10.0：核验结果，比如"重学 10 张，记住 8 张，80 分" */
  result?: string | null;
}

export interface CoachSection {
  title: string;
  body: string;
}

export interface CoachNote {
  id: Uuid;
  kind: CoachKind;
  /** daily：日期；lesson：课 id；weekly：该周周一的日期 */
  ref: string;
  title: string;
  /** 两三句话的总结 */
  summary: string;
  /** 做得好的地方 / 需要注意的地方 */
  highlights: string[];
  suggestions: CoachSuggestion[];
  /** v1.10.0：分段的详细分析；旧点评没有 */
  sections?: CoachSection[];
  /** ai：DeepSeek 写的；rules：没有可用 Key 时按规则写的 */
  source: 'ai' | 'rules';
  createdAt: IsoDateTime;
  readAt: IsoDateTime | null;
  /** v1.7.0（仅 live）：后台正在根据新的学习记录重写，过一会儿再取就是新的 */
  refreshing?: boolean;
}

/* ═════════════════════════ 学习阶段（v1.6.0） ═════════════════════════ */

export interface StageInfo {
  stage: LearningStage;
  /** 当前所在的站；全部学完为 null */
  currentLesson: LessonSummary | null;
  /** 已学到（含当前站）的假名，客户端只挑由这些假名组成的练习词 */
  knownKana: string;
  /** 已学过的课（含当前站）里的例句，最新的在前，≤ 24 句；跟读等练习从这里取材 */
  sentences: Array<Example & { lessonId: string; lessonTitle: string }>;
}

/* ═════════════════════════ 重新学习（v1.9.0） ═════════════════════════ */

export interface RestudyGroups {
  /** 按第一次学这张卡的日期（用户时区），新的在前 */
  days: Array<{ date: IsoDate; count: number; lastScore?: number | null }>;
  /** 按卡片所属的课，线路顺序 */
  lessons: Array<{ lessonId: string; order: number; title: string; count: number; lastScore?: number | null }>;
  /** v1.10.0：还没记牢的卡（选过重来，之后还没证明记住） */
  hard?: { count: number; lastScore: number | null };
}

export type RestudyScope = 'date' | 'lesson' | 'hard';

export interface RestudyRoundRequest {
  clientOpId: string;
  scope: RestudyScope;
  /** date：日期；lesson：课 id；hard：不填 */
  value?: string | null;
  /** 只练上一轮没记住的那几张：成绩不算这一组的分数 */
  partial?: boolean;
  /** 每张卡第一次翻到时的结果 */
  results: Array<{ cardId: Uuid; known: boolean }>;
}

export interface RestudyRoundResult {
  id: Uuid;
  score: number;
  total: number;
  known: number;
  /** 这一组上一次完整做的分数 */
  previousScore: number | null;
  /** 还剩多少张还没记牢的卡 */
  hardLeft: number;
}
