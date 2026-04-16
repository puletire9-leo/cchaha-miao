#!/bin/bash
set -e

echo "=========================================="
echo "    Cursor2API Linux 一键部署服务包"
echo "=========================================="
echo "正在检测 Linux 环境并开始部署..."

# 1. 检查并安装 Node.js (v20)
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[环境检测] 未找到 Node.js，准备开始安装 (基于 NodeSource，适用于 Ubuntu/Debian/CentOS)..."
    if ! command -v curl >/dev/null 2>&1; then
        echo "正在安装基础工具 curl..."
        if command -v apt-get >/dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y curl
        elif command -v yum >/dev/null 2>&1; then
            sudo yum install -y curl
        fi
    fi
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y nodejs
    elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y nodejs
    fi
    echo "[环境检测] Node.js 安装完成: $(node -v) / npm: $(npm -v)"
else
    echo "[环境检测] Node.js 已安装: $(node -v) / npm: $(npm -v)"
fi

# 2. 检查并安装 PM2
if ! command -v pm2 >/dev/null 2>&1; then
    echo "[环境检测] 未找到 pm2，准备通过 npm 自动安装全局依赖..."
    sudo npm install -g pm2
    echo "[环境检测] pm2 安装完成: $(pm2 -v)"
else
    echo "[环境检测] pm2 已安装: $(pm2 -v)"
fi

# 3. 安装依赖与构建
echo "[项目构建] 开始安装生产级项目依赖..."
npm install

echo "[项目构建] 正在编译 TypeScript 代码 (npm run build)..."
npm run build

# 4. 配置 PM2 进程
echo "[项目部署] 正在清理旧的 PM2 进程（如果有的话）..."
pm2 delete cursor2api 2>/dev/null || true

# 5. 启动项目
echo "[项目部署] 使用 PM2 守护进程启动服务..."
# 设置生产环境变量
NODE_ENV=production pm2 start dist/index.js --name "cursor2api" 

# 6. 保存并且处理自启
echo "[项目部署] 配置 PM2 保存以便意外重启后恢复..."
pm2 save

echo "=========================================="
echo "部署与运行全部完成！🚀"
echo ""
echo "常用 PM2 管理命令："
echo "▶ 查看运行日志：  pm2 logs cursor2api"
echo "▶ 查看进程监控：  pm2 monit"
echo "▶ 重启服务：      pm2 restart cursor2api"
echo "=========================================="
