#!/usr/bin/env bash
# 一次性主机准备（Debian 11，root）：2G swap + Docker 官方 apt 源 + compose 插件 + jq + 备份 cron。
# 只做"新增"，不碰 Caddy、80/443、/var/www 与既有 crontab。可重复执行。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! swapon --show | grep -q /swapfile; then
  echo "[swap] 创建 2G /swapfile"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-jpstudy-swap.conf
fi

if ! command -v docker >/dev/null; then
  echo "[docker] 安装官方 apt 源"
  apt-get update -qq
  # bullseye-security 镜像常有索引与包不同步（404），因此一律从主仓库取依赖、不引入 gnupg
  apt-get install -y -qq -t bullseye ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends -t bullseye docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  # 日志轮转，免得小磁盘被容器日志吃掉
  [ -f /etc/docker/daemon.json ] || echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
  systemctl enable --now docker
  systemctl restart docker
fi
command -v jq >/dev/null || apt-get install -y -qq -t bullseye jq

mkdir -p "$ROOT/backups"
cat > /etc/cron.d/jp-study <<CRON
# jp-study 每日备份（服务器时区 Asia/Shanghai）
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root $ROOT/deploy/scripts/backup.sh >> $ROOT/backups/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/jp-study
echo "[ok] swap=$(swapon --show --noheadings | awk '{print $3}') docker=$(docker --version | awk '{print $3}') compose=$(docker compose version --short)"
