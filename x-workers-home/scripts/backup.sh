#!/usr/bin/env bash
# PostgreSQL 每日备份脚本：pg_dump 自定义格式，保留最近 14 份。
#
# 手动执行：bash scripts/backup.sh
# cron（每天 03:15）：
#   15 3 * * * cd /opt/x-workers-home && bash scripts/backup.sh >> /var/log/xwh-backup.log 2>&1
#
# 可用环境变量覆盖：
#   BACKUP_DIR    备份目录（默认 <repo>/backups）
#   BACKUP_RETAIN 保留份数（默认 14）
#   COMPOSE_FILE  编排文件（默认 docker-compose.prod.yml）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETAIN="${BACKUP_RETAIN:-14}"

if [ ! -f "$ENV_FILE" ]; then
  echo "错误：未找到 $ENV_FILE（请先 cp deploy/.env.production.example .env.production）" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/xwh-$STAMP.dump"

# 在 postgres 容器内读取 POSTGRES_USER/POSTGRES_DB，避免依赖宿主机 shell 环境。
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$FILE"; then
  echo "备份失败：pg_dump 退出异常" >&2
  rm -f "$FILE"
  exit 1
fi

if [ ! -s "$FILE" ]; then
  echo "备份失败：$FILE 为空" >&2
  rm -f "$FILE"
  exit 1
fi

# 只保留最近 $RETAIN 份（文件名按时间排序）。
ls -1t "$BACKUP_DIR"/xwh-*.dump 2>/dev/null | tail -n +"$((RETAIN + 1))" | xargs -r rm -f

echo "$(date '+%F %T') 备份完成：$FILE ($(du -h "$FILE" | cut -f1))"
