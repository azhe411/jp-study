/**
 * 预生成课程讲义：部署后在容器里后台运行一次，用户第一次打开课程就不用等 AI。
 *   docker compose exec -d app node dist/server/src/scripts/warmLessons.js N5 N4 N3
 * 已生成的跳过；单课失败只记日志、继续下一课；可重复运行。
 */
import pino from 'pino';
import { loadConfig } from '../config';
import { CURRICULUM } from '../content/curriculum';
import { createPool } from '../db/pool';
import { AiService } from '../services/ai';
import { warmLesson } from '../services/learning';

async function main() {
  const parts = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['N5', 'N4']);
  const config = loadConfig();
  const log = pino({ level: 'info' });
  const db = createPool(config.databaseUrl);
  const ai = new AiService(config.ai, log);
  const todo = CURRICULUM.filter((l) => !l.content && parts.has(l.part));
  let ok = 0;
  for (const l of todo) {
    const started = Date.now();
    try {
      await warmLesson(db, ai, l.id);
      ok++;
      log.info({ lesson: l.id, ms: Date.now() - started }, 'lesson ready');
    } catch (e) {
      log.warn({ lesson: l.id, err: (e as Error).message }, 'lesson failed');
    }
  }
  log.info({ ok, total: todo.length }, 'warm done');
  await db.end();
}

void main();
