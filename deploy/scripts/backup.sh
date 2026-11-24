#!/usr/bin/env bash
# 每日备份：pg_dump（custom 格式）→ 立即恢复到临时库校验行数 → 轮转 → 写 status.json
# 用法：backup.sh            （由 /etc/cron.d/jp-study 每日调用）
#      KEEP=30 backup.sh     （保留份数，默认 14）
set -euo pipefail
source "$(dirname "$0")/lib.sh"
KEEP="${KEEP:-14}"
mkdir -p "$BACKUP_DIR"
# 备份含密码哈希：目录只许穿行（app 容器需按名读取 status.json），备份文件仅 root 可读
chmod 711 "$BACKUP_DIR"
umask 077

ts="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/jpstudy-$ts.dump"
log "pg_dump -> $out"
dc exec -T db pg_dump -U jpstudy -d jpstudy -Fc --no-owner > "$out.tmp"
mv "$out.tmp" "$out"
size="$(stat -c %s "$out")"
backup_at="$(date -u +%FT%TZ)"

verify_ok=false
if "$(dirname "$0")/restore-verify.sh" "$out"; then verify_ok=true; fi
verified_at="$(date -u +%FT%TZ)"

# 轮转：只保留最新 KEEP 份
ls -1t "$BACKUP_DIR"/jpstudy-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
retained="$(ls -1 "$BACKUP_DIR"/jpstudy-*.dump 2>/dev/null | wc -l)"

cat > "$BACKUP_DIR/status.json.tmp" <<JSON
{"lastBackupAt":"$backup_at","lastBackupSizeBytes":$size,"lastVerifiedAt":"$verified_at","lastVerifyOk":$verify_ok,"retainedCount":$retained,"lastFile":"$(basename "$out")"}
JSON
mv "$BACKUP_DIR/status.json.tmp" "$BACKUP_DIR/status.json"
chmod 644 "$BACKUP_DIR/status.json"
log "done: size=${size}B verify=$verify_ok retained=$retained"
$verify_ok
