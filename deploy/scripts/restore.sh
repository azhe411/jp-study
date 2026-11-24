#!/usr/bin/env bash
# 真正的灾难恢复：用备份覆盖线上库。会停 app、重建数据库、再启动。
# 用法：restore.sh <dump 文件> --yes
set -euo pipefail
source "$(dirname "$0")/lib.sh"
dump="${1:?用法: restore.sh <dump 文件> --yes}"
[ "${2:-}" = "--yes" ] || { echo "这会覆盖线上数据库。确认请追加参数 --yes"; exit 1; }
[ -s "$dump" ] || { log "备份文件不存在或为空: $dump"; exit 1; }

log "先校验备份可恢复"
"$(dirname "$0")/restore-verify.sh" "$dump"

log "停止 app，保留一份恢复前快照"
dc stop app
dc exec -T db pg_dump -U jpstudy -d jpstudy -Fc --no-owner > "$BACKUP_DIR/pre-restore-$(date +%Y%m%d-%H%M%S).dump"

log "重建数据库并恢复"
dc exec -T db sh -c "cat > /tmp/jpstudy-restore.dump" < "$dump"
dc exec -T db psql -U jpstudy -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'jpstudy' AND pid <> pg_backend_pid()" >/dev/null
dc exec -T db dropdb -U jpstudy jpstudy
dc exec -T db createdb -U jpstudy jpstudy
dc exec -T db pg_restore -U jpstudy -d jpstudy --no-owner --exit-on-error /tmp/jpstudy-restore.dump
dc exec -T db rm -f /tmp/jpstudy-restore.dump

log "启动 app"
dc start app
log "恢复完成"
