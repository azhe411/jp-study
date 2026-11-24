/**
 * 练习：所有模块按"输入 / 输出 / 巩固"三个方向排成线路表，像车站里的路线指引。
 * v1.6.0：按学习阶段标出"现在适合练"和"学到某阶段再来"——不锁死，但不让初学者一头撞上超纲内容。
 */
import { ArrowRight } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { LearningStage, StudyModule } from '@shared/constants';
import { LEARNING_STAGES } from '@shared/constants';
import { LineBadge, PageHeader, cx } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { useStage } from '@/lib/study';

/** 建议从哪个阶段开始练；没列出的随时都适合 */
const FROM: Partial<Record<StudyModule, LearningStage>> = {
  lookup: 'N5', reading: 'N5', listening: 'N5', kanji: 'N5', vocabTest: 'N5', scenario: 'N5', phrases: 'N5', writing: 'N5', mistakes: 'N5',
  keigo: 'N4', idiom: 'N4',
};
const STAGE_ZH: Record<LearningStage, string> = { kana: '五十音', N5: 'N5', N4: 'N4', N3: 'N3', N2: 'N2', N1: 'N1', done: '全部' };
const early = (m: StudyModule, stage?: LearningStage) =>
  !!stage && !!FROM[m] && LEARNING_STAGES.indexOf(stage) < LEARNING_STAGES.indexOf(FROM[m]!);

const GROUPS: Array<{ title: string; ja: string; modules: StudyModule[] }> = [
  { title: '输入', ja: 'インプット', modules: ['lookup', 'reading', 'listening', 'kanji', 'vocabTest'] },
  { title: '输出', ja: 'アウトプット', modules: ['scenario', 'phrases', 'speaking', 'pronunciation', 'writing'] },
  { title: '巩固', ja: '定着', modules: ['mistakes', 'keigo', 'idiom', 'flashcards', 'course'] },
];

export function PracticePage() {
  const stage = useStage()?.stage;
  return (
    <div>
      <PageHeader title="练习" subtitle="每个模块是一条线，颜色在全站保持一致" />
      {stage === 'kana' && (
        <p className="mb-5 rounded-2xl bg-go-soft px-4 py-3 text-sm">
          现在是<b>五十音阶段</b>：先专心认假名。适合现在练的是<b>抽认卡、朗读跟读（只给您学过的假名）、发音</b>；其余模块等学到 N5 第 1 课再来，免得一上来全是汉字。
        </p>
      )}
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.title} aria-labelledby={`g-${g.title}`}>
            <h2 id={`g-${g.title}`} className="mb-2 flex items-baseline gap-2 px-1">
              <span className="text-[15px] font-extrabold">{g.title}</span>
              <span lang="ja" className="text-xs font-semibold text-ink-3">{g.ja}</span>
            </h2>
            <ul className="stagger overflow-hidden rounded-2xl bg-surface lift">
              {g.modules.map((m, i) => {
                const line = lineOf(m);
                const later = early(m, stage);
                return (
                  <li key={m} className={i ? 'border-t border-line' : undefined}>
                    <Link
                      to={line.to!}
                      viewTransition
                      className={cx('group relative flex min-h-[68px] items-center gap-3.5 px-4 transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--c)_9%,transparent)]', later && 'opacity-55')}
                      style={{ ['--c' as string]: line.color }}
                    >
                      <LineBadge line={line} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold">{line.name}</div>
                        <div className="truncate text-[13px] text-ink-3">{later ? `建议学到 ${STAGE_ZH[FROM[m]!]} 阶段再来` : line.blurb}</div>
                      </div>
                      <line.icon weight="duotone" className="hidden size-6 shrink-0 transition-colors sm:block" style={{ color: line.color }} />
                      <ArrowRight weight="bold" className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
