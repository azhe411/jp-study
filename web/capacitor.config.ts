import type { CapacitorConfig } from '@capacitor/cli';

/** Capacitor 安卓壳：页面来源为 https://localhost（契约 v1.1.0 §12.1） */
const config: CapacitorConfig = {
  appId: 'top.azclient.jp',
  appName: '一駅',
  webDir: 'dist-android',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  plugins: {
    // 边到边显示：安全区以 --safe-area-inset-* 注入，样式里用 var(--sat)/var(--sab) 接住
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
    // 界面热更新（契约 v1.3.0 §16）：只由应用自己去自家服务器检查；关闭自动更新与一切第三方上报
    CapacitorUpdater: { autoUpdate: false, updateUrl: '', statsUrl: '', channelUrl: '', resetWhenUpdate: true, appReadyTimeout: 15000 },
  },
};

export default config;
