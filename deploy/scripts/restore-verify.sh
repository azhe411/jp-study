#!/usr/bin/env bash
# 可验证恢复：把备份恢复到临时库 jpstudy_verify，逐表比对行数，然后删除临时库。
# 期望行数取自备份文件本身（每个 COPY 段的数据行数），与线上数据是否变化无关。
# 用法：restore-verify.sh <dump 文件>      退出码 0 = 校验通过
set -euo pipefail
source "$(dirname "$0")/lib.sh"
dump="${1:?用法: restore-verify.sh <dump 文件>}"
[ -s "$dump" ] || { log "备份文件不存在或为空: $dump"; exit 1; }
VDB=jpstudy_verify
TMP=/tmp/jpstudy-verify.dump

cleanup() {
  dc exec -T db dropdb -U jpstudy --if-exists "$VDB" >/dev/null 2>&1 || true
  dc exec -T db rm -f "$TMP" >/dev/null 2>&1 || true
}
trap cleanup EXIT

dc exec -T db sh -c "cat > $TMP" < "$dump"

# 1) 期望行数：解析备份里的 COPY 段
expected="$(dc exec -T db pg_restore -f - --data-only "$TMP" | awk '
  /^COPY public\./ { split($2, a, "."); t = a[2]; n = 0; inblk = 1; next }
  inblk && /^\\.$/ { print t, n; inblk = 0; next }
  inblk { n++ }
')"
[ -n "$expected" ] || { log "备份中没有任何数据表"; exit 1; }

# 2) 恢复到临时库
dc exec -T db dropdb -U jpstudy --if-exists "$VDB"
dc exec -T db createdb -U jpstudy "$VDB"
dc exec -T db pg_restore -U jpstudy -d "$VDB" --no-owner --exit-on-error "$TMP"

# 3) 逐表比对
fail=0
# 注意：循环体里的 docker exec 必须 </dev/null，否则会吞掉 while 的输入，只校验到第一张表
checked=0
printf '%-22s %10s %10s  %s\n' TABLE EXPECTED RESTORED RESULT
while read -r table want; do
  got="$(dc exec -T db psql -U jpstudy -d "$VDB" -tAc "SELECT count(*) FROM public.\"$table\"" </dev/null)"
  if [ "$got" = "$want" ]; then mark=OK; else mark=MISMATCH; fail=1; fi
  printf '%-22s %10s %10s  %s\n' "$table" "$want" "$got" "$mark"
  checked=$((checked + 1))
done <<< "$expected"

# 兜底：恢复出的表数、实际比对的表数，都必须等于备份里的数据段数
want_tables="$(printf '%s\n' "$expected" | wc -l)"
got_tables="$(dc exec -T db psql -U jpstudy -d "$VDB" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" </dev/null)"
if [ "$want_tables" = "$got_tables" ] && [ "$checked" = "$want_tables" ]; then mark=OK; else mark=MISMATCH; fail=1; fi
printf '%-22s %10s %10s  %s\n' '(table count)' "$want_tables" "$got_tables" "$mark"

if [ "$fail" -eq 0 ]; then log "restore verify OK: $(basename "$dump")"; else log "restore verify FAILED: $(basename "$dump")"; fi
exit "$fail"
