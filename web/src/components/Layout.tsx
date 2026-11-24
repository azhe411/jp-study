/**
 * 应用外框：桌面端左侧导轨，手机端底部标签栏（避开手势条）。
 * 五个一级入口：今日 / 复习 / 练习 / 统计 / 设置；各练习模块从"练习"线路图进入。
 */
import type { Icon } from '@phosphor-icons/react';
import { ChartLineUp, Cards, GearSix, GraduationCap, MapTrifold, TrainSimple, WifiSlash } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { systemApi } from '@/api/endpoints';
import { useOnline } from '@/lib/hooks';
import { isOutdated } from '@/lib/version';
import { isApp } from '@/platform';
import { PwaPrompt } from './PwaPrompt';
import { SyncStatus } from './SyncStatus';
import { UpdateBanner } from './UpdateBanner';
import { cx } from './ui';
import { useWidgetBridge } from '@/lib/widgets';

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  /** 这些路径也算在本入口下（练习的各个模块） */
  match?: RegExp;
}

const NAV: NavItem[] = [
  { to: '/', label: '今日', icon: TrainSimple },
  { to: '/learn', label: '课程', icon: GraduationCap, match: /^\/(learn|onboarding)/ },
  { to: '/review', label: '复习', icon: Cards },
  {
    to: '/practice',
    label: '练习',
    icon: MapTrifold,
    match: /^\/(practice|lookup|mistakes|talk|phrases|speaking|listening|writing|reading|pronunciation|expressions|kanji|vocab-test|courses|videos)/,
  },
  { to: '/stats', label: '统计', icon: ChartLineUp },
  { to: '/settings', label: '设置', icon: GearSix },
];

/** 品牌：一块黄绿色的站号牌，"駅 01"——这条线的第一站 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cx('font-sign inline-flex h-9 items-center gap-1 rounded-[10px] bg-go px-2 font-bold leading-none text-go-ink', className)} aria-hidden>
      <span lang="ja" className="text-[15px] font-black" style={{ fontFamily: 'inherit' }}>駅</span>
      <span className="rounded-[5px] bg-go-ink px-1 py-[3px] text-[11px] text-go">01</span>
    </span>
  );
}

function isActive(item: NavItem, path: string) {
  if (item.match) return item.match.test(path);
  return item.to === '/' ? path === '/' : path.startsWith(item.to);
}

export function Layout() {
  const online = useOnline();
  const { pathname } = useLocation();
  // 与首页共用 ['health'] 缓存；这里只关心 minClientVersion，低频即可
  const health = useQuery({ queryKey: ['health'], queryFn: systemApi.health, staleTime: 10 * 60_000 });
  const outdated = isOutdated(health.data?.minClientVersion);
  useWidgetBridge(useQueryClient());

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        跳到正文
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 pb-4 pt-5 md:flex">
        <div className="mb-7 flex items-center gap-2.5 px-2">
          <BrandMark />
          <div className="leading-tight">
            <div lang="ja" className="text-[17px] font-black tracking-wide">一駅</div>
            <div className="text-[11px] tracking-wide text-ink-3">每天一站，学到终点</div>
          </div>
        </div>
        <nav aria-label="主导航" className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const on = isActive(n, pathname);
            return (
              <NavLink
                key={n.to}
                to={n.to}
                viewTransition
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition-colors duration-150',
                  on ? 'bg-go-soft text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )}
              >
                <n.icon weight={on ? 'fill' : 'regular'} className={cx('size-5', on ? 'text-ok' : 'text-ink-3 group-hover:text-ink-2')} />
                {n.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        {!online && (
          <div className="flex items-center justify-center gap-2 bg-surface-2 px-4 py-2 text-xs font-semibold text-ink-2" role="status">
            <WifiSlash weight="bold" className="size-4" />
            离线中：看过的内容可以继续看，练习和修改会暂存，联网后自动补交
          </div>
        )}
        {outdated && (
          <div className="bg-go-soft px-4 py-2 text-center text-xs font-semibold text-ok" role="status">
            {isApp ? `当前版本 v${__APP_VERSION__} 过旧，请安装 v${health.data?.minClientVersion} 或更新的版本` : '网页已更新，请刷新页面'}
          </div>
        )}
        <UpdateBanner />
        <SyncStatus />
        <main id="main" className="mx-auto w-full max-w-[880px] flex-1 px-4 pb-[calc(6rem+var(--sab))] pt-5 sm:px-6 md:pb-12 md:pt-8">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="主导航"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-surface/92 backdrop-blur-md md:hidden"
        style={{ paddingBottom: 'var(--sab)' }}
      >
        {NAV.map((n) => {
          const on = isActive(n, pathname);
          return (
            <NavLink
              key={n.to}
              to={n.to}
              viewTransition
              aria-current={on ? 'page' : undefined}
              className={cx('flex min-h-15 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors', on ? 'text-ink' : 'text-ink-3')}
            >
              <span className={cx('grid h-7 w-12 place-items-center rounded-full transition-colors duration-200', on && 'bg-go-soft')}>
                <n.icon weight={on ? 'fill' : 'regular'} className={cx('size-[22px]', on && 'text-ok')} />
              </span>
              {n.label}
            </NavLink>
          );
        })}
      </nav>
      <PwaPrompt />
    </div>
  );
}
