/**
 * 软件内更新（契约 §16）：
 *   安卓 · 界面热更新：清单里的界面包比当前新 → 后台下载、校验 → 提示"重启生效"（不点也会在下次启动时生效）
 *   安卓 · 安装包：原生部分变了（清单 android.version 比安装的 APK 新）→ 提示下载新 APK
 *   Windows：Tauri 更新器检查 → 下载、校验签名、安装 → 重启
 *   网页：PWA 自己会提示刷新，这里不管
 * 更新只连自己的服务器；热更新插件的统计上报已在 capacitor.config 里关闭。
 */
import { create } from 'zustand';
import { MIRROR_MIN_CLIENT_VERSION } from '@shared/constants';
import type { AppManifest } from '@shared/types';
import { appApi } from '@/api/endpoints';
import { compareSemver } from '@/lib/version';
import { platform } from '@/platform';

type State =
  | { kind: 'idle' }
  | { kind: 'web-ready'; version: string; notes: string; bundleId: string }
  | { kind: 'apk'; version: string; notes: string; url: string }
  | { kind: 'desktop'; version: string; notes: string; error?: string }
  /** pct 为 null：还不知道总大小，或下载完正在安装 */
  | { kind: 'installing'; version: string; notes: string; pct: number | null };

export const useUpdate = create<{ state: State }>(() => ({ state: { kind: 'idle' } }));
const set = (state: State) => useUpdate.setState({ state });

/** 安卓：启动后尽早调用，告诉热更新插件"这一版能正常跑"，否则它会回滚到上一版 */
export async function markAppReady() {
  if (platform !== 'android') return;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* 插件不可用时照常运行 */
  }
}

let checking = false;
type DownloadEvent = { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' };
let desktopUpdate: { downloadAndInstall: (onEvent?: (e: DownloadEvent) => void) => Promise<void> } | null = null;

let lastCheckAt = 0;
/** 回到前台时，距上次检查超过这么久才再查一次 */
const RESUME_CHECK_MS = 30 * 60_000;

async function runCheck() {
  checking = true;
  lastCheckAt = Date.now();
  try {
    if (platform === 'android') await checkAndroid();
    else await checkDesktop();
  } finally {
    checking = false;
  }
}

export async function checkForUpdates(): Promise<void> {
  if (checking || platform === 'web' || !navigator.onLine) return;
  try {
    await runCheck();
  } catch {
    /* 检查失败不打扰用户，下次再查 */
  }
}

/** 手机上 App 常年挂在后台，进程不退出就不会重新启动，定时器也会被系统冻结：回到前台时补查 */
export function checkOnResume() {
  if (Date.now() - lastCheckAt >= RESUME_CHECK_MS) void checkForUpdates();
}

/** 设置页的"检查更新"：把结果和失败原因说出来 */
export async function checkNow(): Promise<string> {
  if (checking) return '正在检查，请稍等。';
  try {
    await runCheck();
  } catch (e) {
    return `检查失败：${e instanceof Error ? e.message : String(e)}`;
  }
  const s = useUpdate.getState().state;
  return s.kind === 'idle' ? `已经是最新版 v${__APP_VERSION__}。` : `发现新版本 v${s.version}，请看页面上方的提示。`;
}

async function checkAndroid() {
  const m = await appApi.manifest();
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  const builtin = (await CapacitorUpdater.getBuiltinVersion()).version;
  // 安装包比手里的新：原生部分有变化，界面包可能依赖新插件，先提示装 APK
  if (m.android && compareSemver(m.android.version, builtin) > 0) {
    set({ kind: 'apk', version: m.android.version, notes: m.android.notes, url: m.android.url });
    return;
  }
  if (!m.web || compareSemver(m.web.version, __APP_VERSION__) <= 0) return;
  const list = await CapacitorUpdater.list();
  const existing = list.bundles.find((b) => b.version === m.web!.version && b.status === 'success');
  const bundle = existing ?? (await downloadBundle(CapacitorUpdater, m.web, builtin));
  // 下次启动自动生效；用户也可以点"现在重启"
  await CapacitorUpdater.next({ id: bundle.id });
  set({ kind: 'web-ready', version: m.web.version, notes: m.web.notes, bundleId: bundle.id });
}

/** 优先走国内镜像（安装包要够新才放行 http）；镜像下载失败就退回香港。校验值都来自 https 的清单，走哪条线都不怕被改 */
async function downloadBundle(
  updater: typeof import('@capgo/capacitor-updater').CapacitorUpdater,
  web: NonNullable<AppManifest['web']>,
  builtin: string,
) {
  const mirror = web.mirrorUrl && compareSemver(builtin, MIRROR_MIN_CLIENT_VERSION) >= 0 ? web.mirrorUrl : null;
  if (mirror) {
    try {
      return await updater.download({ url: mirror, version: web.version, checksum: web.sha256 });
    } catch {
      /* 退回香港 */
    }
  }
  return updater.download({ url: web.url, version: web.version, checksum: web.sha256 });
}

async function checkDesktop() {
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return;
  desktopUpdate = u;
  set({ kind: 'desktop', version: u.version, notes: u.body ?? '' });
}

/** 用户点了"现在更新 / 重启" */
export async function applyUpdate() {
  const s = useUpdate.getState().state;
  if (s.kind === 'web-ready') {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    await CapacitorUpdater.set({ id: s.bundleId });
  } else if (s.kind === 'apk') {
    // 交给系统浏览器下载，下载完点通知即可安装
    window.open(s.url, '_system');
  } else if (s.kind === 'desktop' && desktopUpdate) {
    const { version, notes } = s;
    let total = 0;
    let got = 0;
    set({ kind: 'installing', version, notes, pct: null });
    try {
      await desktopUpdate.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress') {
          got += e.data.chunkLength;
          if (total) set({ kind: 'installing', version, notes, pct: Math.min(100, Math.round((got / total) * 100)) });
        } else set({ kind: 'installing', version, notes, pct: null });
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      // 断网、超时、签名校验失败：退回提示条，让用户能重试，别一直停在"正在下载"
      set({ kind: 'desktop', version, notes, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export function dismissUpdate() {
  set({ kind: 'idle' });
}
