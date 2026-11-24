import { buildApp } from './app';
import { loadConfig } from './config';
import { purgeIdempotencyKeys } from './plugins/idempotency';

const HOUR = 3_600_000;

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);

  const timer = setInterval(() => {
    purgeIdempotencyKeys(app)
      .then((n) => n && app.log.info({ purged: n }, 'idempotency keys purged'))
      .catch((e) => app.log.warn({ err: e }, 'idempotency purge failed'));
  }, 6 * HOUR);
  timer.unref();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      app.log.info({ sig }, 'shutting down');
      clearInterval(timer);
      app.close().then(() => process.exit(0), () => process.exit(1));
    });
  }

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ ai: app.ai.configured ? app.ai.model : 'missing' }, 'jp-study server ready');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
