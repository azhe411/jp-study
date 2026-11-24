/**
 * 可同步实体登记表：实体名 → 表 → 对外形状。sync/pull、导出、导入共用这一份。
 * 顺序即导入顺序：被引用的（卡片、句子、对话）排在引用者（复习记录、跟读、消息）之前。
 */
import type { SyncEntity } from '../../../shared/constants';
import { conversationToApi, messageToApi } from '../routes/conversations';
import { courseToApi } from '../routes/courses';
import { mistakeToApi } from '../routes/mistakes';
import { phraseAttemptToApi, phraseToApi } from '../routes/phrases';
import {
  expressionAttemptToApi,
  kanjiAttemptToApi,
  listeningAttemptToApi,
  pronunciationAttemptToApi,
  readingAttemptToApi,
} from '../routes/practice';
import { speakingAttemptToApi } from '../routes/speaking';
import { mockToApi, timeLogToApi } from '../routes/stats';
import { taskToApi, templateToApi } from '../routes/tasks';
import { vocabResultToApi } from '../routes/vocabTest';
import { writingToApi } from '../routes/writing';
import { lessonProgressToApi } from '../routes/learn';
import { videoProgressToApi } from '../routes/videos';
import { planToApi } from './learning';
import { camelRow } from '../lib/util';
import { settingsToApi } from './settings';
import { cardToApi, reviewLogToApi } from './srs';

type Row = Record<string, unknown>;

export interface EntityDef {
  entity: SyncEntity;
  table: string;
  toApi: (row: Row) => unknown;
  /** 导入时的冲突目标；缺省按 id */
  conflict?: string;
}

export const ENTITIES: EntityDef[] = [
  { entity: 'settings', table: 'settings', toApi: settingsToApi },
  { entity: 'dayPlan', table: 'day_plans', toApi: (r) => camelRow(r), conflict: '(user_id, date)' },
  { entity: 'taskTemplate', table: 'task_templates', toApi: templateToApi },
  { entity: 'task', table: 'tasks', toApi: taskToApi },
  { entity: 'card', table: 'cards', toApi: cardToApi },
  { entity: 'reviewLog', table: 'review_logs', toApi: reviewLogToApi },
  { entity: 'mistake', table: 'mistakes', toApi: mistakeToApi },
  { entity: 'phrase', table: 'phrases', toApi: phraseToApi },
  { entity: 'phraseAttempt', table: 'phrase_attempts', toApi: phraseAttemptToApi },
  { entity: 'speakingAttempt', table: 'speaking_attempts', toApi: speakingAttemptToApi },
  { entity: 'listeningAttempt', table: 'listening_attempts', toApi: listeningAttemptToApi },
  { entity: 'readingAttempt', table: 'reading_attempts', toApi: readingAttemptToApi },
  { entity: 'pronunciationAttempt', table: 'pronunciation_attempts', toApi: pronunciationAttemptToApi },
  { entity: 'expressionAttempt', table: 'expression_attempts', toApi: expressionAttemptToApi },
  { entity: 'kanjiAttempt', table: 'kanji_attempts', toApi: kanjiAttemptToApi },
  { entity: 'writingEntry', table: 'writing_entries', toApi: writingToApi },
  { entity: 'conversation', table: 'conversations', toApi: conversationToApi },
  { entity: 'message', table: 'messages', toApi: messageToApi },
  { entity: 'vocabTestResult', table: 'vocab_test_results', toApi: vocabResultToApi },
  { entity: 'course', table: 'courses', toApi: courseToApi },
  { entity: 'timeLog', table: 'time_logs', toApi: timeLogToApi },
  { entity: 'jlptMock', table: 'jlpt_mocks', toApi: mockToApi },
  { entity: 'studyPlan', table: 'study_plans', toApi: planToApi },
  { entity: 'lessonProgress', table: 'lesson_progress', toApi: lessonProgressToApi },
  { entity: 'videoProgress', table: 'video_progress', toApi: videoProgressToApi },
];

export const ENTITY_BY_NAME = new Map(ENTITIES.map((e) => [e.entity, e]));
