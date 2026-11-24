/**
 * 在线朗读音频（契约 v1.5.0 §18）：服务端用神经语音生成 mp3，三个平台听到的是同一个声音，
 * 不再依赖手机或电脑有没有装日语语音包。
 *
 *   地址可以在本地算出来：/api/v1/tts/{sha1(声音|规整后的文本)}.mp3
 *   1. 先查本机缓存（Cache Storage，断网也能放）
 *   2. 再直接取文件（内容库和课程里的句子都已预生成）
 *   3. 都没有：请服务端现生成，再取
 * 任何一步失败返回 null，由调用方退回系统朗读。每一步都有时限，绝不让按钮一直转。
 */
import { TTS_MAX_CHARS, TTS_VOICE } from '@shared/constants';
import { ttsApi } from '@/api/endpoints';
import { apiOrigin } from './index';

const CACHE = 'tts-v1';
const FETCH_MS = 8000;
const CREATE_MS = 20000;

export const normalizeTtsText = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿]/.test(text);

async function sha1(s: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function openCache(): Promise<Cache | null> {
  try {
    return 'caches' in window ? await caches.open(CACHE) : null;
  } catch {
    return null;
  }
}

async function fetchMp3(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 文本 → 可播放的 object URL；会话内记住，免得反复解码 */
const memo = new Map<string, Promise<string | null>>();

async function load(text: string): Promise<string | null> {
  const key = await sha1(`${TTS_VOICE}|${text}`);
  const cache = await openCache();
  let url = key ? `${apiOrigin}/api/v1/tts/${key}.mp3` : null;

  if (url && cache) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) return URL.createObjectURL(await hit.blob());
  }
  let res = url ? await fetchMp3(url) : null;
  if (!res) {
    // 没有现成的：请服务端生成（需要登录、需要联网）
    const made = await timeout(ttsApi.create(text), CREATE_MS).catch(() => null);
    if (!made) return null;
    url = `${apiOrigin}${made.url}`;
    res = await fetchMp3(url);
    if (!res) return null;
  }
  const blob = await res.blob();
  if (cache && url) await cache.put(url, new Response(blob, { headers: { 'content-type': 'audio/mpeg' } })).catch(() => undefined);
  return URL.createObjectURL(blob);
}

export function audioUrl(raw: string): Promise<string | null> {
  const text = normalizeTtsText(raw);
  if (!text || text.length > TTS_MAX_CHARS || !hasJapanese(text)) return Promise.resolve(null);
  let p = memo.get(text);
  if (!p) {
    p = load(text).catch(() => null);
    memo.set(text, p);
    // 失败的不记住：下次联网了还能再试
    void p.then((u) => { if (!u) memo.delete(text); });
  }
  return p;
}

/* ───────────── 播放 ───────────── */

let current: { el: HTMLAudioElement; done: () => void } | null = null;

export function stopAudio() {
  if (!current) return;
  current.el.pause();
  current.done();
  current = null;
}

/** 播放到结束（或被 stop、出错、超时）才返回；返回 false 表示根本没放出来 */
export function playAudio(src: string, rate = 1): Promise<boolean> {
  stopAudio();
  return new Promise<boolean>((resolve) => {
    const el = new Audio(src);
    el.playbackRate = rate;
    let started = false;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => {
      clearTimeout(guard);
      el.onended = el.onerror = el.onplaying = null;
      if (current?.el === el) current = null;
      resolve(ok);
    };
    current = { el, done: () => finish(true) };
    el.onplaying = () => {
      started = true;
      // 放到一半卡住也要收场：按音频时长留足余量
      clearTimeout(guard);
      const ms = (Number.isFinite(el.duration) ? el.duration / rate : 30) * 1000 + 3000;
      guard = setTimeout(() => finish(true), ms);
    };
    el.onended = () => finish(true);
    el.onerror = () => finish(started);
    // 迟迟放不出来（自动播放被拦、解码器挂起）：5 秒后放弃，交给系统朗读
    guard = setTimeout(() => { if (!started) { el.pause(); finish(false); } }, 5000);
    el.play().catch(() => finish(false));
  });
}

/** 后台预取一批句子（课程页、练习页打开时调用），两路并发，失败忽略 */
export async function prefetchAudio(texts: string[]) {
  const list = [...new Set(texts.map(normalizeTtsText))].filter(Boolean);
  let i = 0;
  await Promise.all([0, 1].map(async () => {
    while (i < list.length) await audioUrl(list[i++]);
  }));
}
