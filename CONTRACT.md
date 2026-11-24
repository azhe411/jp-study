# CONTRACT.md — 一駅 API 契约 v1.4.0（冻结）

> 机器可读定义：`openapi.yaml`；类型：`shared/types.ts`；枚举：`shared/constants.ts`。
> 三者冲突时以 **constants.ts > types.ts > openapi.yaml** 为准，并视为契约 bug 上报。
> 冻结后任何变更：先停下 → 列出变更 → 等确认 → 升 `CONTRACT_VERSION`。

---

## 1. 总体约定

| 项 | 约定 |
|---|---|
| 前缀 | `/api/v1`（Caddy 反代同域，前端用相对路径） |
| 编码 | 请求/响应均 `application/json; charset=utf-8` |
| 命名 | 字段、query 参数、枚举值全部 camelCase；错误码为 UPPER_SNAKE |
| 主键 | UUID v4。可同步实体允许客户端生成 `id`（离线创建必需）；内容库（场景、材料、汉字等）用稳定 slug 字符串 |
| 时间 | `IsoDateTime`：ISO 8601 带时区偏移。服务端输出一律 UTC `Z`；接受任意偏移输入 |
| 日期 | `IsoDate`：`YYYY-MM-DD`，按用户 `settings.timezone`（默认 `Asia/Shanghai`）解释 |
| 软删除 | 所有用户实体有 `deletedAt`；删除只置时间戳；**列表/详情默认过滤**，仅 `sync/pull` 与 `data/export` 返回已删除记录 |
| 版本 | 可变实体有 `version`（从 1 起，每次修改 +1），用于乐观锁与冲突检测 |
| 空值 | 可空字段返回 `null`，不省略；请求中省略 = 不修改（PATCH），显式 `null` = 清空 |

## 2. 后端框架选择：Fastify

- 原生 JSON Schema 校验 + 序列化，openapi 里的 schema 可直接复用为路由 schema，"所有接口有参数校验"几乎零成本；
- 性能约为 Express 2–3 倍，压测阶段更从容；
- 插件封装（`@fastify/jwt`、`@fastify/cookie`、`@fastify/rate-limit`）与 TypeScript 类型支持成熟；
- 生命周期钩子便于统一实现幂等、requestId、错误格式。

## 3. 鉴权

```
Authorization: Bearer <accessToken>
```

- **accessToken**：JWT（HS256），有效期 15 分钟，载荷 `{ sub: userId, sid: sessionId, iat, exp }`。前端只存内存（Zustand），不落 localStorage。
- **refreshToken**：随机 256-bit 不透明串，服务端仅存 SHA-256 哈希。web 端通过 cookie 下发：
  `jp_rt=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000`
  原生 App（`X-Client-Platform: android | desktop`）不用 cookie，改走请求/响应体，见 §12.2。
- **轮换**：每次 `/auth/refresh` 作废旧 token、签发新 token。检测到已作废 token 被复用 → 吊销该会话族全部 token，返回 `401 REFRESH_TOKEN_INVALID`。
- **前端刷新策略**：收到 `401 TOKEN_EXPIRED` → 单飞（single-flight）调用 refresh → 重放原请求一次；refresh 也失败 → 跳登录页。启动时先调 refresh 拿 accessToken。
- 密码：argon2id（m=19456 KiB, t=2, p=1）。登录失败统一返回 `INVALID_CREDENTIALS`，不区分"用户不存在/密码错"。
- 限流：`/auth/login`、`/auth/register` 每 IP 10 次/分钟；`/ai/*` 每用户 30 次/分钟。

## 4. 统一错误响应

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "请求参数不正确",
    "details": [{ "path": "/title", "message": "不能为空" }],
    "requestId": "req_01HF..."
  }
}
```

- `code` 取自 `ERROR_CODES`，HTTP 状态码与之一一对应（见 constants.ts）；
- `message` 是可直接展示给用户的中文；
- `requestId` 同时出现在响应头 `X-Request-Id`，日志按此关联；
- `details`：校验错误为 `ValidationIssue[]`；`VERSION_CONFLICT` 为 `{ serverVersion, serverRecord }`；
- **AI 错误**（`AI_UNAVAILABLE` / `AI_TIMEOUT` / `AI_BAD_OUTPUT`）的 `message` 必须是友好提示（如"AI 老师暂时走神了，请稍后再试"），绝不包含上游原始报错、key、prompt。

| 场景 | code | HTTP |
|---|---|---|
| 字段校验失败 | VALIDATION_FAILED | 400 |
| JSON 解析失败 | INVALID_JSON | 400 |
| 无/坏 token | UNAUTHORIZED | 401 |
| access 过期 | TOKEN_EXPIRED | 401 |
| refresh 无效/复用 | REFRESH_TOKEN_INVALID | 401 |
| 登录失败 | INVALID_CREDENTIALS | 401 |
| 无权操作（如删内置句） | FORBIDDEN | 403 |
| 不存在或已软删除 | NOT_FOUND | 404 |
| 邮箱已注册 | EMAIL_TAKEN | 409 |
| baseVersion 不符 | VERSION_CONFLICT | 409 |
| 同步游标过期 | SYNC_CURSOR_EXPIRED | 410 |
| 请求体过大 | PAYLOAD_TOO_LARGE | 413 |
| clientOpId 复用但请求体不同 | IDEMPOTENCY_KEY_REUSED | 422 |
| 业务不可处理（如向已结束对话发消息、词汇测试过期） | UNPROCESSABLE | 422 |
| 限流 | RATE_LIMITED | 429 |
| AI 返回无法解析 | AI_BAD_OUTPUT | 502 |
| AI 不可用/未配置 | AI_UNAVAILABLE | 503 |
| AI 超时（默认 30s） | AI_TIMEOUT | 504 |

## 5. 分页：游标分页

**选择理由**：学习记录是持续追加、多端并发写入的；offset 分页在新增/删除时会跳项或重复，而游标基于 `(排序键, id)` 的稳定位置，翻页结果一致，且与同步的 `rev` 游标思路统一；大表上也无 `OFFSET N` 的线性扫描成本。

- 请求：`?cursor=<opaque>&limit=20`（默认 20，最大 100，个别内容库接口另注）
- 响应：`{ "items": [...], "nextCursor": "eyJr..." | null }`
- 游标为 base64url(JSON `{k: 排序键值, id}`)，**客户端必须视为不透明**；
- 默认排序：用户数据按 `createdAt DESC, id DESC`；任务按 `date ASC, sortOrder ASC`；消息按 `createdAt ASC`；错题可选 `sort`；
- 改变过滤条件后必须丢弃旧游标从头取。

## 6. 幂等：clientOpId

- **所有写操作**（POST/PUT/PATCH/DELETE）都必须带 `clientOpId`（UUID v4）：
  - 有请求体：放在请求体 `clientOpId` 字段；
  - DELETE：放在 query `?clientOpId=...`；
  - `sync/push`：每条 op 各自带 `clientOpId`。
- 例外（无副作用的"计算型 POST"）：`/auth/*`、`/ai/lookup`、`/listening/dictation` 不需要。
- 服务端存 `(userId, clientOpId) → (请求体哈希, HTTP 状态, 响应体)`，保留 30 天：
  - 同键同体 → 直接重放原响应，加响应头 `Idempotent-Replayed: true`，不重复执行；
  - 同键异体 → `422 IDEMPOTENCY_KEY_REUSED`；
  - 原请求仍在处理中（并发重试）→ 等待其完成后重放（行锁）。
- 客户端规则：**同一用户意图的重试必须复用同一 clientOpId**；新意图（如冲突后"保留本地"重推）必须生成新 clientOpId。
- REST 写与 `sync/push` 共享同一幂等表——同一 clientOpId 先走 REST 失败后转入 outbox 推送，也不会重复。
- AI 写操作（`messages` 发送、`writing/submit`、`quiz/check`、`mistakes/{id}/retry`）同样受保护，网络抖动重试不会重复扣 AI 额度。

## 7. 乐观锁与冲突

- 可变实体的 PATCH/PUT/DELETE 可带 `baseVersion`：
  - 不带 → 后写覆盖（仅用于在线、单端场景）；
  - 带且 `≠ 当前 version` → `409 VERSION_CONFLICT`，`details.serverRecord` 为当前服务端记录。
- **outbox 推送的 update/delete 必须带 baseVersion**。
- 只追加实体（`APPEND_ONLY_ENTITIES`：各类 attempt、reviewLog、timeLog）永不冲突。
- 抽认卡排期由服务端根据 reviewLog 计算：离线多端复习同一张卡时，服务端按 `reviewedAt` 顺序回放 FSRS，**复习本身不冲突**；只有卡片内容（front/back 等）的编辑会冲突。

## 8. 同步协议

### 8.1 数据模型

- 每个用户有单调递增的 `rev`（bigint 序列）。任何可同步实体被创建/修改/软删除时（无论经 REST 还是 push），其行的 `rev` 更新为新值。
- `sync/pull` 按 `rev` 升序返回变化；游标 = 不透明编码的最后一个 rev。
- 软删除记录（墓碑）保留 90 天后物理清理；游标早于清理水位 → `410 SYNC_CURSOR_EXPIRED`，客户端清空本地缓存并以空游标全量重拉。

### 8.2 `POST /sync/push`

```json
// 请求
{
  "deviceId": "android-chrome-7f3a",
  "ops": [
    { "clientOpId": "uuid", "entity": "task", "action": "update", "id": "uuid",
      "baseVersion": 3, "data": { "status": "done" }, "clientTimestamp": "2026-10-28T08:01:00+08:00" },
    { "clientOpId": "uuid", "entity": "reviewLog", "action": "create", "id": "uuid",
      "data": { "cardId": "uuid", "rating": 3, "reviewedAt": "...", "durationMs": 5400 },
      "clientTimestamp": "..." }
  ]
}
// 响应（总是 200，逐条结果，顺序与 ops 一致）
{
  "results": [
    { "clientOpId": "...", "entity": "task", "id": "...", "status": "applied", "version": 4, "record": { ... } },
    { "clientOpId": "...", "entity": "reviewLog", "id": "...", "status": "duplicate", "version": 1, "record": { ... } }
  ],
  "serverTime": "2026-10-28T00:02:30Z"
}
```

- 每批 ≤ 200 条，按数组顺序处理；每条独立事务，单条失败不回滚其他条。
- `data` 与对应 REST 请求体同构（去掉 `clientOpId`/`baseVersion`）；`create` 为完整对象，`update` 为变更字段，`delete` 无 data。
- `settings` 的 `id` 固定为用户 id，action 只能是 `update`。
- 结果状态：

| status | 含义 | 客户端动作 |
|---|---|---|
| `applied` | 已执行 | 用 `record` 覆盖本地，删除 outbox 项 |
| `duplicate` | 该 clientOpId 已处理过 | 同 applied（`record` 为当时结果） |
| `conflict` | baseVersion 不符 | 保留 outbox 项标记为冲突，弹冲突 UI，展示 `serverRecord` |
| `rejected` | 校验失败/不存在/不允许（如对只追加实体 update） | 删除 outbox 项，提示 `error.message` |

- 服务端会补全计算字段（如 attempt 的 `scores`、`diff`），以 `record` 为准。

### 8.3 冲突解决（前端）

- **保留服务端**：丢弃本地修改与 outbox 项，本地写入 `serverRecord`。
- **保留本地**：以 `serverRecord.version` 为 `baseVersion`、**新 clientOpId** 重新入 outbox 推送（若期间又变，会再次冲突）。
- 同一实体的多条待推 update 在入 outbox 时合并（字段级 last-write），减少冲突面。

### 8.4 `GET /sync/pull?cursor=&limit=500`

```json
{
  "changes": [
    { "entity": "task", "id": "...", "rev": 1024, "version": 4,
      "updatedAt": "...", "deletedAt": null, "data": { ...完整 Task... } }
  ],
  "nextCursor": "MTAyNA",
  "hasMore": false,
  "serverTime": "..."
}
```

- `cursor` 为空 = 全量；`hasMore=true` 时客户端应立即继续拉；
- `deletedAt` 非空 → 本地删除该记录；
- 内容库（场景、材料、汉字、发音对、敬语惯用语条目）不走同步，由 Service Worker 缓存 GET 响应。
- **v1.2.0**：`dayPlan`（`DayPlan`：某天实际采用的档位）随 pull 下发，但**不在** `PUSHABLE_ENTITIES` 里，push 它会被 `rejected`。它只由 `GET /tasks/today`（当天首次访问时按 `settings.weekPlan` 写入）和 `POST /tasks/generate`（改写）产生；每人每天至多一条，不会被删除。

### 8.5 客户端启动顺序（验收要求）

1. 从 IndexedDB 读本地游标与缓存，先渲染骨架；
2. refresh 拿 accessToken，按结果分三路（v1.2.0）：
   - **成功** → 继续第 3 步；
   - **明确失效**（401，即 `REFRESH_TOKEN_INVALID` 等鉴权类错误；App 端安全存储里根本没有 refresh token 也算）→ 清空会话，进登录页；
   - **网络不可达**（拿不到 HTTP 响应：断网、DNS 失败、超时）或 **5xx** → 若本地有用户快照（上次登录成功时保存的 `UserPublic`，非敏感，可放 IndexedDB），进入**离线模式**：读写只走 IndexedDB + outbox，`ONLINE_ONLY_OPERATIONS` 置灰；没有快照才进登录页。离线模式下在 `online` 事件、页面可见、每 60 秒重试 refresh，成功后从第 3 步继续；
   - 网络错误**绝不**清空本地会话或安全存储里的 refresh token；
3. **先 push outbox**（避免 pull 回来的旧值覆盖本地未推修改），处理冲突；
4. `pull` 增量直到 `hasMore=false`，写入 IndexedDB；
5. 渲染业务数据；之后在 `online` 事件、页面可见、每 60 秒触发 push→pull。

### 8.6 离线策略

- 所有 `PUSHABLE_ENTITIES` 的写：先写 IndexedDB 实体表 + outbox（含 clientOpId）→ 乐观更新 UI → 在线时 push。
- `ONLINE_ONLY_OPERATIONS`（AI 相关、词汇测试、导入导出，以及 v1.2.0 起明确列入的切换档位 `tasks.generate`）离线时 UI 置灰并提示，不进 outbox。写作可离线存草稿（`writingEntry` status=draft），提交批改需在线。
- 当日档位（v1.2.0）：本地有该日的 `dayPlan` 就用它；没有就按 `settings.weekPlan` 推断并标记为"推断"，联网后以服务端为准。

## 9. 各模块约定要点

| 模块 | 要点 |
|---|---|
| 今日任务 | `GET /tasks/today` 首次访问按 `settings.weekPlan[weekday]` 档位 + 启用模板生成当日任务；`POST /tasks/generate` 切换档位；周计划用 `GET /tasks?from=&to=` |
| 抽认卡 | FSRS（ts-fsrs，FSRS-5 参数），评分 1–4；`desiredRetention` 来自设置；`/cards/due` 受 `newCardsPerDay`/`reviewLimitPerDay` 约束；导入 JSON 单次 ≤ 2000 张，`deck+front` 判重 |
| AI 查询 | 解释 + 3 例句 + 3 道四选一；**正确答案不下发**，存服务端 72 小时，用 `quiz/check` 判分；答错自动入错题本；同 type+query 结果缓存 |
| 场景对话 | 9 大类 × ≥8 场景（内容库 seed）；每条用户消息返回 `feedback`（纠错、更自然说法、语体提示、分数）；`PATCH status=finished` 由 AI 打综合分；`score ≥ 80` 视为掌握 |
| 错题本 | 同 question+correctAnswer 去重累计 `errorCount`；`sort=errorCountDesc` 按错误次数排序；`retry` 生成变式题 |
| 跟读/朗读 | 识别在浏览器（Web Speech API, `ja-JP`）完成，上送 transcript；服务端做假名归一化后的字符级对齐，计算 accuracy/completeness，fluency 由时长与参考语速启发式估算；不支持识别时 `method=selfAssessed` 自评或 `textCompare`，**不报错** |
| 听力 | 材料可无音频（`audioUrl=null` → 浏览器 TTS 朗读）；模式：盲听/字幕/精听/听写；听写差异以 `DiffSegment[]` 标注 |
| 写作 | AI 批改结构化输出 `{ score, corrections[], feedback, revisedText }`，服务端 JSON Schema 校验 AI 输出，失败重试 1 次，仍失败 → `AI_BAD_OUTPUT` 且条目 `status=failed` |
| 阅读 | 记录用时、字数，算 `charsPerMinute`；生词入卡走 `POST /cards`（source=reading） |
| 发音 | 最小对立对（长音/促音/拨音/浊音/拗音/音高）；listen 听辨 + speak 开口两种模式 |
| 敬语/惯用语 | 统一 `/expressions`，`type=keigo|idiom` 区分 |
| 词汇量 | 按词频分段抽样 60 题（含假词检测），估算词汇量与 JLPT 等级；测试会话 60 分钟过期 |
| 统计 | 时长来源 = `timeLog`（前端各模块计时上报）；JLPT 模拟分为手动录入外部模考成绩 |
| 课程 | B 站等外链 + 进度记录，不嵌入视频 |

## 10. 相对需求清单的补充接口（请确认）

以下为实现功能所必需、但需求"必须覆盖的接口"未列出的接口，已纳入契约：

1. `POST /tasks/generate` —— 切换最小日/标准日/冲刺日；
2. `GET /cards/decks`、`POST /cards`、`PATCH/DELETE /cards/{id}` —— deck 筛选、阅读生词入卡、卡片编辑；
3. `GET /scenarios/{id}`、`GET/PATCH/DELETE /conversations/{id}` —— 场景详情、结束对话评分（场景掌握度依赖）；
4. `DELETE /mistakes/{id}`；`GET /phrases/{id}/attempts`；
5. `GET /listening/materials/{id}`、`GET /reading/materials/{id}`、`GET /writing/entries/{id}`；
6. `POST /stats/time-logs` —— "各模块时长"的数据源；
7. `GET/POST/DELETE /stats/jlpt-mocks` —— "JLPT 模拟分趋势"的数据源；
8. `/courses` CRUD —— "B 站课程只放外链和进度记录"；
9. `GET /data/backup-status` —— 设置页"备份状态"；
10. `GET /health` —— 健康检查。

## 11. 安全与运维约定

- DeepSeek key 只在服务端环境变量 `DEEPSEEK_API_KEY`；日志对 `authorization`、`cookie`、`password`、`*Key`、`*Token` 字段脱敏；AI 请求/响应只记录耗时、token 数、状态码。
- `.env` 不入 Git，仓库只提交 `.env.example`。
- 请求体上限：默认 1MB；`/cards/import` 5MB；`/data/import` 20MB。
- CORS：web 同域部署，无需跨域；原生 App 的页面来源按 §12.3 放行（不带凭据）；开发环境 Vite 代理 `/api`。

## 12. 原生 App 支持（v1.1.0 新增）

客户端形态：**安卓 APK = Capacitor**，**Windows 桌面程序 = Tauri 2**，**网页 / PWA 保留**。三端共用同一份 React 代码，后端不区分业务逻辑，只在鉴权交付方式与 CORS 上有差别。

### 12.1 平台声明

- 请求头 `X-Client-Platform: web | android | desktop`（`CLIENT_PLATFORMS`），缺省视为 `web`。
- App 端的 API 客户端对**所有请求**统一注入该头；网页端可以不带。
- 页面来源：Capacitor（`androidScheme: 'https'`）为 `https://localhost`；Tauri 在 Windows 上为 `http://tauri.localhost` / `https://tauri.localhost`。
- App 内的 API 基址为绝对地址 `https://jpd.azclient.top:8443/api/v1`（构建时以 `VITE_API_ORIGIN` 注入来源部分）；网页端仍用相对路径 `/api/v1`。
- 后端有两个入口，接口完全相同：`jp.azclient.top`（经 Cloudflare，海外访问）与 `jpd.azclient.top:8443`（直连香港，不经 Cloudflare，国内访问）。两个入口的 CORS、鉴权、限流规则一致；直连入口会丢弃客户端自带的 `CF-Connecting-IP` 头。

### 12.2 refresh token 交付方式

| 平台 | 登录 / 注册 / 刷新时如何下发 | 刷新 / 注销时如何提交 | 客户端存放位置 |
|---|---|---|---|
| `web` | `Set-Cookie: jp_rt=…`（与 v1.0.0 相同），响应体不含 refreshToken | cookie 自动携带 | 浏览器 httpOnly cookie，脚本不可读 |
| `android` / `desktop`（`BODY_TOKEN_PLATFORMS`） | 响应体 `refreshToken` + `refreshExpiresIn`，**不设 cookie** | 请求体 `{ "refreshToken": "…" }`（`RefreshRequest`） | 系统安全存储：安卓 Keystore（经 Capacitor 安全存储插件）；Windows 凭据管理器（经 Tauri 插件） |

- 服务端读取顺序：请求体 `refreshToken` 优先，其次 cookie。
- 轮换、会话族（family）、盗用检测、"轮换作废 10 秒内宽限"等规则与 §3 完全相同。
- **每次刷新都会轮换**：App 必须用响应里的新 `refreshToken` 覆盖保存；写入安全存储失败时视为登出。
- accessToken 依旧只放内存，不落盘。
- 注销：App 在请求体带上 refreshToken，服务端吊销后返回 204；随后 App 清空安全存储。

### 12.3 CORS

- 放行来源：`APP_ORIGINS`（constants.ts），可用环境变量 `CORS_ORIGINS`（逗号分隔）覆盖。网页端同源，不涉及 CORS。
- **不设置** `Access-Control-Allow-Credentials`：跨源请求永远不带 cookie，鉴权只靠 `Authorization` 头。这些来源拿不到任何"自动附带"的凭据，放行它们不会扩大 CSRF 面。
- 允许的方法：`GET, POST, PUT, PATCH, DELETE, OPTIONS`；允许的请求头：`authorization, content-type, x-client-platform`；暴露的响应头：`X-Request-Id, Idempotent-Replayed`；预检缓存 600 秒。
- 不在放行列表里的来源：预检不返回 CORS 头，由浏览器拦截；服务端不额外报错。

### 12.4 语音

- `RecognitionMethod` 新增 `nativeSpeech`：原生壳调用系统语音识别（安卓 `SpeechRecognizer`，语言 `ja-JP`），把识别文本作为 `transcript` 上送。服务端的评分算法与 `webSpeech` 相同，统计时不区分识别方式。
- 朗读（TTS）：App 端优先用原生 TTS（安卓 `TextToSpeech`），不可用时降级为 WebView 的 `speechSynthesis`，再不行就降级为文字对照。
- 桌面端（WebView2）暂无原生识别方案：识别走 `selfAssessed` / `textCompare` 降级，与浏览器不支持时的处理一致。朗读使用 `speechSynthesis`，需要 Windows 已安装日语语音包。
- 降级时一律不报错，界面只提示"当前设备不支持语音识别，已切换为文字对照"。

### 12.5 兼容性

- 对 v1.0.0 的网页客户端**完全向后兼容**：不带 `X-Client-Platform` 的请求，行为与 v1.0.0 逐字节一致。
- `nativeSpeech` 是新增的枚举值：旧客户端不会发送，服务端照常接受。
- 其余接口、错误码、分页、幂等、同步协议均不变。

## 13. 最低客户端版本（v1.2.0 新增）

- `GET /health` 的响应新增可选字段 `minClientVersion`（semver），取自服务端环境变量 `MIN_CLIENT_VERSION`；未设置时不返回该字段。
- 客户端把自身版本（构建时注入，与安装包版本一致）与之比较。低于它时：App 端常驻提示"当前版本过旧，请安装新版"，但不阻止离线使用；网页端提示刷新页面。
- 运维约定：只有在做了不兼容旧客户端的变更时才调高 `MIN_CLIENT_VERSION`，并且要先把新安装包发到所有设备。

## 14. 学习计划与课程体系（v1.3.0 新增）

### 14.1 学习计划

- 每个用户至多一份 `StudyPlan`（可同步实体 `studyPlan`，**不可 push**：保存需在线，服务端会校验并重算）。
- `POST /plan/preview`（无副作用，不需 clientOpId）：按 `StudyPlanInput` 估算可行性，返回 `PlanPreview`。
- `GET /plan` → `StudyPlan`，没有时 404；`PUT /plan`（`PutStudyPlanRequest`，带 baseVersion 乐观锁）创建或更新，`startDate` 由服务端在首次创建时按用户时区写入。
- `GET /plan/today` → `PlanToday`：下一站、落后站数、预计到站日、今天是否已学（客户端据此安排或取消晚间提醒）。
- 估算口径（v1.10.0 起见 §25）：按每课的总学习量；可用学时 = 剩余天数 × `dailyMinutes`。`behindBy` = 按学习量匀速推算今天应到站数 − 实际到站数。

### 14.2 课程体系

- 课程体系是代码里的内容库，按区段 `CurriculumPart`：guide（入门）→ kana（假名与发音）→ N5 → N4 → N3 → N2 → N1，每一课是一站，按 `order` 排成一条线路。
- 新标日初级第 1–24 课对应 N5、25–48 课对应 N4、中级第 1–21 课对应 N3；每课可挂视频分集（`VideoRef`）。N2、N1 暂无视频。
- `GET /curriculum?part=` → `{ items: LessonSummary[] }`（不分页，带当前用户的 `status` 与 `bestScore`）。第一站永远 available；上一站 passed 后下一站解锁（起点不是零基础的，起点之前的站一律视为可学）。
- `GET /lessons/{id}` → `Lesson`。讲解、例句、生词、常见错误由内容库或 AI 生成（生成后服务端缓存，所有用户共享）；每次请求都新开一份过关小测（复用 `quizzes`，72 小时有效）。锁定的课 → 403。
- 判分：先 `POST /ai/quiz/check`，再 `POST /lessons/{id}/complete`（`CompleteLessonRequest`）；服务端按该测验的作答记录计分，≥ `LESSON_PASS_RATE` 即 passed。首次过关时本课生词自动加入抽认卡（牌组"课程"，按 deck+front 去重）。

## 15. 视频课程（v1.3.0 新增）

- 视频课程是内容库，目前一门：B 站多 P 合集（新标日 0 到中级）。`GET /video-courses` → `{ items: VideoCourseSummary[] }`；`GET /video-courses/{id}` → `VideoCourse`（含每集进度）。
- 播放走 B 站官方外链播放器（`player.bilibili.com`，iframe）；不下载、不转存视频。播放器是跨源页面，客户端读不到真实播放位置：`positionSec` 是客户端按"页面可见且在播放区"累计的**估算值**，续播用外链播放器的起始时间参数，用户可手动校正。
- `PUT /video-progress/{courseId}/{page}`（`PutVideoProgressRequest`）记录进度，可离线（`videoProgress` 可 push）。同一集多次上报取 positionSec 较大者；completed 一旦为 true 不回退（除非显式传 false）。

## 16. 应用更新（v1.3.0 新增）

- `GET /app/manifest`（无需登录）→ `AppManifest`：界面包（热更新 zip，含 sha256）、安卓 APK、Windows 版本说明。
- `GET /app/files/{name}`（无需登录）：下载更新文件（zip / apk / Windows 安装包与签名），文件名只允许 `[A-Za-z0-9._-]`。
- `GET /app/desktop/{target}/{arch}/{currentVersion}`（无需登录）：Tauri 更新器协议；有新版本返回 `{ version, notes, pub_date, platforms: { "<target>-<arch>": { signature, url } } }`，否则 204。
- 安卓界面热更新只替换 Web 资源，原生部分（插件、权限）变化时提示下载新 APK；Windows 更新包用私钥签名，公钥写在程序里，签名不符拒绝安装。

## 17. 用户自带 AI Key（v1.4.0 新增）

- 每个用户可以保存自己的 DeepSeek API Key。服务端用 AES-256-GCM 加密后入库（密钥来自环境变量 `AI_KEY_SECRET`），**Key 明文永不下发、永不写日志**，只返回末 4 位。
- `GET /me/ai-key` → `AiKeyStatus`；`PUT /me/ai-key`（`PutAiKeyRequest`）先用该 Key 调一次 DeepSeek 校验，无效返回 400 `VALIDATION_FAILED`；`DELETE /me/ai-key?clientOpId=` 删除自己的 Key（204）。
- 选 Key 的顺序：自己的 Key → 共享额度（用户被站长标记为可用服务器 Key）→ 都没有则 AI 类接口返回 **403 `AI_KEY_REQUIRED`**（中文提示引导去设置填写）。新注册用户默认没有共享额度。
- 课程讲义属于共享内容，始终用服务器 Key 生成，不消耗用户额度。

## 18. 朗读音频（v1.5.0 新增）

- 服务端用 edge-tts（默认声音 `ja-JP-NanamiNeural`，常量 `TTS_VOICE`）把日语文本生成 mp3，按内容寻址缓存在磁盘。
- 键 = `sha1(声音 + "|" + 规整后的文本)`；规整 = Unicode NFC → 连续空白压成一个空格 → 去首尾空白。客户端按同一算法可直接拼出地址。
- `GET /tts/{key}.mp3`：**无需登录**，`audio/mpeg`，`Cache-Control: public, max-age=31536000, immutable`；没生成过返回 404。
- `POST /tts`（需登录，`TtsRequest`，无需 `clientOpId`）：确保音频存在并返回 `TtsResult`（`key`、相对地址 `url`、`voice`）。文本须含假名或汉字、≤ 400 字（`TTS_MAX_CHARS`），否则 400；生成失败 503 `TTS_UNAVAILABLE`，客户端应退回系统朗读。限流 60 次/分钟。
- 内容库与课程讲义里的句子由运维脚本 `warmAudio` 预生成。

## 19. 学习闭环（v1.5.0 新增）

- **今日路线** `GET /route/today` → `DailyRoute`：复习一步 + 今天要学的每一课三步（看视频 → 本课练习 → 过关小测，课没有视频时省掉第一步）。每步的 `done` 由学习记录判断：到期卡与今日剩余新卡都清空 / 每集视频看到 85% 以上或标记看完 / 本课练习有成绩 / 本课已过关。今天已过关的课仍保留在路线上（显示完成）。
- **本课练习** `POST /lessons/{id}/practice`（`LessonPracticeRequest`：`correct ≤ total`）→ `LessonPracticeResult`；`lessonProgress` 新增 `practiceBest`（取最好成绩）与 `practicedAt`。题目由客户端从本课生词与例句生成。
- **预设抽认卡**：从计划起点到"第一个未过关的课 + `SEED_AHEAD`（1）"之间的每一课，把生词放进 `LESSON_DECK`（「课程」）牌组、假名课的假名放进 `KANA_DECK`（「五十音」），`source` 为新增的 `lesson`。每课只放一次（删掉的卡不会被放回），同牌组同正面不重复。触发时机：保存计划、过关、请求今日路线。`CompleteLessonResult.cardsAdded` 改为"本次新放进的卡数"（通常是下一课的词）。
- **按课的对话场景**：`scenarioId` 可取 `lesson:{课程id}`（入门课与假名课除外），由服务端按该课要点与例句拼出场景，`GET /scenarios/{id}`、`POST /conversations` 均可用。
- 旧版默认任务模板中与今日路线重复的三项（复习到期抽认卡、学习新卡、B 站课程 1 集）停用；新用户的默认模板只保留"加练"。

## 20. 学习教练（v1.5.0 新增）

- 不需要用户提问，服务端根据学习记录（计划进度、最近过关的课与分数、近 8 天学习时长、连续天数、抽认卡、未掌握错题、某课最近一次小测的错题）主动写小结与建议，返回 `CoachNote`。
- `GET /coach/daily`（今天）、`GET /coach/weekly`（本周，`ref` 为周一日期）、`GET /coach/lessons/{id}`（考过该课小测后才有，否则 422）。同一 (类型, ref) 只写一次并缓存。
- 有可用 AI Key 时由 AI 写（`source: "ai"`）；没有 Key 或 AI 暂时不可用时按规则写（`source: "rules"`），不会报 `AI_KEY_REQUIRED`；规则版在之后拿到 AI 时会被替换。
- `suggestions[].action` 取 `COACH_ACTIONS` 之一，客户端映射为页面跳转；`lessonId` 只会是存在的课程 id 或 null。
- `GET /coach/notes?limit=` 最近的小结；`POST /coach/notes/{id}/read` 标为已读。

## 21. 学习阶段与离线识别（v1.6.0 新增）

- **学习阶段** `GET /learn/stage` → `StageInfo`：`stage` 由当前所在的站决定（入门与假名课为 `kana`，之后为该课所属的 `N5`…`N1`，全部过关为 `done`，常量 `LEARNING_STAGES`）；`knownKana` 为已学到（含当前站）的假名；`sentences` 为已学过的课（含当前站）里的例句，最新的在前，≤ 24 句。客户端据此给练习取材、在初学阶段强制显示注音、标出"建议学到某阶段再练"的模块。
- **预设抽认卡只到当前站**：`SEED_AHEAD` 改为 0。此前多放的、还没学过一张的预设卡会在下次触发时收回（软删除），学到那一课再放。
- **新卡出卡顺序打乱**：`GET /cards/due` 的新卡按"卡片 id + 当天日期"的哈希排序（同一天顺序稳定），客户端再把整轮打乱。
- **离线识别**：`RecognitionMethod` 新增 `offlineSpeech`（App 内置的 Vosk 日语小模型）。该方式的准确度与完整度按 `1-(1-x)^1.6` 从宽计分（50→67、70→85，0 与 100 不变）。模型由 `GET /app/models/{name}` 公开下载（无需登录、永久缓存），当前为 `vosk-model-small-ja-0.22.tar.gz`（约 47 MB）。
- `GET /app/latest/{android|windows}`（无需登录）：按发布清单 302 跳到当前安装包，官网写死这个地址。
- `CreateSpeakingAttemptRequest` 新增可选 `referenceReading`（参考文本的假名读音），评分时与原文各对齐一次取高分。

## 22. 内容扩充与实时点评（v1.7.0 新增）

- **课程扩充内容**：`Lesson.vocab` 里的词可带 `example`（例句），`Lesson.sentences` 是讲解例句之外的更多句子。内容由服务器 Key 预生成，存在 `lesson_extras`，不消耗用户额度。入门课与假名课没有 `sentences`。
- **预设抽认卡**：普通课放全部生词（带例句）和前 `SENTENCE_CARDS_PER_LESSON`（10）句（牌组 `SENTENCE_DECK`「课程句子」）；假名卡带例词。已放过的课按版本补一次，用户删掉的不再补回。声调课不做卡。新卡仍按"每日新卡上限"放出。
- **今日路线**：牌组为空时没有 `review` 一步；已过关的课所有步骤都算完成；入门课没有练习，第二步是 `{id}:read`（`kind` 仍为 `practice`，`link` 指向课程页）。
- **内容库**：内置句库、听力、阅读大幅增加，`PHRASE_SEED_VERSION` 升到 3，老用户打开句库时补种。
- **实时点评** `GET /coach/live` → `CoachNote`（`kind: "live"`）：服务端读取用户全部学习记录（计划、课程、视频、抽认卡、错题、跟读、句库、听力、阅读、写作、发音、汉字、敬语、对话、词汇量测试、模考、各模块时长、今天做了什么）。按"学习数据指纹"判断是否需要更新：
  - 没有可用 AI Key：当场按规则重写，`source: "rules"`。
  - 有 Key：**从不让请求等 AI**。先返回现有内容（`refreshing: true`），后台重写，客户端过几秒再取。同一用户最多每 10 分钟调用一次 AI，失败后 5 分钟内不重试。

## 23. 国内下载镜像（v1.8.0 新增）

- 只有安装包和更新包的下载走国内服务器（裸 IP + 普通 http，未备案域名和 80/443 会被服务商拦截），其余一切仍走香港。服务端环境变量 `DOWNLOAD_BASE_URL` 控制，留空则全部走香港。
- `AppManifest.web.mirrorUrl`：热更新包的镜像地址。客户端只在安装包版本 ≥ `MIRROR_MIN_CLIENT_VERSION` 时使用，失败退回 `url`；完整性靠 `sha256`。
- `AppManifest.android.url`：配置镜像后指向镜像（由系统浏览器下载，任何版本都能用）。
- `/app/desktop/...`：`currentVersion` ≥ `MIRROR_MIN_CLIENT_VERSION` 才返回镜像地址（旧版更新器拒绝 http）；完整性靠 Tauri 签名。
- `/app/latest/{android|windows}`：默认 302 到镜像；`?via=hk` 走香港，供浏览器拦截 http 下载时备用。

## 24. 重新学习与可听的错题（v1.9.0 新增）

- `GET /cards/restudy` → `RestudyGroups`：按第一次学这张卡的日期（`days`，新的在前，最多 90 天）和按课（`lessons`）分组。`GET /cards/restudy/items?date=` 或 `?lessonId=`（二选一）→ `{items: Card[]}`，最多 500 张。都是只读，**不影响复习进度**。
- `QuizQuestion.audio`：错题重练里听力、发音类题目要朗读的日语。此时 `audio` 等于正确选项，且题干不含答案；服务端校验不过会让 AI 重写。其他类型的题没有 `audio`，也不会出现"听辨"。

## 25. 重学成绩、建议核验与学时校准（v1.10.0 新增）

- `POST /cards/restudy/rounds`（`RestudyRoundRequest`，要 `clientOpId`）→ 201 `RestudyRoundResult`：提交一轮重学，分数 = 第一次就记住的比例。不影响复习进度。`partial=true`（只练上一轮没记住的）不计入这一组的 `lastScore`，但每张卡的结果照常记录。
- `GET /cards/restudy` 增加 `days[].lastScore`、`lessons[].lastScore`、`hard {count, lastScore}`；`GET /cards/restudy/items` 增加 `hard=true`，`date`、`lessonId`、`hard` 三选一。
- "还没记牢的卡"：选过重来，且最后一次选重来之后，既没有在重学里第一次就记住，也没有隔至少一天复习评 Good 以上。
- `CoachNote.sections`：分段的详细分析。`CoachSuggestion.detail`：怎么做、做到什么算完成。均为可选字段，旧点评没有。
- `CoachSuggestion.restudy`（`hard` / `lesson` / `any`）：要去重新学习。此时 `action` 仍是 `review`，旧版客户端会进复习页而不会报错。
- `CoachSuggestion.status` / `result`（仅 `GET /coach/live`）：拿点评写成之后的学习记录核验。达标线：重学 70 分；错题重练正确率 70% 或标记掌握至少一道；朗读、听力、场景对话平均 60 分；复习要到期清零；练习做过一次；小测过关；看过视频；定好计划。
- **口径变更**：`PlanPreview.estimatedHours`、`minutesNeeded`、`projectedFinish`、`feasible` 改按总学习量计算（上课、背词、复习、听读、备考），零基础累计 N5 250、N4 450、N3 700、N2 1000、N1 1700 小时，按上课时长比例分到每课。`LessonSummary.minutes` 仍是单次上课时长。`behindBy` 改按学习量推算今天应到的站数。

## 26. 单词表与小测组成（v1.11.0 新增）

- `Lesson.wordList`（可选）：考试旁边的单词表。普通课同 `vocab`；假名课是每个假名的例词；声调课是对比词。
- 普通课的过关小测改为每次新组：从讲义题抽 5 道（题干写着答案的不考），再从单词表出 5 道（读音、词义、日语说法）。"重新做"会真的换题。题目结构和判分不变。

## 27. 安全加固（v1.12.0）

- `AppManifest.android.sha256`、`desktop.sha256`（可选，可为 null）：安装包校验值。官网 https 页面展示，供首次安装时核对。
- 每个来源每分钟总请求数上限 1200，超过返回 429 `RATE_LIMITED`；登录等接口的单独限制不变。
- 限速按 `CF-Connecting-IP` 识别来源时，只认来自 Cloudflare 的请求，其他来源带的这个头会被 Caddy 删掉。

## 28. 今日学习时长（v1.13.0）

- `PlanToday.minutesToday`（可选）：今天累计学习分钟数（用户时区）。客户端据此判断是否达到 `dailyMinutes`：没达到就照常发当天的提醒。旧客户端仍按 `studiedToday` 判断。

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0.0 | 2026-10-28 | 初版冻结 |
| 1.1.0 | 2026-10-29 | 原生 App 支持：新增 `X-Client-Platform` 头；android / desktop 的 refresh token 改走请求/响应体（`AuthResult.refreshToken`、`refreshExpiresIn`，新增 `RefreshRequest`）；CORS 放行 App 来源（不带凭据）；`RecognitionMethod` 新增 `nativeSpeech` |
| 1.13.0 | 2026-11-02 | 用户反馈：学了但没学够时长，提醒却不发（`PlanToday.minutesToday`，§28） |
| 1.12.0 | 2026-11-01 | 安全测试报告的修复：安装包校验值（§27）、全局限速 |
| 1.11.0 | 2026-10-31 | 用户要求：单词表 `Lesson.wordList`；小测每次新组（§26） |
| 1.10.0 | 2026-10-31 | 用户要求：重学成绩（§25）；主页建议核验（`CoachSuggestion.status/result/detail/restudy`）、详细分析（`CoachNote.sections`）；**学习计划学时口径变更**，N2 约 1000 小时 |
| 1.9.0 | 2026-10-30 | 用户要求：重新学习（`/cards/restudy`、`/cards/restudy/items`、`RestudyGroups`）；`QuizQuestion.audio`；均为新增，向后兼容（§24） |
| 1.8.0 | 2026-10-30 | 用户要求：安装包与更新包改走国内服务器（§23）；`AppManifest.web.mirrorUrl`、`/app/latest?via=hk`、常量 `MIRROR_MIN_CLIENT_VERSION`；均为新增，向后兼容 |
| 1.7.0 | 2026-10-30 | 用户要求：课程扩充内容（`Lesson.sentences`、`vocab[].example`）、句子卡牌组（`SENTENCE_DECK`）、今日路线规则调整、`GET /coach/live` 实时点评（`COACH_KINDS` 加 `live`、`CoachNote.refreshing`）；均为新增或放宽，向后兼容（§22） |
| 1.6.0 | 2026-10-30 | 用户要求调整：学习阶段（`/learn/stage`、`StageInfo`、常量 `LEARNING_STAGES`）；预设卡只到当前站（`SEED_AHEAD`=0）；新卡出卡顺序打乱；`RecognitionMethod` 加 `offlineSpeech` 并从宽计分；离线识别模型下载 `/app/models/{name}`；`CreateSpeakingAttemptRequest.referenceReading`；均为新增或放宽，向后兼容（§21） |
| 1.5.0 | 2026-10-29 | 用户要求新增：朗读音频（`/tts`、`/tts/{key}.mp3`、`TtsRequest`/`TtsResult`、常量 `TTS_VOICE`/`TTS_MAX_CHARS`、错误码 `TTS_UNAVAILABLE` 503）；学习闭环（`/route/today`、`/lessons/{id}/practice`、`lessonProgress.practiceBest/practicedAt`、预设抽认卡、`CardSource` 加 `lesson`、`lesson:{id}` 对话场景）；学习教练（`/coach/*`、`CoachNote`）；`ONLINE_ONLY_OPERATIONS` 加 `lessons.practice`、`tts.create`、`coach.read`；均为新增，向后兼容（§18–§20） |
| 1.4.0 | 2026-10-29 | 用户要求新增：用户自带 AI Key（`/me/ai-key` GET/PUT/DELETE、`AiKeyStatus`、`PutAiKeyRequest`、常量 `AI_KEY_SOURCES`）；新错误码 `AI_KEY_REQUIRED`（403）；全部新增（§17） |
| 1.3.0 | 2026-10-29 | 用户确认新增：学习计划（`studyPlan`、`/plan*`）、课程体系（`/curriculum`、`/lessons/{id}`、`lessonProgress`）、视频课程与观看进度（`/video-courses*`、`/video-progress`、`videoProgress` 可 push）、应用更新（`/app/manifest`、`/app/files`、`/app/desktop`）；`STUDY_MODULES` 加 `kana`、`lesson`；新增常量 `STUDY_GOALS`、`START_LEVELS`、`CURRICULUM_PARTS`、`LESSON_*`；全部为新增，向后兼容（§14–§16） |
| 1.2.0 | 2026-10-29 | 来自 CONTRACT_REVIEW A1–A3，全部向后兼容：新增只读同步实体 `dayPlan`（`DayPlan`，§8.4、§8.6）；`ONLINE_ONLY_OPERATIONS` 明确列入 `tasks.generate`；§8.5 第 2 步区分"鉴权失效"与"网络不可达"，后者进入离线模式；`HealthResponse` 新增可选 `minClientVersion`（§13） |
| 1.1.0（文档） | 2026-10-29 | 仅部署说明，接口不变：新增国内直连入口 `jpd.azclient.top:8443`，App 的 API 基址改为该入口（§12.1）；更正环境变量名为 `VITE_API_ORIGIN` |
