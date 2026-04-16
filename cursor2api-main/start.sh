#!/bin/sh
set -e

# ==================== All-in-One Entrypoint ====================
# 当 ENABLE_STEALTH=true 时，先启动内置 stealth-proxy，再启动 cursor2api
# 否则仅启动 cursor2api

if [ "$ENABLE_STEALTH" = "true" ]; then
    echo "[Entrypoint] ENABLE_STEALTH=true, starting stealth-proxy on port 3011..."

    # 启动 stealth-proxy（后台运行，强制端口 3011 避免与主服务 PORT 冲突）
    PORT=3011 node /app/stealth-proxy/index.js &
    STEALTH_PID=$!

    # 等待 stealth-proxy 就绪（最多 60 秒，Chromium 首次启动较慢）
    echo "[Entrypoint] Waiting for stealth-proxy to be ready..."
    READY=false
    for i in $(seq 1 30); do
        if wget -qO- http://127.0.0.1:3011/health 2>/dev/null | grep -q '"ok"'; then
            READY=true
            break
        fi
        sleep 2
    done

    if [ "$READY" = "true" ]; then
        echo "[Entrypoint] stealth-proxy is ready!"
    else
        echo "[Entrypoint] WARNING: stealth-proxy did not become ready in 60s, starting cursor2api anyway..."
    fi

    # 自动设置 STEALTH_PROXY 环境变量（如果用户未手动指定）
    if [ -z "$STEALTH_PROXY" ]; then
        export STEALTH_PROXY="http://127.0.0.1:3011"
    fi

    # 捕获信号，优雅退出时同时终止 stealth-proxy
    trap "kill $STEALTH_PID 2>/dev/null; exit 0" TERM INT

    # 启动 cursor2api（前台）
    echo "[Entrypoint] Starting cursor2api with STEALTH_PROXY=$STEALTH_PROXY"
    node /app/dist/index.js &
    MAIN_PID=$!

    # 等待任一子进程退出
    wait $MAIN_PID $STEALTH_PID 2>/dev/null || true
    exit 0
else
    # 普通模式：直接启动 cursor2api
    exec node /app/dist/index.js
fi
