#!/usr/bin/env bash
# curl 验收：认证 / me / 设置 / 健康 / 任务 / 模板 / 抽认卡 / 复习 / 统计 / 幂等 / 冲突 / 错误格式
# v1.1.0 起另含：原生 App 的 refresh token 走请求/响应体、CORS
# 阶段 5 起另含：听力/阅读/发音/敬语/汉字/词汇测试/课程、sync push·pull、导入导出、统计；SMOKE_AI=1 另测写作批改
# 阶段 4 起另含：错题本、句库与跟读、朗读/影子跟读、场景；SMOKE_AI=1 时再真实调用 AI（查询、判分、重出、对话）
# 用法：BASE=http://127.0.0.1:3100/api/v1 smoke.sh
# 依赖：curl、jq。每次运行注册一个新的随机测试账号（需 ALLOW_REGISTER=true）。
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3100/api/v1}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
TOKEN=""; RT=""
EXTRA=()   # 额外请求头，如 (-H "x-client-platform: android")

uuid() { cat /proc/sys/kernel/random/uuid; }

# req METHOD PATH [JSON]  → $STATUS / $BODY / $HDRS
req() {
  local method="$1" path="$2" data="${3:-}"
  local args=(-s -X "$method" -D "$TMP/h" -o "$TMP/b" -w '%{http_code}' "$BASE$path")
  [ -n "$TOKEN" ] && args+=(-H "authorization: Bearer $TOKEN")
  [ -n "$RT" ] && args+=(-H "cookie: jp_rt=$RT")
  # 请求体走文件：导出数据可能很大，放命令行参数会超过系统长度限制
  if [ -n "$data" ]; then printf '%s' "$data" > "$TMP/req"; args+=(-H 'content-type: application/json' --data-binary "@$TMP/req"); fi
  [ "${#EXTRA[@]}" -gt 0 ] && args+=("${EXTRA[@]}")
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$TMP/b")"
  HDRS="$(tr -d '\r' < "$TMP/h")"
  local c; c="$(printf '%s\n' "$HDRS" | sed -n 's/^[Ss]et-[Cc]ookie: jp_rt=\([^;]*\).*/\1/p' | tail -1)"
  [ -n "$c" ] && RT="$c"
  return 0
}
j() { printf '%s' "$BODY" | jq -r "$1"; }
check() {
  local name="$1"; shift
  if "$@"; then PASS=$((PASS + 1)); printf '  \033[32m✔\033[0m %s\n' "$name"
  else FAIL=$((FAIL + 1)); printf '  \033[31m✘\033[0m %s  (status=%s body=%s)\n' "$name" "$STATUS" "$(printf '%s' "$BODY" | head -c 300)"; fi
}
is() { [ "$STATUS" = "$1" ]; }
eq() { [ "$(j "$1")" = "$2" ]; }

echo "== system"
req GET /health
check "health 200 + db ok" eval 'is 200 && eq .db ok && eq .contractVersion 1.13.0'
req GET /nope
check "未知路由 404 + 统一错误结构" eval 'is 404 && eq .error.code NOT_FOUND && [ "$(j .error.requestId)" != null ]'
check "响应头带 X-Request-Id" eval 'printf "%s" "$HDRS" | grep -qi "^x-request-id: req_"'

echo "== auth"
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
req POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"short\",\"displayName\":\"x\"}"
check "注册：密码过短 400 + 字段明细" eval 'is 400 && eq .error.code VALIDATION_FAILED && eq ".error.details[0].path" /password'
req POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"smoke-pass-123\",\"displayName\":\"冒烟测试\"}"
check "注册 201 + accessToken + refresh cookie" eval 'is 201 && [ -n "$(j .accessToken)" ] && [ -n "$RT" ]'
check "web 注册：响应体不含 refreshToken" eval 'eq .refreshToken null'
check "refresh cookie 属性 HttpOnly/SameSite=Strict/Path" eval 'printf "%s" "$HDRS" | grep -i "^set-cookie: jp_rt=" | grep -qi "httponly" && printf "%s" "$HDRS" | grep -i "^set-cookie: jp_rt=" | grep -qi "samesite=strict" && printf "%s" "$HDRS" | grep -i "^set-cookie: jp_rt=" | grep -qi "path=/api/v1/auth"'
req POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"smoke-pass-123\",\"displayName\":\"again\"}"
check "重复注册 409 EMAIL_TAKEN" eval 'is 409 && eq .error.code EMAIL_TAKEN'
RT=""
req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}"
check "错误密码 401 INVALID_CREDENTIALS" eval 'is 401 && eq .error.code INVALID_CREDENTIALS'
req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"smoke-pass-123\",\"deviceId\":\"smoke\"}"
check "登录 200" eval 'is 200 && [ -n "$(j .accessToken)" ]'
TOKEN="$(j .accessToken)"

SAVE="$TOKEN"; TOKEN=""
req GET /me
check "无 token 访问 /me → 401 UNAUTHORIZED" eval 'is 401 && eq .error.code UNAUTHORIZED'
TOKEN="garbage.token.value"
req GET /me
check "伪造 token → 401 UNAUTHORIZED" eval 'is 401 && eq .error.code UNAUTHORIZED'
TOKEN="$SAVE"
req GET /me
check "/me 200 + email 正确 + serverTime" eval 'is 200 && eq .user.email "$EMAIL" && [ "$(j .serverTime)" != null ]'

OLD_RT="$RT"
req POST /auth/refresh
check "refresh 200 + 轮换出新 cookie" eval 'is 200 && [ "$RT" != "$OLD_RT" ]'
TOKEN="$(j .accessToken)"; NEW_RT="$RT"

echo "== settings"
req GET /settings
check "设置默认值 + version" eval 'is 200 && eq .data.timezone Asia/Shanghai && [ "$(j .version)" -ge 1 ]'
SV="$(j .version)"; DATA="$(j '.data | .newCardsPerDay = 5')"
req PUT /settings "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":$SV,\"data\":$DATA}"
check "PUT 设置 200 + version+1" eval 'is 200 && eq .data.newCardsPerDay 5 && eq .version $((SV + 1))'
req PUT /settings "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":$SV,\"data\":$DATA}"
check "旧 baseVersion → 409 VERSION_CONFLICT + serverRecord" eval 'is 409 && eq .error.code VERSION_CONFLICT && eq .error.details.serverVersion $((SV + 1))'
BAD="$(printf '%s' "$DATA" | jq -c '.timezone = "Mars/Olympus"')"
req PUT /settings "{\"clientOpId\":\"$(uuid)\",\"data\":$BAD}"
check "非法时区 400" eval 'is 400 && eq .error.code VALIDATION_FAILED'

echo "== tasks / templates"
req GET /task-templates
check "新用户自带起步模板" eval 'is 200 && [ "$(j ".items | length")" -ge 5 ]'
req GET /tasks/today
check "today 首次自动生成" eval 'is 200 && eq .generated true && [ "$(j ".tasks | length")" -ge 1 ]'
TODAY="$(j .date)"
req GET /tasks/today
check "today 再次访问不重复生成" eval 'is 200 && eq .generated false'
req POST /tasks/generate "{\"clientOpId\":\"$(uuid)\",\"date\":\"$TODAY\",\"dayMode\":\"sprint\",\"regenerate\":true}"
check "切换冲刺日并重新生成" eval 'is 200 && eq .dayMode sprint && [ "$(j ".tasks | length")" -ge 5 ]'

OP="$(uuid)"; TID="$(uuid)"
TASK="{\"clientOpId\":\"$OP\",\"id\":\"$TID\",\"date\":\"$TODAY\",\"title\":\"冒烟任务\",\"module\":\"other\",\"targetMinutes\":5}"
req POST /tasks "$TASK"
check "创建任务 201（客户端自带 id）" eval 'is 201 && eq .id "$TID" && eq .version 1'
req POST /tasks "$TASK"
check "同 clientOpId 重放：201 + Idempotent-Replayed" eval 'is 201 && eq .id "$TID" && printf "%s" "$HDRS" | grep -qi "^idempotent-replayed: true"'
req POST /tasks "{\"clientOpId\":\"$OP\",\"date\":\"$TODAY\",\"title\":\"不同内容\",\"module\":\"other\"}"
check "同 clientOpId 异体 → 422 IDEMPOTENCY_KEY_REUSED" eval 'is 422 && eq .error.code IDEMPOTENCY_KEY_REUSED'
req POST /tasks "{\"date\":\"$TODAY\",\"title\":\"x\",\"module\":\"other\"}"
check "缺 clientOpId → 400" eval 'is 400 && eq .error.code VALIDATION_FAILED'
req POST /tasks "{\"clientOpId\":\"$(uuid)\",\"date\":\"$TODAY\",\"title\":\"x\",\"module\":\"flying\"}"
check "非法枚举 module → 400" eval 'is 400 && eq .error.code VALIDATION_FAILED'
req POST /tasks "{\"clientOpId\":\"$(uuid)\",\"date\":\"$TODAY\",\"title\":\"x\",\"module\":\"other\",\"targetMinutes\":\"5\"}"
check "请求体严格类型：字符串数字不被强转 → 400" eval 'is 400 && eq ".error.details[0].path" /targetMinutes'
req PATCH "/tasks/$TID" "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":1,\"status\":\"done\"}"
check "完成任务：version 2 + completedAt" eval 'is 200 && eq .status done && eq .version 2 && [ "$(j .completedAt)" != null ]'
req PATCH "/tasks/$TID" "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":1,\"title\":\"改名\"}"
check "过期 baseVersion → 409" eval 'is 409 && eq .error.code VERSION_CONFLICT && eq .error.details.serverRecord.status done'
req GET "/tasks?from=$TODAY&to=$TODAY&limit=2"
check "列表游标分页：limit=2 有 nextCursor" eval 'is 200 && [ "$(j ".items | length")" = 2 ] && [ "$(j .nextCursor)" != null ]'
CUR="$(j .nextCursor)"; FIRST="$(j '.items[0].id')"
req GET "/tasks?from=$TODAY&to=$TODAY&limit=2&cursor=$CUR"
check "第二页不重复第一页" eval 'is 200 && [ "$(j ".items[0].id")" != "$FIRST" ]'
req GET "/tasks?cursor=@@bad@@"
check "坏游标 → 400" eval 'is 400'
req DELETE "/tasks/$TID?clientOpId=$(uuid)"
check "软删除 204" eval 'is 204'
req DELETE "/tasks/$TID?clientOpId=$(uuid)"
check "重复删除仍 204" eval 'is 204'
req GET "/tasks?from=$TODAY&to=$TODAY&limit=100"
check "已删除任务默认不返回" eval 'is 200 && [ -z "$(j ".items[] | select(.id == \"$TID\") | .id")" ]'
req PATCH "/tasks/$TID" "{\"clientOpId\":\"$(uuid)\",\"title\":\"复活?\"}"
check "修改已删除任务 → 404" eval 'is 404 && eq .error.code NOT_FOUND'

req POST /task-templates "{\"clientOpId\":\"$(uuid)\",\"title\":\"周末汉字\",\"module\":\"kanji\",\"dayModes\":[\"standard\"],\"weekdays\":[\"sat\",\"sun\"],\"targetMinutes\":15}"
check "创建模板 201" eval 'is 201 && eq ".weekdays | length" 2'
TPL="$(j .id)"
req PATCH "/task-templates/$TPL" "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":1,\"active\":false}"
check "停用模板 200" eval 'is 200 && eq .active false'
req GET "/task-templates/$TPL"
check "读取模板" eval 'is 200 && eq .version 2'
req DELETE "/task-templates/$TPL?clientOpId=$(uuid)&baseVersion=2"
check "删除模板 204" eval 'is 204'

echo "== cards"
req POST /cards "{\"clientOpId\":\"$(uuid)\",\"deck\":\"N5\",\"front\":\"食べる\",\"back\":\"吃\",\"reading\":\"たべる\",\"tags\":[\"verb\"]}"
check "创建卡片 201 + srs.state=new" eval 'is 201 && eq .srs.state new && eq .deck N5'
CID="$(j .id)"
IMPORT="{\"clientOpId\":\"$(uuid)\",\"deck\":\"N5\",\"cards\":[{\"front\":\"飲む\",\"back\":\"喝\"},{\"front\":\"見る\",\"back\":\"看\"},{\"front\":\"見る\",\"back\":\"重复\"},{\"front\":\"食べる\",\"back\":\"已存在\"}]}"
req POST /cards/import "$IMPORT"
check "导入：created 2 / skipped 2" eval 'is 200 && eq .created 2 && eq .skipped 2'
req GET "/cards/decks"
check "牌组统计 N5 total=3" eval 'is 200 && [ "$(j ".items[] | select(.deck == \"N5\") | .total")" = 3 ]'
req GET "/cards/due?deck=N5"
check "到期：新卡受 newCardsPerDay=5 约束" eval 'is 200 && eq .counts.new 3 && [ "$(j ".items | length")" = 3 ]'

RID="$(uuid)"; NOW="$(date -u +%FT%TZ)"
REVIEW="{\"clientOpId\":\"$(uuid)\",\"id\":\"$RID\",\"rating\":3,\"reviewedAt\":\"$NOW\",\"durationMs\":4200}"
req POST "/cards/$CID/review" "$REVIEW"
check "复习 good：state 变化、reps=1、version 不变" eval 'is 200 && [ "$(j .card.srs.state)" != new ] && eq .card.srs.reps 1 && eq .card.version 1 && eq .log.stateBefore new'
req POST "/cards/$CID/review" "$(printf '%s' "$REVIEW" | jq -c ".clientOpId = \"$(uuid)\"")"
check "同 review id、新 clientOpId：不重复计入" eval 'is 200 && eq .card.srs.reps 1'
PAST="$(date -u -d '-2 hours' +%FT%TZ)"
req POST "/cards/$CID/review" "{\"clientOpId\":\"$(uuid)\",\"rating\":1,\"reviewedAt\":\"$PAST\",\"durationMs\":3000}"
check "迟到的离线复习触发重演：reps=2" eval 'is 200 && eq .card.srs.reps 2'
FUT="$(date -u -d '+2 hours' +%FT%TZ)"
req POST "/cards/$CID/review" "{\"clientOpId\":\"$(uuid)\",\"rating\":3,\"reviewedAt\":\"$FUT\",\"durationMs\":1}"
check "未来时间复习 → 400" eval 'is 400'
req POST "/cards/$CID/review" "{\"clientOpId\":\"$(uuid)\",\"rating\":5,\"reviewedAt\":\"$NOW\",\"durationMs\":1}"
check "rating=5 → 400" eval 'is 400'
req PATCH "/cards/$CID" "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":1,\"back\":\"吃；食用\"}"
check "编辑卡片内容 version→2（复习未占用版本）" eval 'is 200 && eq .version 2 && eq .srs.reps 2'
req GET "/cards?q=%E9%A3%B2&limit=10"
check "卡片模糊搜索" eval 'is 200 && eq ".items | length" 1'

echo "== stats"
req POST /stats/time-logs "{\"clientOpId\":\"$(uuid)\",\"module\":\"flashcards\",\"startedAt\":\"$NOW\",\"durationMs\":600000}"
check "上报时长 201" eval 'is 201 && eq .durationMs 600000'
req POST /stats/jlpt-mocks "{\"clientOpId\":\"$(uuid)\",\"level\":\"N5\",\"takenAt\":\"$TODAY\",\"sections\":[{\"name\":\"言语知识\",\"score\":90,\"max\":120},{\"name\":\"听解\",\"score\":40,\"max\":60}]}"
check "录入模考 201 total=130/180" eval 'is 201 && eq .total 130 && eq .totalMax 180'
req GET /stats
check "统计：今日学习、连续天数、时长、复习数" eval 'is 200 && eq .streak.studiedToday true && eq .streak.current 1 && eq .totals.minutes 10 && eq .totals.cardsReviewed 2 && eq ".scenarioMastery | length" 9'
check "统计：模考趋势百分比" eval 'eq ".trends.jlptMock[0].value" 72.2'

echo "== mistakes"
MQ="smoke 题干 $RANDOM"
req POST /mistakes "{\"clientOpId\":\"$(uuid)\",\"category\":\"particle\",\"question\":\"$MQ\",\"wrongAnswer\":\"を\",\"correctAnswer\":\"に\"}"
check "新错题 201 + errorCount 1" eval 'is 201 && eq .errorCount 1'
MID="$(j .id)"
req POST /mistakes "{\"clientOpId\":\"$(uuid)\",\"category\":\"particle\",\"question\":\"$MQ\",\"wrongAnswer\":\"で\",\"correctAnswer\":\"に\"}"
check "同题再错 200 + 累加 + 同一 id" eval 'is 200 && eq .errorCount 2 && eq .id "$MID" && eq .wrongAnswer で'
req PATCH "/mistakes/$MID" "{\"clientOpId\":\"$(uuid)\",\"incrementError\":true}"
check "重做再错 incrementError → 3" eval 'is 200 && eq .errorCount 3'
MV="$(j .version)"
req PATCH "/mistakes/$MID" "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":$MV,\"mastered\":true}"
check "标记掌握 + masteredAt" eval 'is 200 && eq .mastered true && [ "$(j .masteredAt)" != null ]'
req PATCH "/mistakes/$MID" "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":$MV,\"mastered\":false}"
check "旧 baseVersion → 409" eval 'is 409 && eq .error.code VERSION_CONFLICT'
req GET "/mistakes?sort=errorCountDesc&limit=1"
check "按错误次数排序 200" eval 'is 200 && eq ".items[0].errorCount" 3'
req GET "/mistakes?sort=lastWrongDesc&mastered=true"
check "按最近错误排序 + 过滤已掌握" eval 'is 200 && eq ".items[0].id" "$MID"'
req DELETE "/mistakes/$MID?clientOpId=$(uuid)"
check "删除错题 204" eval 'is 204'

echo "== phrases"
req GET "/phrases?book=travel&limit=100"
check "内置旅行句库已补种" eval 'is 200 && [ "$(j ".items | length")" -ge 30 ] && eq ".items[0].builtin" true'
PID="$(j ".items[0].id")"
req PATCH "/phrases/$PID" "{\"clientOpId\":\"$(uuid)\",\"ja\":\"改掉\"}"
check "内置句改内容 → 403" eval 'is 403 && eq .error.code FORBIDDEN'
req PATCH "/phrases/$PID" "{\"clientOpId\":\"$(uuid)\",\"favorite\":true,\"note\":\"常用\"}"
check "内置句可收藏、写备注" eval 'is 200 && eq .favorite true && eq .note 常用'
req DELETE "/phrases/$PID?clientOpId=$(uuid)"
check "内置句不能删 → 403" eval 'is 403'
req GET "/phrases?favorite=true"
check "按收藏过滤" eval 'is 200 && eq ".items[0].id" "$PID"'
req POST /phrases "{\"clientOpId\":\"$(uuid)\",\"book\":\"life\",\"category\":\"自建\",\"ja\":\"水をください\",\"reading\":\"みずをください\",\"zh\":\"请给我水\"}"
check "新建句子 201 + builtin=false" eval 'is 201 && eq .builtin false'
CPID="$(j .id)"
req POST "/phrases/$CPID/attempts" "{\"clientOpId\":\"$(uuid)\",\"transcript\":\"みずをください\",\"method\":\"nativeSpeech\",\"durationMs\":1800}"
check "跟读（假名识别）满分" eval 'is 201 && eq .scores.overall 100 && eq ".diff[0].op" equal'
req POST "/phrases/$CPID/attempts" "{\"clientOpId\":\"$(uuid)\",\"transcript\":\"\",\"method\":\"selfAssessed\",\"durationMs\":0}"
check "自评缺 selfScore → 400" eval 'is 400 && eq ".error.details[0].path" /selfScore'
req GET "/phrases/$CPID"
check "句子记下最高分与次数（version 不变）" eval 'is 200 && eq .bestScore 100 && eq .attemptCount 1 && eq .version 1'
req GET "/phrases/$CPID/attempts"
check "跟读历史" eval 'is 200 && [ "$(j ".items | length")" = 1 ]'

echo "== speaking"
SAID="$(uuid)"
speak_body() { printf '{"clientOpId":"%s","id":"%s","mode":"shadowing","sourceType":"custom","referenceText":"すみません、駅はどこですか","transcript":"すみません","method":"webSpeech","durationMs":1200}' "$(uuid)" "$SAID"; }
req POST /speaking/attempts "$(speak_body)"
check "影子跟读：读一半 → 完整度低 + 末尾缺漏" eval 'is 201 && [ "$(j .scores.completeness)" -lt 50 ] && eq ".diff[-1].op" delete'
req POST /speaking/attempts "$(speak_body)"
check "同一 id 重推：原样返回不重复记" eval 'is 201 && eq .id "$SAID"'
req GET "/speaking/attempts?mode=shadowing"
check "跟读记录列表" eval 'is 200 && [ "$(j ".items | length")" = 1 ]'

echo "== scenarios"
req GET /scenarios
check "场景 9 类共 72 个" eval 'is 200 && [ "$(j ".items | length")" = 72 ] && eq .nextCursor null'
req GET "/scenarios?category=workplace"
check "按类别过滤：每类 ≥ 8" eval 'is 200 && [ "$(j ".items | length")" -ge 8 ]'
req GET "/scenarios?limit=50"
check "场景分页" eval 'is 200 && [ "$(j ".items | length")" = 50 ] && [ "$(j .nextCursor)" != null ]'
req GET "/scenarios?limit=50&cursor=$(j .nextCursor)"
check "场景第二页" eval 'is 200 && [ "$(j ".items | length")" = 22 ]'
req GET /scenarios/travel-airport-checkin
check "场景详情 + 进度" eval 'is 200 && eq .progress.attempts 0 && eq .progress.mastered false'
req POST /conversations "{\"clientOpId\":\"$(uuid)\",\"scenarioId\":\"no-such\"}"
check "不存在的场景 → 404（不调用 AI）" eval 'is 404'

echo "== ai（不调用模型的部分）"
req GET /me/ai-key
check "新用户：没有自己的 Key，也没有共享额度" eval 'is 200 && eq .source none && eq .hasOwnKey false && eq .last4 null'
req POST /ai/lookup '{"type":"word","query":"水"}'
check "没有 Key 时 AI 功能 → 403 AI_KEY_REQUIRED" eval 'is 403 && eq .error.code AI_KEY_REQUIRED'
req PUT /me/ai-key "{\"clientOpId\":\"$(uuid)\",\"apiKey\":\"sk-0000000000000000invalid\"}"
check "无效的 Key 保存不了 → 400" eval 'is 400 && eq ".error.details[0].path" /apiKey'
req GET /me/ai-key
check "无效 Key 没有入库" eval 'is 200 && eq .hasOwnKey false'
req POST /ai/lookup '{"type":"word"}'
check "lookup 缺 query → 400" eval 'is 400'
req POST /ai/quiz/check "{\"clientOpId\":\"$(uuid)\",\"quizId\":\"$(uuid)\",\"answers\":[{\"questionId\":\"q1\",\"choiceIndex\":0}]}"
check "不存在的测验 → 404" eval 'is 404'

if [ "${SMOKE_AI:-0}" = 1 ]; then
  echo "== ai（真实调用 DeepSeek，约 1 分钟）"
  if [ -z "${SMOKE_AI_KEY:-}" ]; then echo "SMOKE_AI=1 需要同时提供 SMOKE_AI_KEY"; exit 2; fi
  req PUT /me/ai-key "{\"clientOpId\":\"$(uuid)\",\"apiKey\":\"$SMOKE_AI_KEY\"}"
  check "保存自己的 Key：校验通过，只返回末 4 位" eval 'is 200 && eq .source own && eq .last4 "${SMOKE_AI_KEY: -4}" && ! printf "%s" "$BODY" | grep -q "$SMOKE_AI_KEY"'
  req POST /ai/lookup '{"type":"word","query":"食べる"}'
  check "查词：解释 + 3 例句 + 3 题且不下发答案" eval 'is 200 && eq .headword 食べる && [ "$(j ".examples | length")" = 3 ] && [ "$(j ".quiz.questions | length")" = 3 ] && eq ".quiz.questions[0].answerIndex" null'
  QID="$(j .quiz.quizId)"
  req POST /ai/lookup '{"type":"word","query":"  食べる "}'
  check "同词再查命中缓存" eval 'is 200 && eq .cached true && [ "$(j .quiz.quizId)" != "$QID" ]'
  req POST /ai/quiz/check "{\"clientOpId\":\"$(uuid)\",\"quizId\":\"$QID\",\"answers\":[{\"questionId\":\"q1\",\"choiceIndex\":0},{\"questionId\":\"q2\",\"choiceIndex\":0},{\"questionId\":\"q3\",\"choiceIndex\":0}]}"
  check "判分：答错的进错题本" eval 'is 200 && eq .total 3 && [ "$(j "[.results[] | select(.correct == false and .mistakeId == null)] | length")" = 0 ]'
  WRONG="$(j "[.results[] | select(.correct == false)][0].mistakeId")"
  req POST /ai/lookup '{"type":"grammar","query":"〜てもいい"}'
  check "查语法" eval 'is 200 && [ "$(j .pattern)" != null ] && [ "$(j ".quiz.questions | length")" = 3 ]'
  req POST /ai/lookup '{"type":"kanji","query":"語"}'
  check "查汉字" eval 'is 200 && eq .character 語 && [ "$(j .strokeCount)" -gt 0 ]'
  if [ "$WRONG" != null ]; then
    req POST "/mistakes/$WRONG/retry" "{\"clientOpId\":\"$(uuid)\"}"
    check "错题一键重出变式题" eval 'is 200 && eq .mistakeId "$WRONG" && [ "$(j ".quiz.questions | length")" -ge 1 ]'
  fi
  req POST /conversations "{\"clientOpId\":\"$(uuid)\",\"scenarioId\":\"travel-restaurant-order\"}"
  check "开始对话：AI 开场白" eval 'is 201 && eq .openingMessage.role assistant && eq .conversation.messageCount 1'
  CID="$(j .conversation.id)"
  req POST "/conversations/$CID/messages" "{\"clientOpId\":\"$(uuid)\",\"content\":\"二人です。おすすめは何ですか。\"}"
  check "发消息：批改 + 回复" eval 'is 200 && [ "$(j .userMessage.feedback.score)" -ge 0 ] && eq .assistantMessage.role assistant && eq .conversation.messageCount 3'
  req GET "/conversations/$CID/messages"
  check "消息按时间升序一问一答" eval 'is 200 && eq ".items[1].role" user && eq ".items[2].role" assistant'
  req PATCH "/conversations/$CID" "{\"clientOpId\":\"$(uuid)\",\"status\":\"finished\"}"
  check "结束对话：综合分 + 总结" eval 'is 200 && eq .status finished && [ "$(j .score)" -ge 0 ] && [ "$(j .summary)" != null ]'
  req POST "/conversations/$CID/messages" "{\"clientOpId\":\"$(uuid)\",\"content\":\"すみません\"}"
  check "已结束的对话不能再发 → 422" eval 'is 422'
  req GET /scenarios/travel-restaurant-order
  check "场景进度记下这次练习" eval 'is 200 && eq .progress.attempts 1'
fi

echo "== listening"
req GET /listening/materials
check "听力材料列表（无音频走 TTS）" eval 'is 200 && [ "$(j ".items | length")" -ge 8 ] && eq ".items[0].audioUrl" null && eq ".items[0].segments" null'
req GET /listening/materials/ls-cafe-order
check "听力材料详情含分段" eval 'is 200 && [ "$(j ".segments | length")" -ge 4 ]'
req POST /listening/dictation '{"materialId":"ls-cafe-order","segmentIndex":1,"answer":"ホットコーヒーをひとつおねがいします"}'
check "听写即时判分（按读音满分）" eval 'is 200 && eq .accuracy 100'
req POST /listening/dictation '{"materialId":"ls-cafe-order","segmentIndex":99,"answer":"x"}'
check "听写段号越界 → 400" eval 'is 400'
req POST /listening/attempts "{\"clientOpId\":\"$(uuid)\",\"materialId\":\"ls-cafe-order\",\"mode\":\"dictation\",\"durationMs\":60000,\"dictationAnswers\":[{\"index\":0,\"answer\":\"いらっしゃいませ\"},{\"index\":1,\"answer\":\"ホットコーヒーを一つお願いします\"}],\"replays\":3}"
check "听写练习记录 + 分段得分 + 平均分" eval 'is 201 && eq ".segmentScores | length" 2 && eq ".segmentScores[1].accuracy" 100 && [ "$(j .score)" -gt 0 ]'
req GET "/listening/attempts?mode=dictation"
check "听力记录列表" eval 'is 200 && [ "$(j ".items | length")" = 1 ]'

echo "== reading"
req GET /reading/materials
check "阅读材料列表（含字数）" eval 'is 200 && [ "$(j ".items | length")" -ge 6 ] && [ "$(j ".items[0].charCount")" -gt 0 ] && eq ".items[0].body" null'
req GET /reading/materials/rd-my-room
check "阅读详情：注音正文 + 生词 + 题目不含答案" eval 'is 200 && j .body | grep -q "<ruby>" && eq ".questions[0].answerIndex" null'
req POST /reading/attempts "{\"clientOpId\":\"$(uuid)\",\"materialId\":\"rd-my-room\",\"durationMs\":60000,\"lookedUpWords\":[\"本棚\"],\"answers\":[{\"questionId\":\"q1\",\"choiceIndex\":1},{\"questionId\":\"q2\",\"choiceIndex\":0}]}"
check "阅读记录：字/分 + 理解题判分" eval 'is 201 && [ "$(j .charsPerMinute)" -gt 0 ] && eq .comprehensionCorrect 1 && eq .comprehensionTotal 2'

echo "== pronunciation"
req GET "/pronunciation/pairs?category=sokuon"
check "最小对立对（促音）" eval 'is 200 && [ "$(j ".items | length")" -ge 5 ]'
req POST /pronunciation/attempts "{\"clientOpId\":\"$(uuid)\",\"pairId\":\"pr-sokuon-1\",\"mode\":\"listen\",\"target\":\"b\",\"chosen\":\"a\"}"
check "听辨选错 → correct=false" eval 'is 201 && eq .correct false'
req POST /pronunciation/attempts "{\"clientOpId\":\"$(uuid)\",\"pairId\":\"pr-sokuon-1\",\"mode\":\"speak\",\"target\":\"a\",\"transcript\":\"きって\",\"method\":\"webSpeech\"}"
check "开口读：读成了对立的另一个词 → 判错" eval 'is 201 && eq .correct false'
req POST /pronunciation/attempts "{\"clientOpId\":\"$(uuid)\",\"pairId\":\"pr-sokuon-1\",\"mode\":\"speak\",\"target\":\"b\",\"transcript\":\"きって\",\"method\":\"webSpeech\"}"
check "开口读：读音一致判对" eval 'is 201 && eq .correct true'
req GET "/mistakes?source=pronunciation"
check "听辨错误自动进错题本" eval 'is 200 && [ "$(j ".items | length")" -ge 1 ]'

echo "== expressions / kanji"
req GET "/expressions/items?type=keigo&kind=kenjougo"
check "敬语条目（谦让语）带普通形" eval 'is 200 && [ "$(j ".items | length")" -ge 5 ] && [ "$(j ".items[0].plainForm")" != null ]'
req GET "/expressions/items?type=idiom"
check "惯用语条目" eval 'is 200 && [ "$(j ".items | length")" -ge 10 ]'
req POST /expressions/attempts "{\"clientOpId\":\"$(uuid)\",\"itemId\":\"kg-sonkeigo-3\",\"mode\":\"convert\",\"answer\":\"めしあがる\",\"correct\":false}"
check "转换题服务端复核：读音一致判对" eval 'is 201 && eq .correct true'
req POST /expressions/attempts "{\"clientOpId\":\"$(uuid)\",\"itemId\":\"kg-sonkeigo-3\",\"mode\":\"convert\",\"answer\":\"食べられる\",\"correct\":true}"
check "转换题：客户端误判为对也会被纠正" eval 'is 201 && eq .correct false'
req GET "/expressions/attempts?type=keigo"
check "敬语练习记录" eval 'is 200 && [ "$(j ".items | length")" = 2 ]'
req GET "/kanji?level=N5&limit=100"
check "N5 汉字 ≥ 90 + 进度" eval 'is 200 && [ "$(j ".items | length")" -ge 90 ] && eq ".items[0].progress.attempts" 0'
req GET "/kanji?q=$(printf %s みず | jq -sRr @uri)"
check "按读音查汉字" eval 'is 200 && eq ".items[0].character" 水'
req POST /kanji/attempts "{\"clientOpId\":\"$(uuid)\",\"kanjiId\":\"kj-水\",\"mode\":\"reading\",\"answer\":\"スイ\",\"correct\":false}"
check "读音题服务端复核（音读）" eval 'is 201 && eq .correct true'
req GET "/kanji?q=$(printf %s 水 | jq -sRr @uri)"
check "汉字进度更新" eval 'is 200 && eq ".items[0].progress.attempts" 1 && eq ".items[0].progress.correctRate" 1'

echo "== vocab test / courses"
req POST /vocab-test/start "{\"clientOpId\":\"$(uuid)\"}"
check "词汇测试 60 题，不含答案" eval 'is 200 && eq ".items | length" 60 && eq ".items[0].answerIndex" null'
VTID="$(j .testId)"
ANS="$(printf '%s' "$BODY" | jq -c '[.items[] | if .kind == "choice" then {itemId, choiceIndex: 0} else {itemId, known: true} end]')"
req POST /vocab-test/submit "{\"clientOpId\":\"$(uuid)\",\"testId\":\"$VTID\",\"answers\":$ANS,\"durationMs\":300000}"
check "全答认识：假词误报率 1 → 估算被校正" eval 'is 200 && eq .falseAlarmRate 1 && eq .estimatedVocab 0'
req POST /vocab-test/submit "{\"clientOpId\":\"$(uuid)\",\"testId\":\"$VTID\",\"answers\":[],\"durationMs\":1}"
check "重复提交返回首次结果" eval 'is 200 && eq .falseAlarmRate 1'
req GET /vocab-test/history
check "词汇测试历史" eval 'is 200 && [ "$(j ".items | length")" = 1 ]'
req POST /courses "{\"clientOpId\":\"$(uuid)\",\"title\":\"标日初级上\",\"platform\":\"bilibili\",\"url\":\"https://www.bilibili.com/video/BV1xx\",\"totalEpisodes\":48}"
check "新建课程（外链）" eval 'is 201 && eq .currentEpisode 0 && eq .status planned'
COID="$(j .id)"
req PATCH "/courses/$COID" "{\"clientOpId\":\"$(uuid)\",\"baseVersion\":1,\"currentEpisode\":5,\"status\":\"inProgress\",\"lastStudiedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
check "更新课程进度" eval 'is 200 && eq .currentEpisode 5 && eq .version 2'

echo "== sync"
req GET /me
ME="$(j .user.id)"
TID="$(uuid)"; CARD="$(uuid)"; RLOG="$(uuid)"; DRAFT="$(uuid)"; OPA="$(uuid)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PUSH="{\"deviceId\":\"smoke\",\"ops\":[
 {\"clientOpId\":\"$OPA\",\"entity\":\"task\",\"action\":\"create\",\"id\":\"$TID\",\"data\":{\"title\":\"离线任务\",\"module\":\"other\",\"date\":\"$(date +%F)\"},\"clientTimestamp\":\"$NOW\"},
 {\"clientOpId\":\"$(uuid)\",\"entity\":\"card\",\"action\":\"create\",\"id\":\"$CARD\",\"data\":{\"front\":\"離線\",\"back\":\"离线\"},\"clientTimestamp\":\"$NOW\"},
 {\"clientOpId\":\"$(uuid)\",\"entity\":\"reviewLog\",\"action\":\"create\",\"id\":\"$RLOG\",\"data\":{\"cardId\":\"$CARD\",\"rating\":3,\"reviewedAt\":\"$NOW\",\"durationMs\":4000},\"clientTimestamp\":\"$NOW\"},
 {\"clientOpId\":\"$(uuid)\",\"entity\":\"writingEntry\",\"action\":\"create\",\"id\":\"$DRAFT\",\"data\":{\"kind\":\"diary\",\"title\":\"草稿\",\"content\":\"きょうはいい天気です。\"},\"clientTimestamp\":\"$NOW\"},
 {\"clientOpId\":\"$(uuid)\",\"entity\":\"settings\",\"action\":\"update\",\"id\":\"$(uuid)\",\"data\":{\"speechRate\":1.2},\"clientTimestamp\":\"$NOW\"},
 {\"clientOpId\":\"$(uuid)\",\"entity\":\"settings\",\"action\":\"update\",\"id\":\"$ME\",\"data\":{\"speechRate\":1.2},\"clientTimestamp\":\"$NOW\"},
 {\"clientOpId\":\"$(uuid)\",\"entity\":\"reviewLog\",\"action\":\"update\",\"id\":\"$RLOG\",\"baseVersion\":1,\"data\":{\"rating\":4},\"clientTimestamp\":\"$NOW\"},
 {\"clientOpId\":\"$(uuid)\",\"entity\":\"task\",\"action\":\"update\",\"id\":\"$TID\",\"baseVersion\":99,\"data\":{\"status\":\"done\"},\"clientTimestamp\":\"$NOW\"}
]}"
req POST /sync/push "$PUSH"
check "push：逐条结果，顺序一致" eval 'is 200 && eq ".results | length" 8 && eq ".results[0].clientOpId" "$OPA"'
check "push：新建任务/卡片 applied" eval 'eq ".results[0].status" applied && eq ".results[1].status" applied'
check "push：复习记录依赖前一条卡片，applied" eval 'eq ".results[2].status" applied && eq ".results[2].record.id" "$RLOG"'
check "push：离线草稿 applied 且为 draft" eval 'eq ".results[3].status" applied && eq ".results[3].record.status" draft'
check "push：设置 id 不是本人 → rejected" eval 'eq ".results[4].status" rejected'
check "push：设置只带变更字段 → 合并后 applied" eval 'eq ".results[5].status" applied && eq ".results[5].record.data.speechRate" 1.2 && [ "$(j ".results[5].record.data.timezone")" != null ]'
check "push：只追加实体 update → rejected" eval 'eq ".results[6].status" rejected && eq ".results[6].error.code" UNPROCESSABLE'
check "push：baseVersion 不符 → conflict + serverRecord" eval 'eq ".results[7].status" conflict && eq ".results[7].serverRecord.id" "$TID"'
req POST /sync/push "$PUSH"
check "push：整批重推 → duplicate（不重复执行）" eval 'is 200 && eq ".results[0].status" duplicate && eq ".results[2].status" duplicate && eq ".results[3].status" duplicate'
req GET "/sync/pull?limit=1000"
check "pull：全量含各类实体 + 游标" eval 'is 200 && eq .hasMore false && [ "$(j .nextCursor)" != null ] && [ "$(j "[.changes[].entity] | unique | length")" -ge 10 ]'
check "pull：rev 严格递增" eval 'printf "%s" "$BODY" | jq -e "[.changes[].rev] | . == sort and (unique | length) == length" >/dev/null'
check "pull：含内置句与 dayPlan" eval '[ "$(j "[.changes[] | select(.entity == \"phrase\")] | length")" -ge 58 ] && [ "$(j "[.changes[] | select(.entity == \"dayPlan\")] | length")" -ge 1 ]'
CUR="$(j .nextCursor)"
req GET "/sync/pull?cursor=$CUR"
check "pull：游标之后暂无变化" eval 'is 200 && eq ".changes | length" 0 && eq .nextCursor "$CUR"'
req GET "/sync/pull?limit=5"
check "pull：分页 hasMore" eval 'is 200 && eq ".changes | length" 5 && eq .hasMore true'

echo "== data"
req GET /data/export
check "导出：格式版本 + 全部实体 + 附件头" eval 'is 200 && eq .formatVersion 1 && [ "$(j ".entities.task | length")" -ge 1 ] && printf "%s" "$HDRS" | grep -qi "content-disposition: attachment"'
EXPORT="$BODY"
req POST /data/import "{\"clientOpId\":\"$(uuid)\",\"mode\":\"merge\",\"bundle\":$EXPORT}"
check "导入 merge：同版本全部跳过" eval 'is 200 && eq .counts.task.created 0 && eq .counts.task.updated 0 && [ "$(j .counts.task.skipped)" -ge 1 ]'
req POST /data/import "{\"clientOpId\":\"$(uuid)\",\"mode\":\"replace\",\"bundle\":$EXPORT}"
check "导入 replace：覆盖还原" eval 'is 200 && [ "$(j .counts.task.updated)" -ge 1 ]'
req GET "/courses"
check "replace 之后数据仍在" eval 'is 200 && eq ".items[0].id" "$COID"'
req GET /data/backup-status
check "备份状态" eval 'is 200 && [ "$(j .retainedCount)" -ge 0 ]'

echo "== stats"
req GET /stats
check "统计：错题、测验、场景掌握都有真实值" eval 'is 200 && [ "$(j .mistakes.total)" -ge 1 ] && eq ".scenarioMastery | length" 9 && eq ".scenarioMastery[0].total" 8'

if [ "${SMOKE_AI:-0}" = 1 ]; then
  echo "== writing（真实调用 DeepSeek）"
  req POST /writing/submit "{\"clientOpId\":\"$(uuid)\",\"id\":\"$DRAFT\",\"kind\":\"diary\",\"title\":\"草稿\",\"content\":\"きょうは友達と映画を見ました。とても面白いでした。\"}"
  check "提交草稿批改：corrected + 分数 + 润色" eval 'is 200 && eq .status corrected && [ "$(j .correction.score)" -ge 0 ] && [ "$(j .correction.revisedText)" != null ]'
  req POST /writing/submit "{\"clientOpId\":\"$(uuid)\",\"id\":\"$DRAFT\",\"kind\":\"diary\",\"title\":\"x\",\"content\":\"y\"}"
  check "已批改的不能再交 → 422" eval 'is 422'
  req GET "/writing/entries?status=corrected"
  check "写作列表" eval 'is 200 && eq ".items[0].id" "$DRAFT"'
  req DELETE "/me/ai-key?clientOpId=$(uuid)"
  check "删除自己的 Key" eval 'is 204'
  req POST /ai/lookup '{"type":"word","query":"水"}'
  check "删除后 AI 功能又要求填 Key" eval 'is 403 && eq .error.code AI_KEY_REQUIRED'
fi

echo "== v1.3.0：课程体系 / 学习计划 / 视频课程 / 应用更新"
req GET /curriculum
check "课程线路：入门 + 假名 + N5–N1" eval 'is 200 && eq ".items[0].id" guide-0 && [ "$(j ".items | length")" = 99 ] && eq ".items[0].status" available && eq ".items[1].status" locked'
check "课程挂上了视频分集" eval 'eq "[.items[] | select(.id == \"n5-01\")][0].videos | length" 2'
req GET /lessons/n5-02
check "未解锁的课 → 403" eval 'is 403 && eq .error.code FORBIDDEN'
req GET /lessons/kana-1
check "假名课也锁着（零基础先过第 0 站）" eval 'is 403'
req GET /lessons/guide-0
check "第 0 站：手写讲义 + 小测不含答案" eval 'is 200 && [ "$(j ".sections | length")" -ge 3 ] && eq .generated false && [ "$(j ".quiz.questions | length")" -ge 4 ] && eq ".quiz.questions[0].answerIndex" null'
GQ="$(j .quiz.quizId)"
req POST /lessons/guide-0/complete "{\"clientOpId\":\"$(uuid)\",\"quizId\":\"$GQ\"}"
check "没作答就完成 → 422" eval 'is 422'
req POST /ai/quiz/check "{\"clientOpId\":\"$(uuid)\",\"quizId\":\"$GQ\",\"answers\":[{\"questionId\":\"q1\",\"choiceIndex\":0},{\"questionId\":\"q2\",\"choiceIndex\":0},{\"questionId\":\"q3\",\"choiceIndex\":0},{\"questionId\":\"q4\",\"choiceIndex\":0}]}"
check "第 0 站小测判分" eval 'is 200 && eq .total 4'
req POST /lessons/guide-0/complete "{\"clientOpId\":\"$(uuid)\",\"quizId\":\"$GQ\"}"
check "完成：返回分数与是否过关" eval 'is 200 && [ "$(j .score)" -ge 0 ] && [ "$(j .passed)" != null ] && eq .progress.lessonId guide-0'

req POST /plan/preview '{"startLevel":"zero","goal":"N4","targetDate":"2027-12-31","dailyMinutes":45,"reminderTime":"20:00","lateReminder":true}'
check "计划预估：站数、学时、可行性、预计到站" eval 'is 200 && [ "$(j .lessonCount)" -ge 50 ] && [ "$(j .estimatedHours)" != null ] && [ "$(j .projectedFinish)" != null ]'
req GET /plan
check "还没有计划 → 404" eval 'is 404'
req PUT /plan "{\"clientOpId\":\"$(uuid)\",\"startLevel\":\"kana\",\"goal\":\"N5\",\"targetDate\":\"2027-06-30\",\"dailyMinutes\":60,\"reminderTime\":\"20:30\",\"lateReminder\":true}"
check "保存计划" eval 'is 200 && eq .goal N5 && eq .reminderTime 20:30 && [ "$(j .startDate)" != null ]'
req PUT /plan "{\"clientOpId\":\"$(uuid)\",\"startLevel\":\"kana\",\"goal\":\"N5\",\"targetDate\":\"2020-01-01\",\"dailyMinutes\":60,\"reminderTime\":null,\"lateReminder\":false}"
check "截止日早于今天 → 400" eval 'is 400'
req GET /plan/today
check "今日计划：下一站从 N5 第 1 课开始（会假名）" eval 'is 200 && eq ".nextLessons[0].id" n5-01 && [ "$(j .totalCount)" = 24 ] && [ "$(j .studiedToday)" != null ]'
req GET /curriculum?part=N5
check "起点之前（假名）可学、N5 第 1 课可学、第 2 课锁定" eval 'is 200 && eq ".items[0].status" available && eq ".items[1].status" locked'

echo "== v1.5.0：学习闭环 / 朗读音频 / 学习教练"
req GET /cards/decks
check "定好计划就有预设词卡（第 1、2 课）" eval 'is 200 && [ "$(j "[.items[] | select(.deck == \"课程\")][0].total")" -ge 6 ]'
req GET /route/today
check "今日路线：复习 + 第 1 课（视频 → 练习 → 小测）" eval 'is 200 && eq ".steps[0].kind" review && eq ".steps[1].id" n5-01:video && eq ".steps[2].kind" practice && eq ".steps[3].kind" quiz && eq ".steps[2].done" false'
req POST /lessons/n5-01/practice "{\"clientOpId\":\"$(uuid)\",\"correct\":9,\"total\":10}"
check "记录本课练习成绩" eval 'is 200 && eq .score 90 && eq .progress.practiceBest 90'
req POST /lessons/n5-01/practice "{\"clientOpId\":\"$(uuid)\",\"correct\":11,\"total\":10}"
check "答对数多于总数 → 400" eval 'is 400'
req GET /route/today
check "练过之后路线上的练习打勾" eval 'is 200 && eq ".steps[2].done" true'
req POST /tts '{"text":"こんにちは、一駅です。"}'
check "生成朗读音频" eval 'is 200 && [ "$(j .key | wc -c)" -ge 40 ] && eq .voice ja-JP-NanamiNeural'
TTS_URL="$(j .url)"
check "取音频文件：audio/mpeg、永久缓存" eval '[ "$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$BASE${TTS_URL#/api/v1}")" = "200 audio/mpeg" ]'
req POST /tts '{"text":"hello 123"}'
check "没有假名和汉字的文本 → 400" eval 'is 400'
req GET /tts/0000000000000000000000000000000000000000.mp3
check "没生成过的音频 → 404" eval 'is 404'
req GET /coach/daily
check "每日小结：没有 Key 时按规则写" eval 'is 200 && eq .kind daily && eq .source rules && [ "$(j ".suggestions | length")" -ge 1 ]'
req GET /coach/lessons/guide-0
check "考过的课有本站小结" eval 'is 200 && eq .kind lesson && eq .ref guide-0'
req GET /coach/lessons/n5-03
check "没考过的课 → 422" eval 'is 422'
req GET /scenarios/lesson:n5-01
check "按课生成的对话场景" eval 'is 200 && eq .id lesson:n5-01 && [ "$(j ".keyPhrases | length")" -ge 1 ]'

echo "== v1.6.0：学习阶段 / 离线识别"
req GET /learn/stage
check "学习阶段：会假名、从 N5 第 1 课起 → N5，有例句可练" eval 'is 200 && eq .stage N5 && eq .currentLesson.id n5-01 && [ "$(j ".sentences | length")" -ge 2 ] && [ "$(j ".knownKana | length")" -ge 40 ]'
req POST /speaking/attempts "{\"clientOpId\":\"$(uuid)\",\"mode\":\"reading\",\"sourceType\":\"custom\",\"referenceText\":\"私は学生です\",\"referenceReading\":\"わたしはがくせいです\",\"transcript\":\"わたしはがくせ\",\"method\":\"offlineSpeech\",\"durationMs\":2500}"
check "离线识别 + 读音对齐：从宽计分（7/10 拍 → 原始 70 抬到 85）" eval 'is 201 && eq .scores.completeness 85 && eq .scores.accuracy 100'
req POST /speaking/attempts "{\"clientOpId\":\"$(uuid)\",\"mode\":\"reading\",\"sourceType\":\"custom\",\"referenceText\":\"いえ\",\"transcript\":\"家\",\"method\":\"offlineSpeech\",\"durationMs\":0}"
check "内置识别把「いえ」写成「家」也按读音给满分" eval 'is 201 && eq .scores.overall 100'
LATEST="$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$BASE/app/latest/windows")"
check "官网用的最新版地址：302 到当前 Windows 安装包" eval '[[ "$LATEST" == "302 "*"jp-study-"*"-setup.exe" ]]'
LATEST_HK="$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$BASE/app/latest/windows?via=hk")"
check "备用线路：走本机" eval '[[ "$LATEST_HK" == "302 "*"/api/v1/app/files/jp-study-"* ]]'
req GET /app/desktop/windows/x86_64/0.0.1
check "旧版电脑端更新：不给 http 地址" eval 'is 200 && [[ "$BODY" != *"http://"* ]]'
MODEL_LEN="$(curl -sIL "$BASE/app/models/vosk-model-small-ja-0.22.tar.gz" | grep -i '^content-length' | tail -1 | tr -dc '0-9')"
check "识别模型可下载（约 47 MB）" eval '[ "${MODEL_LEN:-0}" -ge 40000000 ]'

echo "== v1.7.0：内容扩充 / 实时点评"
req GET /coach/live
check "实时点评：没有 Key 时当场按规则写" eval 'is 200 && eq .kind live && eq .source rules && eq .refreshing false && [ "$(j ".suggestions | length")" -ge 1 ]'
LIVE_T1="$(j .id)"
req GET /coach/live
check "数据没变：点评不重写" eval 'is 200 && eq .id "$LIVE_T1"'
req GET /lessons/n5-01
check "课程带更多生词和句子" eval 'is 200 && [ "$(j ".vocab | length")" -ge 20 ] && [ "$(j ".sentences | length")" -ge 10 ] && [ "$(j "[.vocab[] | select(.example != null)] | length")" -ge 10 ]'
req GET /route/today
check "主线：未过关的课还有视频步骤" eval 'is 200 && eq ".steps[1].kind" video'
req GET /phrases?limit=1
check "句库大幅增加（补种到 v3）" eval 'is 200'
req GET "/listening/materials?limit=100"
check "听力材料 ≥ 30 篇" eval 'is 200 && [ "$(j ".items | length")" -ge 30 ]'
req GET "/reading/materials?limit=100"
check "阅读材料 ≥ 25 篇" eval 'is 200 && [ "$(j ".items | length")" -ge 25 ]'

echo "== v1.9.0：重新学习"
req GET /cards/restudy
check "重新学习：按天和按课分组" eval 'is 200 && [ "$(j ".lessons | length")" -ge 1 ] && [ "$(j ".days | type")" = array ]'
RL="$(j ".lessons[0].lessonId")"
req GET "/cards/restudy/items?lessonId=$RL"
check "取某一课的卡" eval 'is 200 && [ "$(j ".items | length")" -ge 1 ]'
req GET /cards/restudy/items
check "不给条件 → 400" eval 'is 400'

echo "== v1.10.0：重学成绩、建议核验、学时"
req GET "/cards/restudy/items?lessonId=$RL"
RC1="$(j ".items[0].id")"; RC2="$(j ".items[1].id")"
req POST /cards/restudy/rounds "{\"clientOpId\":\"$(uuid)\",\"scope\":\"lesson\",\"value\":\"$RL\",\"results\":[{\"cardId\":\"$RC1\",\"known\":true},{\"cardId\":\"$RC2\",\"known\":false}]}"
check "提交一轮重学：50 分" eval 'is 201 && eq .score 50 && eq .total 2 && eq .known 1 && eq .previousScore null'
req POST /cards/restudy/rounds "{\"clientOpId\":\"$(uuid)\",\"scope\":\"lesson\",\"value\":\"$RL\",\"results\":[{\"cardId\":\"$RC1\",\"known\":true}]}"
check "再做一轮：带上次分数" eval 'is 201 && eq .score 100 && eq .previousScore 50'
req POST /cards/restudy/rounds "{\"clientOpId\":\"$(uuid)\",\"scope\":\"lesson\",\"results\":[{\"cardId\":\"$RC1\",\"known\":true}]}"
check "课程范围不给 value → 400" eval 'is 400'
req POST /cards/restudy/rounds "{\"clientOpId\":\"$(uuid)\",\"scope\":\"hard\",\"results\":[{\"cardId\":\"$(uuid)\",\"known\":true}]}"
check "别人的或不存在的卡 → 404" eval 'is 404'
req GET /cards/restudy
check "分组带最近分数和总记不住" eval 'is 200 && [ "$(j "[.lessons[] | select(.lessonId == \"$RL\")][0].lastScore")" = 100 ] && [ "$(j ".hard | has(\"count\")")" = true ]'
req GET "/cards/restudy/items?hard=true"
check "取总记不住的卡" eval 'is 200 && [ "$(j ".items | type")" = array ]'
req POST /plan/preview "{\"startLevel\":\"zero\",\"goal\":\"N2\",\"targetDate\":\"2040-01-01\",\"dailyMinutes\":60,\"reminderTime\":\"20:00\",\"lateReminder\":false}"
check "学时校准：零基础到 N2 约 1000 小时" eval 'is 200 && [ "$(j ".estimatedHours | floor")" -ge 950 ] && [ "$(j ".estimatedHours | floor")" -le 1050 ]'
req GET /lessons/n5-01
check "课程带单词表，小测 10 题且含单词题" eval 'is 200 && [ "$(j ".wordList | length")" -ge 20 ] && [ "$(j ".quiz.questions | length")" = 10 ] && [ "$(j "[.quiz.questions[].stem | select(test(\"怎么读|是什么意思|用日语怎么说\"))] | length")" -ge 3 ]'
Q1="$(j "[.quiz.questions[].stem] | sort | join(\"|\")")"
req GET /lessons/n5-01
check "重新打开小测换了题" eval '[ "$(j "[.quiz.questions[].stem] | sort | join(\"|\")")" != "$Q1" ]'
req GET /coach/live
check "实时点评：有详细分析，建议带核验状态和做法" eval 'is 200 && [ "$(j ".sections | length")" -ge 2 ] && [ "$(j ".suggestions[0].status")" != null ] && [ "$(j ".suggestions[0].detail")" != null ]'

req GET /video-courses
check "视频课程：200 集合集" eval 'is 200 && eq ".items[0].episodeCount" 200 && eq ".items[0].bvid" BV1Bp4y1D747'
VC="$(j ".items[0].id")"
req PUT "/video-progress/$VC/10" "{\"clientOpId\":\"$(uuid)\",\"positionSec\":300}"
check "记录观看进度" eval 'is 200 && eq .positionSec 300 && eq .completed false'
req PUT "/video-progress/$VC/10" "{\"clientOpId\":\"$(uuid)\",\"positionSec\":120,\"completed\":true}"
check "进度只增不减、可标记看完" eval 'is 200 && eq .positionSec 300 && eq .completed true'
req GET "/video-courses/$VC"
check "视频详情：分组、关联课程、进度、上次看到" eval 'is 200 && eq ".episodes[9].section" 初级上 && eq ".episodes[9].lessonId" n5-01 && eq ".episodes[9].progress.completed" true && eq .lastPage 10'

SAVE="$TOKEN"; TOKEN=""
req GET /app/manifest
check "更新清单无需登录" eval 'is 200 && [ "$(j "has(\"web\")")" = true ]'
check "清单带安装包校验值" eval '[ "$(j ".android.sha256 | length")" = 64 ]'
req GET /app/desktop/windows/x86_64/99.0.0
check "桌面已是最新 → 204" eval 'is 204'
req GET "/app/files/..%2Fetc%2Fpasswd"
check "更新文件名不许越界" eval '[ "$STATUS" = 400 ] || [ "$STATUS" = 404 ]'
TOKEN="$SAVE"

echo "== logout"
req POST /auth/logout
check "logout 204" eval 'is 204'
RT="$NEW_RT"; req POST /auth/refresh
check "注销后 refresh 失效 401" eval 'is 401 && eq .error.code REFRESH_TOKEN_INVALID'
echo "  (等待 11 秒，越过轮换宽限期)"; sleep 11
RT="$OLD_RT"; req POST /auth/refresh
check "旧 refresh token 复用 → 401" eval 'is 401 && eq .error.code REFRESH_TOKEN_INVALID'

echo "== app 平台（X-Client-Platform: android）"
TOKEN=""; RT=""
EXTRA=(-H "x-client-platform: android")
AEMAIL="smoke-app-$(date +%s)-$RANDOM@example.com"
req POST /auth/register "{\"email\":\"$AEMAIL\",\"password\":\"smoke-pass-123\",\"displayName\":\"App\"}"
check "App 注册：响应体含 refreshToken，且不设 cookie" eval 'is 201 && [ "$(j .refreshToken)" != null ] && eq .refreshExpiresIn 2592000 && ! printf "%s" "$HDRS" | grep -qi "^set-cookie: jp_rt="'
ART1="$(j .refreshToken)"; TOKEN="$(j .accessToken)"
req GET /me
check "App accessToken 可用" eval 'is 200 && eq .user.email "$AEMAIL"'
req POST /auth/refresh "{\"refreshToken\":\"$ART1\"}"
check "App 刷新：请求体提交，响应体轮换出新 token" eval 'is 200 && [ "$(j .refreshToken)" != null ] && [ "$(j .refreshToken)" != "$ART1" ] && ! printf "%s" "$HDRS" | grep -qi "^set-cookie: jp_rt="'
ART2="$(j .refreshToken)"
req POST /auth/login "{\"email\":\"$AEMAIL\",\"password\":\"smoke-pass-123\",\"deviceId\":\"android-smoke\"}"
check "App 登录：响应体含 refreshToken" eval 'is 200 && [ "$(j .refreshToken)" != null ]'
ART3="$(j .refreshToken)"
req POST /auth/logout "{\"refreshToken\":\"$ART3\"}"
check "App 注销 204" eval 'is 204'
req POST /auth/refresh "{\"refreshToken\":\"$ART3\"}"
check "App 注销后该 token 失效 401" eval 'is 401 && eq .error.code REFRESH_TOKEN_INVALID'
req POST /auth/refresh "{\"refreshToken\":123}"
check "refreshToken 类型错误 → 400" eval 'is 400 && eq .error.code VALIDATION_FAILED'
EXTRA=(-H "x-client-platform: ios")
req POST /auth/refresh "{\"refreshToken\":\"$ART2\"}"
check "非法平台头 → 400" eval 'is 400 && eq .error.code VALIDATION_FAILED'
EXTRA=()

echo "== CORS"
pre() {
  curl -s -o /dev/null -D - -X OPTIONS "$BASE/auth/login" -H "Origin: $1" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: authorization,content-type,x-client-platform' | tr -d '\r'
}
H="$(pre https://localhost)"; STATUS="preflight"; BODY="$H"
check "预检放行 https://localhost（Capacitor）" eval 'printf "%s" "$H" | grep -qi "^access-control-allow-origin: https://localhost$"'
check "预检不带 Allow-Credentials" eval '! printf "%s" "$H" | grep -qi "^access-control-allow-credentials"'
check "预检允许 x-client-platform 头" eval 'printf "%s" "$H" | grep -i "^access-control-allow-headers:" | grep -qi "x-client-platform"'
H="$(pre http://tauri.localhost)"; BODY="$H"
check "预检放行 http://tauri.localhost（Tauri/Windows）" eval 'printf "%s" "$H" | grep -qi "^access-control-allow-origin: http://tauri.localhost$"'
H="$(pre https://evil.example)"; BODY="$H"
check "未知来源不返回 Allow-Origin" eval '! printf "%s" "$H" | grep -qi "^access-control-allow-origin"'
H="$(curl -s -o /dev/null -D - "$BASE/health" -H 'Origin: https://localhost' | tr -d '\r')"; BODY="$H"
check "实际请求暴露 X-Request-Id" eval 'printf "%s" "$H" | grep -i "^access-control-expose-headers:" | grep -qi "x-request-id"'

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
