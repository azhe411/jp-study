/**
 * 预生成朗读音频：把内容库和课程讲义里所有要读的日语先生成好，用户点"朗读"时直接命中缓存。
 *   docker compose exec -d app node dist/server/src/scripts/warmAudio.js
 * 已存在的跳过；单条失败只记日志；可重复运行（新增内容后再跑一次即可）。
 */
import pino from 'pino';
import { loadConfig } from '../config';
import { CURRICULUM } from '../content/curriculum';
import { EXPRESSIONS } from '../content/expressions';
import { KANJI } from '../content/kanji';
import { LISTENING } from '../content/listening';
import { BUILTIN_PHRASES } from '../content/phrases';
import { PRONUNCIATION_PAIRS } from '../content/pronunciation';
import { SCENARIOS } from '../content/scenarios';
import { VOCAB_WORDS } from '../content/vocab';
import { createPool } from '../db/pool';
import { TTS_MAX_CHARS, ensureAudio, hasJapanese, normalizeTtsText } from '../services/tts';

type Ex = { ja: string };
type Content = { sections?: Array<{ examples: Ex[] }>; vocab?: Array<{ word: string }>; kanaRows?: Array<Array<{ kana: string }>> | null };

function fromContent(c: Content | null | undefined): string[] {
  if (!c) return [];
  return [
    ...(c.sections ?? []).flatMap((s) => s.examples.map((e) => e.ja)),
    ...(c.vocab ?? []).map((w) => w.word),
    ...(c.kanaRows ?? []).flat().map((k) => k.kana.replace(/（.*?）/g, '')),
  ];
}

async function main() {
  const config = loadConfig();
  const log = pino({ level: 'info' });
  const db = createPool(config.databaseUrl);
  const { rows } = await db.query('SELECT content FROM lesson_content');
  const extras = await db.query('SELECT vocab, sentences FROM lesson_extras');

  const texts = [
    ...CURRICULUM.flatMap((l) => fromContent(l.content)),
    ...rows.flatMap((r) => fromContent(r.content as Content)),
    ...extras.rows.flatMap((r) => [
      ...(r.vocab as Array<{ word: string; example?: Ex }>).flatMap((v) => [v.word, ...(v.example ? [v.example.ja] : [])]),
      ...(r.sentences as Ex[]).map((s) => s.ja),
    ]),
    ...BUILTIN_PHRASES.map((p) => p.ja),
    ...KANJI.flatMap((k) => k.commonWords.map((w) => w.word)),
    ...EXPRESSIONS.flatMap((e) => [e.expression, ...e.examples.map((x) => x.ja)]),
    ...LISTENING.flatMap((m) => m.segments.map((s) => s.text)),
    ...PRONUNCIATION_PAIRS.flatMap((p) => [p.a.text, p.b.text]),
    ...SCENARIOS.flatMap((s) => s.keyPhrases),
    ...VOCAB_WORDS.map((w) => w.word),
  ];
  const unique = [...new Set(texts.map(normalizeTtsText))].filter((t) => t && t.length <= TTS_MAX_CHARS && hasJapanese(t));
  log.info({ total: unique.length }, 'warm audio start');
  let ok = 0;
  let failed = 0;
  // 两路并发：服务本身也在用这台小机器
  let next = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (next < unique.length) {
        const t = unique[next++];
        try {
          await ensureAudio(config.audioDir, config.ttsVoice, t);
          ok++;
          if (ok % 200 === 0) log.info({ ok, failed, total: unique.length }, 'progress');
        } catch (e) {
          failed++;
          log.warn({ text: t.slice(0, 30), err: (e as Error).message }, 'audio failed');
        }
      }
    }),
  );
  log.info({ ok, failed, total: unique.length }, 'warm audio done');
  await db.end();
}

void main();
