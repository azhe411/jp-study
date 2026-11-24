/**
 * 学习模块 = 线路。每条线有自己的颜色和一个字母（像东京地铁的 G / M / H），
 * 任务列表、练习入口、统计图都从这里取色，同一个模块在哪儿都是同一种颜色。
 */
import type { Icon } from '@phosphor-icons/react';
import {
  Books,
  Cards,
  ChatsCircle,
  GraduationCap,
  HandWaving,
  Headphones,
  MagnifyingGlass,
  Microphone,
  NotePencil,
  Notebook,
  PencilSimpleLine,
  Quotes,
  ShootingStar,
  SpeakerHigh,
  Translate,
  WarningCircle,
} from '@phosphor-icons/react';
import type { DayMode, StudyModule } from '@shared/constants';

export interface Line {
  module: StudyModule;
  /** 线路字母 */
  code: string;
  name: string;
  color: string;
  /** 线路色上的文字颜色（浅色线配深字） */
  onColor: string;
  icon: Icon;
  /** 练习入口；尚无独立页面的为 null */
  to: string | null;
  blurb: string;
}

const L = (module: StudyModule, code: string, name: string, color: string, onColor: string, icon: Icon, to: string | null, blurb: string): Line => ({
  module, code, name, color, onColor, icon, to, blurb,
});

export const LINES: Line[] = [
  L('flashcards', 'F', '抽认卡', '#f39700', '#2a1700', Cards, '/review', '按遗忘曲线安排今天该复习的卡片'),
  L('scenario', 'C', '场景对话', '#e60012', '#ffffff', ChatsCircle, '/talk', '和 AI 扮演店员、同事、面试官练口语'),
  L('lookup', 'Q', 'AI 查询', '#7f97a3', '#0d1a20', MagnifyingGlass, '/lookup', '查词、语法、汉字，附例句和小测验'),
  L('mistakes', 'M', '错题本', '#00a7db', '#00202b', WarningCircle, '/mistakes', '做错的题攒在这里，按错误次数重练'),
  L('phrases', 'P', '句库', '#009944', '#ffffff', Quotes, '/phrases', '旅行与生活常用句，逐句跟读打分'),
  L('speaking', 'S', '朗读跟读', '#c9b23c', '#1f1a00', Microphone, '/speaking', '看文朗读或影子跟读，逐字对比'),
  L('listening', 'L', '听力', '#9b7cb6', '#ffffff', Headphones, '/listening', '盲听、字幕、精听、听写四种模式'),
  L('writing', 'W', '写作', '#00ada9', '#002523', PencilSimpleLine, '/writing', '写日记作文，AI 逐句批改润色'),
  L('reading', 'R', '阅读', '#bb641d', '#ffffff', Books, '/reading', '带注音的短文，记录阅读速度'),
  L('pronunciation', 'A', '发音', '#e85298', '#ffffff', SpeakerHigh, '/pronunciation', '长音、促音、拨音……最小对立对'),
  L('keigo', 'K', '敬语', '#0079c2', '#ffffff', HandWaving, '/expressions/keigo', '尊敬语、谦让语、丁宁语的转换'),
  L('idiom', 'I', '惯用语', '#6cbb5a', '#0e2208', Translate, '/expressions/idiom', '惯用句、四字熟语、谚语、拟声拟态'),
  L('kanji', 'J', '汉字', '#b6007a', '#ffffff', NotePencil, '/kanji', 'N5 汉字的音训、部首与常用词'),
  L('vocabTest', 'V', '词汇量测试', '#00418e', '#ffffff', ShootingStar, '/vocab-test', '60 题估算词汇量与 JLPT 等级'),
  L('course', 'E', '课程', '#546e7a', '#ffffff', GraduationCap, '/courses', 'B 站等外链课程的进度记录'),
  L('other', 'O', '其他', '#8a929b', '#ffffff', Notebook, null, '自定义任务'),
];

export const LINE_BY_MODULE = new Map(LINES.map((l) => [l.module, l]));
export const lineOf = (m: StudyModule): Line => LINE_BY_MODULE.get(m) ?? LINE_BY_MODULE.get('other')!;

/** 三种档位 = 三种列车：各站停车 / 快速 / 特急 */
export const DAY_MODE_TRAIN: Record<DayMode, { ja: string; zh: string; color: string; onColor: string }> = {
  minimal: { ja: '各駅停車', zh: '最小日', color: '#80c241', onColor: '#102006' },
  standard: { ja: '快速', zh: '标准日', color: '#f39700', onColor: '#2a1700' },
  sprint: { ja: '特急', zh: '冲刺日', color: '#e60012', onColor: '#ffffff' },
};

