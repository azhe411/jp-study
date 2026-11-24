import type { DayMode, StudyModule } from '../../../shared/constants';
import type { SettingsData } from '../../../shared/types';

export const DEFAULT_SETTINGS: SettingsData = {
  timezone: 'Asia/Shanghai',
  weekPlan: { mon: 'standard', tue: 'standard', wed: 'standard', thu: 'standard', fri: 'minimal', sat: 'sprint', sun: 'standard' },
  dailyGoalMinutes: 45,
  jlptTarget: 'N4',
  newCardsPerDay: 20,
  reviewLimitPerDay: 200,
  defaultDeck: 'default',
  speechRate: 0.9,
  ttsVoice: null,
  furiganaMode: 'unknownOnly',
  theme: 'system',
  desiredRetention: 0.9,
};

interface TemplateSeed {
  title: string;
  module: StudyModule;
  dayModes: DayMode[];
  targetMinutes: number | null;
  targetCount: number | null;
}

/**
 * 新用户的起步模板：只放"主线之外的加练"。
 * 复习、新课、看视频由今日路线（v1.5.0，按学习计划生成）负责，这里不再重复。
 */
export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  { title: '朗读 5 分钟', module: 'speaking', dayModes: ['minimal'], targetMinutes: 5, targetCount: null },
  { title: '场景对话 1 次', module: 'scenario', dayModes: ['standard', 'sprint'], targetMinutes: 10, targetCount: 1 },
  { title: '句库跟读 10 句', module: 'phrases', dayModes: ['standard', 'sprint'], targetMinutes: null, targetCount: 10 },
  { title: '错题重做', module: 'mistakes', dayModes: ['sprint'], targetMinutes: 10, targetCount: null },
  { title: '听力精听', module: 'listening', dayModes: ['sprint'], targetMinutes: 15, targetCount: null },
  { title: '写一篇日记', module: 'writing', dayModes: ['sprint'], targetMinutes: 15, targetCount: 1 },
];
