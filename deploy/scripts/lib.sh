# 公共变量：以脚本位置推出项目根，不依赖当前目录
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/docker-compose.yml"
ENV_FILE="$ROOT/deploy/.env"
BACKUP_DIR="$ROOT/backups"
dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
