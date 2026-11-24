/**
 * 语音引擎（契约 v1.1.0 §12.4）：朗读（TTS）与识别能力的统一入口。
 *   朗读一律先用服务端生成的在线音频（v1.5.0，见 ./audio.ts），拿不到才用下面的系统朗读：
 *   web     → 浏览器 speechSynthesis / SpeechRecognition
 *   android → 原生 TextToSpeech / SpeechRecognizer（Capacitor 社区插件），失败退回 WebView
 *   desktop → WebView2 的 speechSynthesis；识别暂无原生方案，如实报告"不可用"
 * 任何一环不可用都只降级、不抛错 —— 页面据此切换为文字对照。
 * 识别：listen() 开始收音，返回一个可手动 stop() 的会话，result 给出识别文本（日语）。
 */
import type { RecognitionMethod } from '@shared/constants';
import { playAudio, audioUrl, stopAudio } from './audio';
import { offlineListen, offlineSupported } from './recognizer';
import { platform } from './index';

export interface Voice {
  /** 存进 settings.ttsVoice 的稳定标识（声音名） */
  name: string;
  lang: string;
}

export interface SpeakOptions {
  rate?: number;
  voiceName?: string | null;
}

export interface SpeechEngine {
  readonly kind: 'native' | 'web';
  ttsAvailable(): Promise<boolean>;
  /** 仅日语声音 */
  voices(): Promise<Voice[]>;
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  stop(): Promise<void>;
  recognitionAvailable(): Promise<boolean>;
  /** 开始一次识别；不可用时抛错，调用方应先看 recognitionAvailable() */
  listen(): Listening;
  /** 上报给服务端的识别方式 */
  readonly method: RecognitionMethod;
}

export interface Listening {
  /** 识别出的文本；没听到任何内容时为空串 */
  result: Promise<string>;
  /** 麦克风真正开始收音（内置识别要先把模型载入内存，要几秒）；没有这一步的引擎可不提供 */
  ready?: Promise<void>;
  /** 说完了：结束收音并尽快给出结果 */
  stop(): void;
}

/** 一次识别最长收音时间：防止安静环境里一直开着麦克风 */
const LISTEN_MAX_MS = 20_000;

type WebRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function webListen(): Listening {
  const Ctor = (window as unknown as { SpeechRecognition?: new () => WebRecognition; webkitSpeechRecognition?: new () => WebRecognition })
    .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => WebRecognition }).webkitSpeechRecognition;
  if (!Ctor) throw new Error('当前浏览器不支持语音识别');
  const rec = new Ctor();
  rec.lang = 'ja-JP';
  rec.interimResults = false;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  let text = '';
  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      text = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? '')
        .join('');
    };
    rec.onerror = (e) => {
      // 没说话、被中止都不算错：交回已识别的部分
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      reject(new Error(e.error === 'not-allowed' ? '没有麦克风权限' : e.error === 'network' ? '语音识别需要联网（浏览器识别走在线服务）' : `识别失败：${e.error}`));
    };
    rec.onend = () => resolve(text.trim());
  });
  rec.start();
  const timer = setTimeout(() => rec.stop(), LISTEN_MAX_MS);
  void result.finally(() => clearTimeout(timer)).catch(() => undefined);
  return { result, stop: () => rec.stop() };
}

const isJa = (lang: string) => lang.toLowerCase().replace('_', '-').startsWith('ja');

/**
 * 部分国产 ROM 上，系统 TTS / 识别服务绑定不上时原生调用会一直挂起。
 * 给每次调用一个期限，超时即视为失败，交给调用方降级 —— 宁可报不可用，也不让页面一直转圈。
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const PROBE_MS = 3000;

/* ───────────── 浏览器 / WebView ───────────── */

function loadWebVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const now = speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

function webEngine(canRecognize: boolean): SpeechEngine {
  const has = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
  return {
    kind: 'web',
    ttsAvailable: async () => has(),
    async voices() {
      if (!has()) return [];
      return (await loadWebVoices()).filter((v) => isJa(v.lang)).map((v) => ({ name: v.name, lang: v.lang }));
    },
    async speak(text, opts = {}) {
      if (!has()) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = opts.rate ?? 1;
      const v = opts.voiceName ? (await loadWebVoices()).find((x) => x.name === opts.voiceName) : undefined;
      if (v) u.voice = v;
      // 有的 WebView 从不触发 onend（没有日语声音时尤其常见）：按字数给个期限，到点就当读完
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { speechSynthesis.cancel(); resolve(); }, 4000 + text.length * 350);
        const done = () => { clearTimeout(t); resolve(); };
        u.onend = done;
        u.onerror = done;
        speechSynthesis.speak(u);
      });
    },
    async stop() {
      if (has()) speechSynthesis.cancel();
    },
    recognitionAvailable: async () =>
      canRecognize && typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    method: 'webSpeech',
    listen: webListen,
  };
}

/* ───────────── 安卓原生 ───────────── */

function androidEngine(): SpeechEngine {
  const fallback = webEngine(false);
  const tts = () => import('@capacitor-community/text-to-speech').then((m) => m.TextToSpeech);
  return {
    kind: 'native',
    async ttsAvailable() {
      try {
        const { supported } = await withTimeout((await tts()).isLanguageSupported({ lang: 'ja-JP' }), PROBE_MS);
        return supported || fallback.ttsAvailable();
      } catch {
        return fallback.ttsAvailable();
      }
    },
    async voices() {
      try {
        const { voices } = await withTimeout((await tts()).getSupportedVoices(), PROBE_MS);
        return voices.filter((v) => isJa(v.lang)).map((v) => ({ name: v.name, lang: v.lang }));
      } catch {
        return fallback.voices();
      }
    },
    async speak(text, opts = {}) {
      try {
        const t = await tts();
        let voice: number | undefined;
        if (opts.voiceName) {
          const { voices } = await withTimeout(t.getSupportedVoices(), PROBE_MS);
          const i = voices.findIndex((v) => v.name === opts.voiceName);
          if (i >= 0) voice = i;
        }
        // 朗读本身可能较长，期限按字数放宽
        await withTimeout(t.speak({ text, lang: 'ja-JP', rate: opts.rate ?? 1, voice }), 8000 + text.length * 400);
      } catch {
        await fallback.speak(text, opts);
      }
    },
    async stop() {
      try {
        await withTimeout((await tts()).stop(), PROBE_MS);
      } catch {
        await fallback.stop();
      }
    },
    async recognitionAvailable() {
      try {
        const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
        return (await withTimeout(SpeechRecognition.available(), PROBE_MS)).available;
      } catch {
        return false;
      }
    },
    method: 'nativeSpeech',
    listen(): Listening {
      let stopRequested = false;
      let stopFn: (() => void) | null = null;
      const result = (async () => {
        const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
        const perm = await SpeechRecognition.requestPermissions();
        if (perm.speechRecognition !== 'granted') throw new Error('没有麦克风权限，请在系统设置里允许');
        stopFn = () => void SpeechRecognition.stop().catch(() => undefined);
        if (stopRequested) return '';
        // 不用系统弹窗：结果由 start() 的返回值带回；说完停顿系统会自动结束
        const timer = setTimeout(() => stopFn?.(), LISTEN_MAX_MS);
        try {
          const r = await SpeechRecognition.start({ language: 'ja-JP', maxResults: 1, partialResults: false, popup: false });
          return (r.matches?.[0] ?? '').trim();
        } finally {
          clearTimeout(timer);
        }
      })();
      return {
        result,
        stop() {
          stopRequested = true;
          stopFn?.();
        },
      };
    },
  };
}

/* ───────────── 识别引擎的选择（v1.6.0） ───────────── */

export type RecognizerChoice = 'offline' | 'system';
const CHOICE_KEY = 'recognizer';

/** 默认用内置离线识别；用户可在设置里改回系统识别（存在本机） */
export function recognizerChoice(): RecognizerChoice {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    if (v === 'system' || v === 'offline') return v;
  } catch {
    /* 读不到就用默认 */
  }
  return offlineSupported() ? 'offline' : 'system';
}

export function setRecognizerChoice(c: RecognizerChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, c);
  } catch {
    /* 存不下就只在本次生效 */
  }
}

const useOffline = () => recognizerChoice() === 'offline' && offlineSupported();

/**
 * 内置识别还没开始收音就失败了（模型下不下来、WebView 拒了麦克风）：系统识别能用就自动换过去，
 * 用户只会觉得"慢了一点"，而不是看到一条报错。已经开始收音之后的失败照常报告。
 */
function offlineWithFallback(sys: SpeechEngine): Listening {
  const first = offlineListen();
  let started = false;
  let current: Listening = first;
  void first.ready?.then(() => (started = true));
  const result = first.result.catch(async (e: Error) => {
    if (started || !(await sys.recognitionAvailable().catch(() => false))) throw e;
    current = sys.listen();
    return current.result;
  });
  return { result, ready: first.ready, stop: () => current.stop() };
}

/** 朗读：在线音频优先，系统朗读兜底；识别：内置离线识别优先，可切换为系统识别 */
function withServerAudio(sys: SpeechEngine): SpeechEngine {
  return {
    ...sys,
    recognitionAvailable: async () => (useOffline() ? true : sys.recognitionAvailable()),
    listen: () => (useOffline() ? offlineWithFallback(sys) : sys.listen()),
    get method() {
      return useOffline() ? 'offlineSpeech' : sys.method;
    },
    // 在线音频随时可能可用（有缓存或能联网），所以朗读按钮始终显示
    ttsAvailable: async () => true,
    async speak(text, opts = {}) {
      const src = await audioUrl(text);
      if (src && (await playAudio(src, opts.rate ?? 1))) return;
      await sys.speak(text, opts);
    },
    async stop() {
      stopAudio();
      await sys.stop();
    },
  };
}

/** 系统自带的朗读：在线音频拿不到时的兜底 */
export const systemSpeech: SpeechEngine = platform === 'android' ? androidEngine() : platform === 'desktop' ? webEngine(false) : webEngine(true);

export const speech: SpeechEngine = withServerAudio(systemSpeech);
