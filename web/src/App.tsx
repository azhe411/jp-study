import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { BootSplash, RequireAnon, RequireAuth } from '@/components/guards';
import { Skeleton } from '@/components/ui';
import { AuthPage } from '@/pages/AuthPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { TodayPage } from '@/pages/TodayPage';
import { useAuth } from '@/stores/auth';

// 首屏只带"今日"；其余页面按需加载，安装包里同样分块，打开快
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const ReviewPage = named(() => import('@/pages/ReviewPage'), 'ReviewPage');
const CardsPage = named(() => import('@/pages/CardsPage'), 'CardsPage');
const RestudyPage = named(() => import('@/pages/RestudyPage'), 'RestudyPage');
const PracticePage = named(() => import('@/pages/PracticePage'), 'PracticePage');
const StatsPage = named(() => import('@/pages/StatsPage'), 'StatsPage');
const SettingsPage = named(() => import('@/pages/SettingsPage'), 'SettingsPage');
const LookupPage = named(() => import('@/pages/LookupPage'), 'LookupPage');
const MistakesPage = named(() => import('@/pages/MistakesPage'), 'MistakesPage');
const TalkPage = named(() => import('@/pages/TalkPage'), 'TalkPage');
const ConversationPage = named(() => import('@/pages/TalkPage'), 'ConversationPage');
const PhrasesPage = named(() => import('@/pages/PhrasesPage'), 'PhrasesPage');
const SpeakingPage = named(() => import('@/pages/SpeakingPage'), 'SpeakingPage');
const ListeningPage = named(() => import('@/pages/ListeningPage'), 'ListeningPage');
const ListeningPlayerPage = named(() => import('@/pages/ListeningPage'), 'ListeningPlayerPage');
const ReadingPage = named(() => import('@/pages/ReadingPage'), 'ReadingPage');
const ReadingMaterialPage = named(() => import('@/pages/ReadingPage'), 'ReadingMaterialPage');
const WritingPage = named(() => import('@/pages/WritingPage'), 'WritingPage');
const WritingEntryPage = named(() => import('@/pages/WritingPage'), 'WritingEntryPage');
const PronunciationPage = named(() => import('@/pages/PronunciationPage'), 'PronunciationPage');
const ExpressionsPage = named(() => import('@/pages/ExpressionsPage'), 'ExpressionsPage');
const KanjiPage = named(() => import('@/pages/KanjiPage'), 'KanjiPage');
const VocabTestPage = named(() => import('@/pages/VocabTestPage'), 'VocabTestPage');
const CoursesPage = named(() => import('@/pages/CoursesPage'), 'CoursesPage');
const OnboardingPage = named(() => import('@/pages/OnboardingPage'), 'OnboardingPage');
const LearnPage = named(() => import('@/pages/LearnPage'), 'LearnPage');
const LessonPage = named(() => import('@/pages/LessonPage'), 'LessonPage');
const LessonPracticePage = named(() => import('@/pages/LessonPracticePage'), 'LessonPracticePage');
const VideosPage = named(() => import('@/pages/VideosPage'), 'VideosPage');

function PageFallback() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="正在载入">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40" />
      <Skeleton className="h-24" />
    </div>
  );
}

export function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <Suspense fallback={<BootSplash />}>
      <Routes>
        <Route path="/login" element={<RequireAnon><AuthPage mode="login" /></RequireAnon>} />
        <Route path="/register" element={<RequireAnon><AuthPage mode="register" /></RequireAnon>} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<TodayPage />} />
          {(
            [
              ['review', ReviewPage],
              ['review/cards', CardsPage],
              ['review/restudy', RestudyPage],
              ['practice', PracticePage],
              ['stats', StatsPage],
              ['settings', SettingsPage],
              ['lookup', LookupPage],
              ['mistakes', MistakesPage],
              ['talk', TalkPage],
              ['talk/:id', ConversationPage],
              ['phrases', PhrasesPage],
              ['speaking', SpeakingPage],
              ['listening', ListeningPage],
              ['listening/:id', ListeningPlayerPage],
              ['reading', ReadingPage],
              ['reading/:id', ReadingMaterialPage],
              ['writing', WritingPage],
              ['writing/:id', WritingEntryPage],
              ['pronunciation', PronunciationPage],
              ['expressions/:type', ExpressionsPage],
              ['kanji', KanjiPage],
              ['vocab-test', VocabTestPage],
              ['courses', CoursesPage],
              ['onboarding', OnboardingPage],
              ['learn', LearnPage],
              ['learn/:id', LessonPage],
              ['learn/:id/practice', LessonPracticePage],
              ['videos/:id', VideosPage],
            ] as const
          ).map(([path, Page]) => (
            <Route key={path} path={path} element={<Suspense fallback={<PageFallback />}><Page /></Suspense>} />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
