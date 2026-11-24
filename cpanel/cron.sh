#!/bin/bash
# Script para cron de cPanel (Hostinger). Súbalo a ~/helpdesk/cron.sh y dele permisos: chmod 700 ~/helpdesk/cron.sh
# Uso: cron.sh sync | cron.sh sla
APP_URL="https://TU-APP.vercel.app"
CRON_SECRET="PEGUE_AQUI_EL_CRON_SECRET"
JOB="${1:-sync}"
curl -fsS --max-time 90 -H "Authorization: Bearer ${CRON_SECRET}" "${APP_URL}/api/cron/${JOB}" \
  >> "$HOME/helpdesk/cron-${JOB}.log" 2>&1
echo "" >> "$HOME/helpdesk/cron-${JOB}.log"
# Mantener el log pequeño
tail -n 500 "$HOME/helpdesk/cron-${JOB}.log" > "$HOME/helpdesk/cron-${JOB}.tmp" && mv "$HOME/helpdesk/cron-${JOB}.tmp" "$HOME/helpdesk/cron-${JOB}.log"
