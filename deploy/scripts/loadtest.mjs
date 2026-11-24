// 压测：在 app 容器里运行（直连 127.0.0.1:3100，不经 Caddy / Cloudflare），量的是应用 + 数据库本身。
// 用法：docker compose exec -T app node - < loadtest.mjs
//   环境变量：BASE（默认 http://127.0.0.1:3100/api/v1）、SECONDS（每档时长，默认 15）
// 会注册一个 load-*@example.com 测试账号（需 ALLOW_REGISTER=true）。
const BASE = process.env.BASE ?? 'http://127.0.0.1:3100/api/v1';
const SECONDS = Number(process.env.SECONDS ?? 15);

const email = `load-${Date.now()}@example.com`;
const reg = await fetch(`${BASE}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'load-pass-123', displayName: 'load' }),
});
if (!reg.ok) throw new Error(`register ${reg.status}: ${await reg.text()}`);
const { accessToken } = await reg.json();
const auth = { authorization: `Bearer ${accessToken}` };

// 先造点数据，让读接口不是在查空表
for (let i = 0; i < 200; i++) {
  await fetch(`${BASE}/cards`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ clientOpId: crypto.randomUUID(), front: `負荷${i}`, back: `load ${i}` }),
  });
}
const pulled = await (await fetch(`${BASE}/sync/pull?limit=1000`, { headers: auth })).json();
const cursor = pulled.nextCursor;

const scenarios = [
  { name: 'GET /health', req: () => fetch(`${BASE}/health`) },
  { name: 'GET /tasks/today', req: () => fetch(`${BASE}/tasks/today`, { headers: auth }) },
  { name: 'GET /cards/due', req: () => fetch(`${BASE}/cards/due`, { headers: auth }) },
  { name: 'GET /sync/pull（增量）', req: () => fetch(`${BASE}/sync/pull?cursor=${cursor}`, { headers: auth }) },
  {
    name: 'POST /stats/time-logs（写 + 幂等）',
    req: () =>
      fetch(`${BASE}/stats/time-logs`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ clientOpId: crypto.randomUUID(), module: 'other', startedAt: new Date().toISOString(), durationMs: 60000 }),
      }),
  },
];

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function run(s, concurrency) {
  const lat = [];
  let errors = 0;
  const until = Date.now() + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < until) {
        const t = performance.now();
        try {
          const res = await s.req();
          await res.arrayBuffer();
          if (res.status >= 400) errors++;
        } catch {
          errors++;
        }
        lat.push(performance.now() - t);
      }
    }),
  );
  lat.sort((a, b) => a - b);
  return { n: lat.length, rps: Math.round(lat.length / SECONDS), p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), errors };
}

console.log(`| 接口 | 并发 | 请求数 | RPS | P50 ms | P95 ms | P99 ms | 错误 |`);
console.log(`|---|---|---|---|---|---|---|---|`);
for (const s of scenarios) {
  for (const c of [20, 50]) {
    const r = await run(s, c);
    console.log(`| ${s.name} | ${c} | ${r.n} | ${r.rps} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.errors} |`);
  }
}
