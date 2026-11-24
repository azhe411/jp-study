import { useEffect, useSyncExternalStore } from 'react';
import type { Theme } from '@shared/constants';

/* ───────────── 在线状态 ───────────── */

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/* ───────────── 主题 ───────────── */

const THEME_KEY = 'jp.theme';

/** 设置页的选择先落到本地，首屏即可按偏好着色，不必等设置接口返回 */
export function rememberTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 隐私模式下无存储，按系统主题即可 */
  }
}

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1117' : '#eef0ee');
}

export function useTheme(theme: Theme) {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
}
