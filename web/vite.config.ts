import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

/** Windows 安装包自带的离线识别模型（放在 web/native-assets/，不进仓库网页资源） */
const RECOGNITION_MODEL = 'vosk-model-small-ja-0.22.tar.gz';
const root = fileURLToPath(new URL('.', import.meta.url));

// 开发时把 /api 代理到线上后端（或本地：VITE_PROXY_TARGET=http://127.0.0.1:3100）
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'https://jp.azclient.top';

/**
 * 三种构建：
 *   vite build                → dist/          网页 + PWA
 *   vite build --mode android → dist-android/  Capacitor 安卓壳（不要 Service Worker）
 *   vite build --mode desktop → dist-desktop/  Tauri 桌面壳（同上）
 */
export default defineConfig(({ mode }) => {
  const isApp = mode === 'android' || mode === 'desktop';
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Windows 安装包自带离线识别模型（v1.6.x）：构建桌面版时把模型复制到 /models/。
      // 安卓不走这里（模型在原生 assets，见 release.sh），网页版从服务器下载。
      mode === 'desktop' && {
        name: 'bundle-recognition-model',
        apply: 'build' as const,
        closeBundle() {
          const src = resolve(root, 'native-assets', RECOGNITION_MODEL);
          if (!existsSync(src)) throw new Error(`缺少识别模型 ${src}，先从服务器下载：/api/v1/app/models/${RECOGNITION_MODEL}`);
          mkdirSync(resolve(root, 'dist-desktop', 'models'), { recursive: true });
          copyFileSync(src, resolve(root, 'dist-desktop', 'models', RECOGNITION_MODEL));
        },
      },
      VitePWA({
        disable: isApp,
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: '一駅 · 日语学习',
          short_name: '一駅',
          description: '个人日语学习系统：任务、抽认卡、场景对话、听说读写一站式',
          lang: 'zh-CN',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: '#80c241',
          background_color: '#eef0ee',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // 离线识别引擎（约 5.8 MB）用到时才下载，不进预缓存
          globIgnores: ['**/vosk-*.js'],
          navigateFallback: '/index.html',
          // API 永远走网络（离线读写由阶段 7 的 IndexedDB + outbox 负责）
          navigateFallbackDenylist: [/^\/api\//, /^\/get(\/|$)/],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      fs: { allow: ['..'] },
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true, secure: true, cookieDomainRewrite: { '*': '' } },
      },
    },
    build: { target: 'es2022', sourcemap: false, outDir: isApp ? `dist-${mode}` : 'dist' },
    test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
  };
});
