#!/bin/sh
# Ночной бэкап БД «Своих» с ротацией 14 дней.
# Ставится в cron на сервере (см. README/отчёт деплоя):
#   17 3 * * * /home/timur-marii8st/svoi/ops/backup.sh >> /home/timur-marii8st/backups/backup.log 2>&1
set -e

PROJECT_DIR=/home/timur-marii8st/svoi
BACKUP_DIR=/home/timur-marii8st/backups
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"

docker compose exec -T db pg_dump -U corenting corenting \
  | gzip > "$BACKUP_DIR/svoi-$(date +%Y%m%d-%H%M).sql.gz"

# проверить, что дамп не пустой (иначе ротация оставит только битые файлы)
if [ ! -s "$BACKUP_DIR/svoi-$(date +%Y%m%d-%H%M).sql.gz" ]; then
  echo "backup FAILED: empty dump" >&2
  exit 1
fi

find "$BACKUP_DIR" -name 'svoi-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
