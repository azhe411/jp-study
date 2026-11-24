/**
 * 全部接口的类型化封装（契约 v1.2.0）。写操作的 clientOpId 在这里统一生成；
 * 需要"同一操作重试复用同一 id"的场景（离线重推）由 outbox 自己传入。
 */
import type {
  RestudyGroups,
  RestudyRoundRequest,
  RestudyRoundResult,
  StageInfo,
  CoachNote,
  DailyRoute,
  LessonPracticeResult,
  TtsResult,
  AiKeyStatus,
  AppManifest,
  CompleteLessonResult,
  Lesson,
  LessonSummary,
  PlanPreview,
  PlanToday,
  StudyPlan,
  StudyPlanInput,
  VideoCourse,
  VideoCourseSummary,
  VideoProgress,
  DeckSummary,
  AuthResult,
  BackupStatus,
  Card,
  Conversation,
  Course,
  CreateCardRequest,
  CreateConversationResult,
  CreateCourseRequest,
  CreateMistakeRequest,
  CreatePhraseRequest,
  CreateSpeakingAttemptRequest,
  DictationResult,
  DueCardsResponse,
  ExportBundle,
  ExpressionAttempt,
  ExpressionItem,
  HealthResponse,
  ImportCardsRequest,
  ImportCardsResult,
  ImportDataResult,
  JlptMock,
  Kanji,
  KanjiAttempt,
  ListeningAttempt,
  ListeningMaterial,
  ListeningMaterialSummary,
  LoginRequest,
  LookupResult,
  MeResponse,
  Message,
  Mistake,
  Page,
  Phrase,
  PhraseAttempt,
  PronunciationAttempt,
  PronunciationPair,
  PutSettingsRequest,
  QuizCheckResult,
  ReadingAttempt,
  ReadingMaterial,
  ReadingMaterialSummary,
  RegisterRequest,
  RetryMistakeResult,
  ReviewCardResult,
  Scenario,
  SendMessageResult,
  Settings,
  SpeakingAttempt,
  StatsResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  Task,
  TaskTemplate,
  TimeLog,
  TodayResponse,
  VocabTestResult,
  VocabTestStartResult,
  WritingEntry,
} from '@shared/types';
import type { DayMode, ImportMode, LookupType, StudyModule } from '@shared/constants';
import { api, endSession, newClientOpId } from './client';

type Q = Record<string, string | number | boolean | undefined | null>;
type Body = Record<string, unknown>;

const get = <T>(path: string, query?: Q) => api<T>(path, { query });
const post = <T>(path: string, body: Body = {}) => api<T>(path, { method: 'POST', body: { clientOpId: newClientOpId(), ...body } });
const patch = <T>(path: string, body: Body) => api<T>(path, { method: 'PATCH', body: { clientOpId: newClientOpId(), ...body } });
const del = (path: string, baseVersion?: number) =>
  api<void>(path, { method: 'DELETE', query: { clientOpId: newClientOpId(), baseVersion } });

export const authApi = {
  register: (body: RegisterRequest) => api<AuthResult>('/auth/register', { method: 'POST', body, auth: false }),
  login: (body: LoginRequest) => api<AuthResult>('/auth/login', { method: 'POST', body, auth: false }),
  logout: endSession,
  me: () => api<MeResponse>('/me'),
};

export const systemApi = {
  health: () => api<HealthResponse>('/health', { auth: false }),
};

export const settingsApi = {
  get: () => get<Settings>('/settings'),
  put: (body: PutSettingsRequest) => api<Settings>('/settings', { method: 'PUT', body }),
};

export const tasksApi = {
  today: (date?: string) => get<TodayResponse>('/tasks/today', { date }),
  generate: (date: string, dayMode: DayMode, regenerate = false) => post<TodayResponse>('/tasks/generate', { date, dayMode, regenerate }),
  list: (from: string, to: string) => get<Page<Task>>('/tasks', { from, to, limit: 100 }),
  create: (b: { title: string; module: StudyModule; date: string; targetMinutes?: number | null; note?: string | null }) => post<Task>('/tasks', b),
  update: (id: string, baseVersion: number, b: Body) => patch<Task>(`/tasks/${id}`, { baseVersion, ...b }),
  remove: (id: string, baseVersion?: number) => del(`/tasks/${id}`, baseVersion),
  templates: () => get<Page<TaskTemplate>>('/task-templates', { limit: 100 }),
  createTemplate: (b: Body) => post<TaskTemplate>('/task-templates', b),
  updateTemplate: (id: string, baseVersion: number, b: Body) => patch<TaskTemplate>(`/task-templates/${id}`, { baseVersion, ...b }),
  removeTemplate: (id: string, baseVersion?: number) => del(`/task-templates/${id}`, baseVersion),
};

export const cardsApi = {
  due: (deck?: string) => get<DueCardsResponse>('/cards/due', { deck, limit: 100 }),
  /** v1.9.0 */
  restudyGroups: () => get<RestudyGroups>('/cards/restudy'),
  restudyItems: (q: { date?: string; lessonId?: string; hard?: boolean }) => get<{ items: Card[] }>('/cards/restudy/items', q),
  restudyRound: (b: Omit<RestudyRoundRequest, 'clientOpId'>) => post<RestudyRoundResult>('/cards/restudy/rounds', b as unknown as Body),
  decks: () => get<{ items: DeckSummary[] }>('/cards/decks'),
  list: (q: Q) => get<Page<Card>>('/cards', q),
  create: (b: Omit<CreateCardRequest, 'clientOpId'>) => post<Card>('/cards', b as Body),
  update: (id: string, baseVersion: number, b: Body) => patch<Card>(`/cards/${id}`, { baseVersion, ...b }),
  remove: (id: string, baseVersion?: number) => del(`/cards/${id}`, baseVersion),
  import: (b: Omit<ImportCardsRequest, 'clientOpId'>) => post<ImportCardsResult>('/cards/import', b as unknown as Body),
  review: (id: string, rating: 1 | 2 | 3 | 4, durationMs: number) =>
    post<ReviewCardResult>(`/cards/${id}/review`, { id: newClientOpId(), rating, reviewedAt: new Date().toISOString(), durationMs }),
};

export const aiApi = {
  lookup: (type: LookupType, query: string, context?: string) => api<LookupResult>('/ai/lookup', { method: 'POST', body: { type, query, context } }),
  check: (quizId: string, answers: Array<{ questionId: string; choiceIndex: number }>) => post<QuizCheckResult>('/ai/quiz/check', { quizId, answers }),
};

export const mistakesApi = {
  list: (q: Q) => get<Page<Mistake>>('/mistakes', q),
  create: (b: Omit<CreateMistakeRequest, 'clientOpId'>) => post<Mistake>('/mistakes', b as Body),
  update: (id: string, baseVersion: number | undefined, b: Body) => patch<Mistake>(`/mistakes/${id}`, { baseVersion, ...b }),
  remove: (id: string, baseVersion?: number) => del(`/mistakes/${id}`, baseVersion),
  retry: (id: string) => post<RetryMistakeResult>(`/mistakes/${id}/retry`),
};

export const talkApi = {
  scenarios: (q: Q = {}) => get<Page<Scenario>>('/scenarios', { limit: 100, ...q }),
  scenario: (id: string) => get<Scenario>(`/scenarios/${id}`),
  conversations: (q: Q = {}) => get<Page<Conversation>>('/conversations', q),
  conversation: (id: string) => get<Conversation>(`/conversations/${id}`),
  start: (scenarioId: string) => post<CreateConversationResult>('/conversations', { scenarioId }),
  finish: (id: string, baseVersion: number) => patch<Conversation>(`/conversations/${id}`, { baseVersion, status: 'finished' }),
  remove: (id: string) => del(`/conversations/${id}`),
  messages: (id: string) => get<Page<Message>>(`/conversations/${id}/messages`, { limit: 200 }),
  send: (id: string, content: string) => post<SendMessageResult>(`/conversations/${id}/messages`, { content }),
};

export const phrasesApi = {
  list: (q: Q) => get<Page<Phrase>>('/phrases', q),
  create: (b: Omit<CreatePhraseRequest, 'clientOpId'>) => post<Phrase>('/phrases', b as Body),
  update: (id: string, baseVersion: number, b: Body) => patch<Phrase>(`/phrases/${id}`, { baseVersion, ...b }),
  remove: (id: string, baseVersion?: number) => del(`/phrases/${id}`, baseVersion),
  attempts: (id: string) => get<Page<PhraseAttempt>>(`/phrases/${id}/attempts`, { limit: 10 }),
  attempt: (id: string, b: Body) => post<PhraseAttempt>(`/phrases/${id}/attempts`, { id: newClientOpId(), ...b }),
};

export const speakingApi = {
  list: (q: Q = {}) => get<Page<SpeakingAttempt>>('/speaking/attempts', q),
  create: (b: Omit<CreateSpeakingAttemptRequest, 'clientOpId'>) => post<SpeakingAttempt>('/speaking/attempts', { id: newClientOpId(), ...b } as Body),
};

export const listeningApi = {
  materials: (q: Q = {}) => get<Page<ListeningMaterialSummary>>('/listening/materials', { limit: 100, ...q }),
  material: (id: string) => get<ListeningMaterial>(`/listening/materials/${id}`),
  dictation: (materialId: string, segmentIndex: number, answer: string) =>
    api<DictationResult>('/listening/dictation', { method: 'POST', body: { materialId, segmentIndex, answer } }),
  attempts: (q: Q = {}) => get<Page<ListeningAttempt>>('/listening/attempts', q),
  record: (b: Body) => post<ListeningAttempt>('/listening/attempts', { id: newClientOpId(), ...b }),
};

export const writingApi = {
  submit: (b: { id?: string; kind: string; title: string; prompt?: string | null; content: string }) => post<WritingEntry>('/writing/submit', b),
  list: (q: Q = {}) => get<Page<WritingEntry>>('/writing/entries', q),
  entry: (id: string) => get<WritingEntry>(`/writing/entries/${id}`),
  remove: (id: string, baseVersion?: number) => del(`/writing/entries/${id}`, baseVersion),
};

export const readingApi = {
  materials: (q: Q = {}) => get<Page<ReadingMaterialSummary>>('/reading/materials', { limit: 100, ...q }),
  material: (id: string) => get<ReadingMaterial>(`/reading/materials/${id}`),
  attempts: (q: Q = {}) => get<Page<ReadingAttempt>>('/reading/attempts', q),
  record: (b: Body) => post<ReadingAttempt>('/reading/attempts', { id: newClientOpId(), ...b }),
};

export const pronunciationApi = {
  pairs: (q: Q = {}) => get<Page<PronunciationPair>>('/pronunciation/pairs', { limit: 100, ...q }),
  record: (b: Body) => post<PronunciationAttempt>('/pronunciation/attempts', { id: newClientOpId(), ...b }),
};

export const expressionsApi = {
  items: (q: Q) => get<Page<ExpressionItem>>('/expressions/items', { limit: 100, ...q }),
  record: (b: Body) => post<ExpressionAttempt>('/expressions/attempts', { id: newClientOpId(), ...b }),
};

export const kanjiApi = {
  list: (q: Q = {}) => get<Page<Kanji>>('/kanji', { limit: 100, ...q }),
  record: (b: Body) => post<KanjiAttempt>('/kanji/attempts', { id: newClientOpId(), ...b }),
};

export const vocabApi = {
  start: () => post<VocabTestStartResult>('/vocab-test/start'),
  submit: (testId: string, answers: Array<{ itemId: string; known?: boolean; choiceIndex?: number }>, durationMs: number) =>
    post<VocabTestResult>('/vocab-test/submit', { testId, answers, durationMs }),
  history: () => get<Page<VocabTestResult>>('/vocab-test/history', { limit: 20 }),
};

export const coursesApi = {
  list: (q: Q = {}) => get<Page<Course>>('/courses', { limit: 100, ...q }),
  create: (b: Omit<CreateCourseRequest, 'clientOpId'>) => post<Course>('/courses', b as Body),
  update: (id: string, baseVersion: number, b: Body) => patch<Course>(`/courses/${id}`, { baseVersion, ...b }),
  remove: (id: string, baseVersion?: number) => del(`/courses/${id}`, baseVersion),
};

export const statsApi = {
  get: (from?: string, to?: string) => get<StatsResponse>('/stats', { from, to }),
  logTime: (module: StudyModule, startedAt: Date, durationMs: number) =>
    post<TimeLog>('/stats/time-logs', { id: newClientOpId(), module, startedAt: startedAt.toISOString(), durationMs }),
  mocks: () => get<Page<JlptMock>>('/stats/jlpt-mocks', { limit: 100 }),
  addMock: (b: Body) => post<JlptMock>('/stats/jlpt-mocks', b),
  removeMock: (id: string) => del(`/stats/jlpt-mocks/${id}`),
};

export const dataApi = {
  export: () => get<ExportBundle>('/data/export'),
  import: (mode: ImportMode, bundle: ExportBundle) => post<ImportDataResult>('/data/import', { mode, bundle: bundle as unknown as Body }),
  backup: () => get<BackupStatus>('/data/backup-status'),
};

export const syncApi = {
  push: (b: SyncPushRequest) => api<SyncPushResponse>('/sync/push', { method: 'POST', body: b }),
  pull: (cursor?: string) => get<SyncPullResponse>('/sync/pull', { cursor, limit: 1000 }),
};

/* ───────────── v1.3.0：学习计划 / 课程体系 / 视频课程 / 应用更新 ───────────── */

export const learnApi = {
  curriculum: (part?: string) => get<{ items: LessonSummary[] }>('/curriculum', { part }),
  lesson: (id: string) => get<Lesson>(`/lessons/${id}`),
  complete: (id: string, quizId: string) => post<CompleteLessonResult>(`/lessons/${id}/complete`, { quizId }),
  plan: () => get<StudyPlan>('/plan'),
  savePlan: (b: StudyPlanInput & { baseVersion?: number }) => api<StudyPlan>('/plan', { method: 'PUT', body: { clientOpId: newClientOpId(), ...b } }),
  preview: (b: StudyPlanInput) => api<PlanPreview>('/plan/preview', { method: 'POST', body: b }),
  today: () => get<PlanToday>('/plan/today'),
  /** v1.5.0 */
  practice: (id: string, correct: number, total: number) => post<LessonPracticeResult>(`/lessons/${id}/practice`, { correct, total }),
  route: () => get<DailyRoute>('/route/today'),
  /** v1.6.0 */
  stage: () => get<StageInfo>('/learn/stage'),
};

/* ───────────── v1.5.0：朗读音频与学习教练 ───────────── */

export const ttsApi = {
  create: (text: string) => api<TtsResult>('/tts', { method: 'POST', body: { text } }),
};

export const coachApi = {
  live: () => get<CoachNote>('/coach/live'),
  daily: () => get<CoachNote>('/coach/daily'),
  weekly: () => get<CoachNote>('/coach/weekly'),
  lesson: (id: string) => get<CoachNote>(`/coach/lessons/${id}`),
  notes: (limit = 20) => get<{ items: CoachNote[] }>('/coach/notes', { limit }),
  read: (id: string) => post<CoachNote>(`/coach/notes/${id}/read`, {}),
};

export const videoApi = {
  courses: () => get<{ items: VideoCourseSummary[] }>('/video-courses'),
  course: (id: string) => get<VideoCourse>(`/video-courses/${id}`),
  progress: (courseId: string, page: number, positionSec: number, completed?: boolean) =>
    api<VideoProgress>(`/video-progress/${courseId}/${page}`, { method: 'PUT', body: { clientOpId: newClientOpId(), positionSec, ...(completed === undefined ? {} : { completed }) } }),
};

export const appApi = {
  manifest: () => api<AppManifest>('/app/manifest', { auth: false }),
};

/* ───────────── v1.4.0：用户自带 AI Key ───────────── */

export const aiKeyApi = {
  status: () => get<AiKeyStatus>('/me/ai-key'),
  save: (apiKey: string) => api<AiKeyStatus>('/me/ai-key', { method: 'PUT', body: { clientOpId: newClientOpId(), apiKey } }),
  remove: () => del('/me/ai-key'),
};
