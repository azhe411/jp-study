/**
 * 朗读音频（契约 v1.5.0 §18）：日语文本 → mp3，由容器里的 edge-tts 生成，按内容哈希落盘缓存。
 *
 *   键 = sha1(声音 + "|" + 规整后的文本)，客户端用同样的算法能直接拼出文件地址，先试缓存，不中再请求生成。
 *   同一段文本并发请求只生成一次；同时最多生成 TTS_CONCURRENCY 段，免得 1 核小机器被挤满。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TTS_MAX_CHARS } from '../../../shared/constants';
import { AppError } from '../lib/errors';

export { TTS_MAX_CHARS };

const TTS_CONCURRENCY = 2;
const TTS_TIMEOUT_MS = 25_000;

/** 规整：Unicode 合成、压掉连续空白。客户端必须与此一致 */
export const normalizeTtsText = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

export const ttsKey = (voice: string, text: string) => createHash('sha1').update(`${voice}|${normalizeTtsText(text)}`).digest('hex');

/** 至少要有一个假名或汉字：别把纯中文、纯符号送去日语朗读 */
export const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿]/.test(text);

export const ttsPath = (dir: string, key: string) => join(dir, key.slice(0, 2), `${key}.mp3`);

let running = 0;
const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= TTS_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function runEdgeTts(voice: string, text: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 参数数组直传，不经过 shell：文本里有什么符号都不会被当成命令
    const p = spawn('edge-tts', ['--voice', voice, '--text', text, '--write-media', out], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => {
      if (err.length < 2000) err += d.toString();
    });
    const timer = setTimeout(() => p.kill('SIGKILL'), TTS_TIMEOUT_MS);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`edge-tts exit ${code}: ${err.trim().split('\n').pop() ?? ''}`));
    });
  });
}

const inflight = new Map<string, Promise<string>>();

/** 确保音频已在磁盘上，返回键。生成失败抛 TTS_UNAVAILABLE */
export async function ensureAudio(dir: string, voice: string, rawText: string): Promise<string> {
  const text = normalizeTtsText(rawText);
  const key = ttsKey(voice, text);
  const path = ttsPath(dir, key);
  if ((await stat(path).catch(() => null))?.size) return key;
  let p = inflight.get(key);
  if (!p) {
    p = slot(async () => {
      await mkdir(join(dir, key.slice(0, 2)), { recursive: true });
      const tmp = `${path}.${process.pid}.${Date.now()}.part`;
      try {
        await runEdgeTts(voice, text, tmp);
        if (!(await stat(tmp)).size) throw new Error('edge-tts 输出为空');
        await rename(tmp, path);
        return key;
      } catch (e) {
        await rm(tmp, { force: true });
        throw new AppError('TTS_UNAVAILABLE', undefined, { reason: (e as Error).message.slice(0, 200) });
      }
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
