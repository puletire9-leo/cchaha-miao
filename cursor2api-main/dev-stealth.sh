#!/bin/sh
# 本地开发：先启动 stealth-proxy，等就绪后再启动 cursor2api

# 启动 stealth-proxy（后台）
node stealth-proxy/index.js &
STEALTH_PID=$!

# 等待就绪
echo "[dev-stealth] Waiting for stealth-proxy to be ready..."
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:3011/health 2>/dev/null | grep -q '"ok"'; then
        echo "[dev-stealth] stealth-proxy is ready!"
        break
    fi
    sleep 2
done

# 捕获退出信号，同时杀掉 stealth-proxy
trap "kill $STEALTH_PID 2>/dev/null; exit 0" TERM INT

# 启动 cursor2api
STEALTH_PROXY=http://127.0.0.1:3011 npx tsx watch src/index.ts
