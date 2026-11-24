/**
 * 批量生成每课的扩充内容（更多生词带例句 + 句子），部署后在容器里后台跑一次：
 *   docker compose exec -d -e AI_TIMEOUT_MS=180000 app sh -c "node dist/server/src/scripts/warmExtras.js > /audio/extras.log 2>&1"
 * 用服务器的 AI Key（课程内容是共享的）。已生成的跳过；单课失败只记日志；可重复运行。
 */
import pino from 'pino';
import { loadConfig } from '../config';
import { CURRICULUM } from '../content/curriculum';
import { createPool } from '../db/pool';
import { AiService } from '../services/ai';
import { warmExtras } from '../services/learning';

async function main() {
  const config = loadConfig();
  const log = pino({ level: 'info' });
  const db = createPool(config.databaseUrl);
  const ai = new AiService(config.ai, log);
  const todo = CURRICULUM.filter((l) => !l.content).map((l) => l.id);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let next = 0;
  // 三路并发：一课要几十秒，一路一路来要跑一个多小时
  await Promise.all(
    [0, 1, 2].map(async () => {
      while (next < todo.length) {
        const id = todo[next++];
        const started = Date.now();
        try {
          if ((await warmExtras(db, ai, id)) === 'done') {
            ok++;
            log.info({ id, ms: Date.now() - started, ok, total: todo.length }, 'extras ready');
          } else skipped++;
        } catch (e) {
          failed++;
          log.warn({ id, err: (e as Error).message }, 'extras failed');
        }
      }
    }),
  );
  log.info({ ok, skipped, failed, total: todo.length }, 'extras done');
  await db.end();
}

void main();
