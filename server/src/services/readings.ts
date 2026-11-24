/**
 * 离线识别结果的读音（v1.6.2）：内置识别（Vosk 日语小模型）按词输出，而且爱把读对的词写成汉字 ——
 * 读「いえ」出来是「家」，按字比对一个都对不上，就成了 0 分。
 *
 * content/voskReadings.json.gz 是这个模型词表（约 20 万词）的「写法 → 平假名读音」对照，
 * 由 kuromoji 离线逐词标注生成（只收写法与读音不同的词，约 16 万条）。服务端查表把识别结果换成读音，
 * 再和参考文本的读音比对。整套分词词典要多占约 300 MB 内存，这张表只占几十 MB，第一次用到时才载入。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

let table: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (!table) {
    const raw = readFileSync(join(__dirname, '..', 'content', 'voskReadings.json.gz'));
    table = new Map(Object.entries(JSON.parse(gunzipSync(raw).toString('utf8')) as Record<string, string>));
  }
  return table;
}

/** 识别结果（词与词之间有空格）→ 读音；表里没有的词原样保留。没有空格时整句查一次 */
export function readingOfTranscript(transcript: string): string {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const t = load();
  return words.map((w) => t.get(w) ?? w).join('');
}
