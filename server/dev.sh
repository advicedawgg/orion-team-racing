#!/bin/bash
# (re)start the OTR game server on the hub for development: pidfile-scoped (never pkill -f), logs to _scratch/.
# Extra env passes through, e.g.  NET_LAG_MS=100 NET_JITTER_MS=30 NET_LOSS=0.05 LAPS=1 server/dev.sh
cd "$(dirname "$0")"
PID=../_scratch/otr-server.pid
LOG=${LOG:-../_scratch/otr-server.log}
mkdir -p ../_scratch
if [ -f $PID ] && kill -0 "$(cat $PID)" 2>/dev/null; then kill "$(cat $PID)"; sleep 0.5; fi
PORT=${PORT:-8955} UDP_PORT=${UDP_PORT:-8956} setsid node index.js > "$LOG" 2>&1 &
echo $! > $PID
for i in $(seq 1 30); do curl -sf "localhost:${PORT:-8955}/health" > /dev/null && { echo "OTR server up (pid $(cat $PID)) — log $LOG"; exit 0; }; sleep 0.3; done
echo "server did not come up; see $LOG"; tail -20 "$LOG"; exit 1
