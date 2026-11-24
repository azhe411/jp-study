/**
 * 跟读 / 朗读 / 听写的评分（契约 §9）：
 *   假名归一化 → 字符级对齐（LCS）→ accuracy / completeness / fluency / overall + DiffSegment[]。
 *
 * 识别结果可能是汉字也可能是假名，而服务端没有词典可做汉字→读音转换。
 * 折中办法：参考文本同时给出"原文"与"读音"两条，各对齐一次，取分高的那条。
 * fluency 只是启发式：用时与参考语速之比落在舒适区间内即满分。
 */
import type { RecognitionMethod } from '../../../shared/constants';
import type { DiffSegment, SpeechScores } from '../../../shared/types';
import { readingOfTranscript } from './readings';

/* ───────────── 归一化 ───────────── */

// 标点、空白与各类括号不参与比较；长音符"ー"是发音的一部分，保留
const IGNORED = /[\s\p{P}\p{S}]/u;
const KEEP = new Set(['ー']);

/** NFKC → 片假名转平假名 → 去标点空白 → 拉丁字母小写 */
export function normalizeJa(s: string): string {
  const out: string[] = [];
  for (const ch of s.normalize('NFKC')) {
    if (KEEP.has(ch)) {
      out.push(ch);
      continue;
    }
    if (IGNORED.test(ch)) continue;
    const c = ch.codePointAt(0)!;
    // ァ(30A1)–ヶ(30F6) 与对应平假名相差 0x60
    out.push(c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch.toLowerCase());
  }
  return out.join('');
}

/* ───────────── 对齐 ───────────── */

/** 字符级最长公共子序列对齐，相邻的"缺漏 + 多出"合并为 replace */
export function diffChars(expected: string, actual: string): { segments: DiffSegment[]; matched: number } {
  const a = Array.from(expected);
  const b = Array.from(actual);
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度；文本上限几千字，按行压平存放
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }

  const ops: Array<{ op: 'equal' | 'delete' | 'insert'; ch: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ op: 'equal', ch: a[i] });
      i++;
      j++;
    } else if (j >= m || (i < n && dp[at(i + 1, j)] >= dp[at(i, j + 1)])) {
      ops.push({ op: 'delete', ch: a[i++] });
    } else {
      ops.push({ op: 'insert', ch: b[j++] });
    }
  }

  const segments: DiffSegment[] = [];
  for (let k = 0; k < ops.length; ) {
    if (ops[k].op === 'equal') {
      let s = '';
      while (k < ops.length && ops[k].op === 'equal') s += ops[k++].ch;
      segments.push({ op: 'equal', expected: s, actual: s });
      continue;
    }
    // 一段连续的不一致：缺漏的进 expected，多出的进 actual
    let exp = '';
    let act = '';
    while (k < ops.length && ops[k].op !== 'equal') {
      if (ops[k].op === 'delete') exp += ops[k].ch;
      else act += ops[k].ch;
      k++;
    }
    segments.push({ op: exp && act ? 'replace' : exp ? 'delete' : 'insert', expected: exp, actual: act });
  }
  return { segments, matched: dp[at(0, 0)] };
}

/* ───────────── 评分 ───────────── */

/** 学习者的舒适语速：每秒约 5 拍（母语者约 7–8 拍） */
const MORA_PER_SECOND = 5;
const KANJI = /\p{Script=Han}/u;

/** 粗估拍数：汉字按 2 拍、其余字符按 1 拍 */
function estimateMora(normalized: string): number {
  let n = 0;
  for (const ch of normalized) n += KANJI.test(ch) ? 2 : 1;
  return n;
}

function fluencyOf(durationMs: number, mora: number): number {
  if (durationMs <= 0 || mora === 0) return 0;
  const ratio = durationMs / ((mora / MORA_PER_SECOND) * 1000);
  // 太快多半是没读完；太慢则逐渐扣分，但留个底
  if (ratio < 0.6) return Math.round((ratio / 0.6) * 100);
  if (ratio <= 1.6) return 100;
  return Math.max(20, Math.round(100 - (ratio - 1.6) * 50));
}

/**
 * 内置离线识别（v1.6.0）模型小、常把读对的词认成别的写法：分数按 1-(1-x)^1.6 往上抬。
 * 50 → 67、70 → 85、30 → 43；0 和 100 不变，读得越差抬得越少，不会把乱读抬成及格。
 */
export const lenient = (score: number) => Math.round((1 - Math.pow(1 - score / 100, 1.6)) * 100);

const pct = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100);
const overallOf = (s: Omit<SpeechScores, 'overall'>) =>
  Math.round(s.accuracy * 0.45 + s.completeness * 0.35 + s.fluency * 0.2);

export interface ScoreInput {
  /** 参考原文（可含汉字） */
  reference: string;
  /** 参考读音（假名）；没有则只与原文比 */
  referenceReading?: string | null;
  transcript: string;
  method: RecognitionMethod;
  durationMs: number;
  /** method=selfAssessed 时必填 */
  selfScore?: number;
}

export interface ScoreResult {
  scores: SpeechScores;
  diff: DiffSegment[];
}

export function scoreSpeech(input: ScoreInput): ScoreResult {
  const transcript = normalizeJa(input.transcript);
  // 内置识别按词输出、常写成汉字：再拿它的读音比一次（「家」→「いえ」），取分高的
  const transcripts = [transcript];
  if (input.method === 'offlineSpeech' && input.transcript.trim()) {
    const reading = normalizeJa(readingOfTranscript(input.transcript));
    if (reading && reading !== transcript) transcripts.push(reading);
  }
  const candidates = [input.reference, input.referenceReading]
    .filter((s): s is string => !!s && !!s.trim())
    .map(normalizeJa)
    .filter((s, i, arr) => s && arr.indexOf(s) === i);

  if (input.method === 'selfAssessed') {
    const self = input.selfScore ?? 0;
    const diff = transcript && candidates[0] ? diffChars(candidates[0], transcript).segments : [];
    return { scores: { accuracy: self, fluency: self, completeness: self, overall: self }, diff };
  }

  let best: ScoreResult | null = null;
  for (const ref of candidates) for (const heard of transcripts) {
    const { segments, matched } = diffChars(ref, heard);
    let accuracy = heard.length ? pct(matched / Array.from(heard).length) : 0;
    let completeness = pct(matched / Array.from(ref).length);
    if (input.method === 'offlineSpeech') {
      accuracy = lenient(accuracy);
      completeness = lenient(completeness);
    }
    // 打字比对没有"用时"可言，流利度取前两项的均值；内置识别的用时含按键前后的停顿，也不可靠，同样处理
    const fluency =
      input.method === 'textCompare' || input.method === 'offlineSpeech'
        ? Math.round((accuracy + completeness) / 2)
        : Math.min(fluencyOf(input.durationMs, estimateMora(ref)), completeness);
    const scores = { accuracy, completeness, fluency, overall: overallOf({ accuracy, completeness, fluency }) };
    if (!best || scores.overall > best.scores.overall) best = { scores, diff: segments };
  }
  return best ?? { scores: { accuracy: 0, fluency: 0, completeness: 0, overall: 0 }, diff: [] };
}
