/**
 * 平台识别（契约 v1.1.0 §12.1）。
 * 同一份代码跑在三处：浏览器 / PWA（web）、Capacitor 安卓壳（android）、Tauri 桌面壳（desktop）。
 * 构建时可用 VITE_PLATFORM 钉死；否则看壳注入的全局对象。
 */
import { BODY_TOKEN_PLATFORMS, CLIENT_PLATFORMS, type ClientPlatform } from '@shared/constants';

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean };
    __TAURI_INTERNALS__?: unknown;
  }
}

function detect(): ClientPlatform {
  const forced = import.meta.env.VITE_PLATFORM as string | undefined;
  if (forced && (CLIENT_PLATFORMS as readonly string[]).includes(forced)) return forced as ClientPlatform;
  if (typeof window === 'undefined') return 'web';
  if (window.Capacitor?.isNativePlatform?.()) return 'android';
  if (window.__TAURI_INTERNALS__) return 'desktop';
  return 'web';
}

export const platform: ClientPlatform = detect();

/** 原生壳：refresh token 走请求/响应体并存系统安全存储，API 走绝对地址 */
export const isApp = (BODY_TOKEN_PLATFORMS as readonly ClientPlatform[]).includes(platform);

/** API 来源：网页端同源（空串）；App 端直连香港（jpd，不经 Cloudflare，国内访问快） */
export const apiOrigin: string = isApp ? (import.meta.env.VITE_API_ORIGIN as string | undefined) || 'https://jpd.azclient.top:8443' : '';
