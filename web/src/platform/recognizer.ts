/**
 * 内置离线语音识别（契约 v1.6.0）：Vosk 日语小模型（约 47 MB），在 App 里用 WebAssembly 运行，
 * 不需要系统装语音服务，也不需要联网。
 *
 *   安卓：模型随 APK 放在原生 assets 里（不进网页资源，免得每次热更新都带上），
 *         首次使用由 ModelAssets 插件拷到私有目录，再以同源地址交给识别引擎。
 *   Windows：模型打进安装包，就在页面同源的 /models/ 下。
 *   网页：从我们的服务器下载一次（只下一次：直接交给 vosk，不再自己先下一遍）。
 *   vosk-browser 会把解压后的模型按地址存进 IndexedDB，之后打开 App 一秒内载入。
 *
 * 小模型精度有限：常把读对的词认成别的写法。评分时按 offlineSpeech 从宽处理。
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { KaldiRecognizer, Model } from 'vosk-browser';
import { apiOrigin, platform } from './index';
import type { Listening } from './speech';

const MODEL_FILE = 'vosk-model-small-ja-0.22.tar.gz';
const SERVER_URL = `${apiOrigin}/api/v1/app/models/${MODEL_FILE}`;
export const MODEL_MB = 47;
const READY_KEY = `vosk-ready:${MODEL_FILE}`;
const LISTEN_MAX_MS = 20_000;
/** 载入超过这个时间就放弃（交给系统识别兜底），别让人一直等。安装包自带模型不用下载，正常一两秒，给足一分钟；网页要下载，放宽 */
const LOAD_TIMEOUT_MS = platform === 'web' ? 180_000 : 60_000;

const ModelAssets = registerPlugin<{ prepare(o: { name: string }): Promise<{ path: string }> }>('ModelAssets');

/** 安装包里自带模型的平台：不需要下载 */
export const modelBundled = platform === 'android' || platform === 'desktop';

export function offlineSupported(): boolean {
  return typeof WebAssembly === 'object' && !!navigator.mediaDevices?.getUserMedia && typeof Worker === 'function';
}

/** 不用再下载了：安装包自带，或网页端已经载入过一次 */
export function modelDownloaded(): boolean {
  if (modelBundled) return true;
  try {
    return localStorage.getItem(READY_KEY) === '1';
  } catch {
    return false;
  }
}

/** 识别引擎从哪里取模型。安卓的插件不在（旧安装包跑新界面）就退回服务器下载 */
async function modelUrl(): Promise<string> {
  if (platform === 'android') {
    try {
      const { path } = await ModelAssets.prepare({ name: MODEL_FILE });
      return Capacitor.convertFileSrc(path);
    } catch {
      return SERVER_URL;
    }
  }
  // 识别在 Worker 里跑，相对地址不认，要给完整地址
  if (platform === 'desktop') return new URL(`/models/${MODEL_FILE}`, location.href).href;
  return SERVER_URL;
}

let modelP: Promise<Model> | null = null;

/** 载入模型；同一时间只载入一次。安卓、Windows 不联网，网页第一次会下载约 47 MB */
export function loadModel(): Promise<Model> {
  if (!modelP) {
    modelP = (async () => {
      const [{ createModel }, url] = await Promise.all([import('vosk-browser'), modelUrl()]);
      const model = await new Promise<Model>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('语音识别启动失败。可以先用"打字比对"或"自评"，或到设置里改用系统识别。')), LOAD_TIMEOUT_MS);
        createModel(url, -1).then(
          (m) => { clearTimeout(t); resolve(m); },
          (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); },
        );
      });
      try {
        localStorage.setItem(READY_KEY, '1');
      } catch {
        /* 存不了标记只是下次多显示一次下载提示 */
      }
      return model;
    })();
    modelP.catch(() => {
      modelP = null;
    });
  }
  return modelP;
}

/** 进入开口练习的页面时在后台先载入，等用户点麦克风时就绪了 */
export function warmRecognizer() {
  if (offlineSupported() && modelDownloaded()) void loadModel().catch(() => undefined);
}

/**
 * Vosk 按词输出、词间有空格。空格保留着交给服务端：评分时逐词查读音（「家」→「いえ」）再比对。
 * 界面上显示时用 displayTranscript 去掉空格。
 */
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
export const displayTranscript = (s: string) => s.replace(/\s+/g, '');

export function offlineListen(): Listening {
  let stopRequested = false;
  let finish: (() => void) | null = null;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((r) => (markReady = r));
  const result = (async () => {
    const model = await loadModel();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }).catch((e: Error) => {
      throw new Error(e.name === 'NotAllowedError' ? '没有麦克风权限，请在系统设置里允许' : `打不开麦克风：${e.message}`);
    });
    const ctx = new AudioContext();
    // 手机 WebView 里不是在点击当下创建的音频上下文默认是暂停的，不恢复就一直收不到声音
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    const rec: KaldiRecognizer = new model.KaldiRecognizer(ctx.sampleRate);
    const parts: string[] = [];
    let partial = '';
    rec.on('result', (m) => {
      const t = (m as { result?: { text?: string } }).result?.text;
      if (t) parts.push(tidy(t));
      partial = '';
    });
    rec.on('partialresult', (m) => {
      partial = tidy((m as { result?: { partial?: string } }).result?.partial ?? '');
    });
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor 已不推荐但各 WebView 都支持；4096 帧一块送进识别器
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      try {
        rec.acceptWaveform(e.inputBuffer);
      } catch {
        /* 识别器已移除 */
      }
    };
    source.connect(node);
    node.connect(ctx.destination);
    markReady();

    await new Promise<void>((resolve) => {
      finish = resolve;
      if (stopRequested) resolve();
      setTimeout(resolve, LISTEN_MAX_MS);
    });
    // 收尾：停止送音，取最后一段结果（最多等 1.5 秒）
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1500);
      rec.on('result', () => {
        clearTimeout(t);
        resolve();
      });
      rec.retrieveFinalResult();
    });
    rec.remove();
    void ctx.close();
    return (parts.join(' ') || partial).trim();
  })();
  // 出错时也要让等 ready 的界面结束等待
  void result.catch(() => markReady());
  return {
    result,
    ready,
    stop() {
      stopRequested = true;
      finish?.();
    },
  };
}
