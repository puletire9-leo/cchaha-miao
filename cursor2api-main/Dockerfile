# ==== Stage 1: 构建阶段 (Builder) ====
FROM node:22-alpine AS builder

# 设置工作目录
WORKDIR /app

# 仅拷贝包配置并安装所有依赖项（利用 Docker 缓存层）
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝项目源代码并执行 TypeScript 编译
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ==== Stage 2: 生产运行阶段 (Runner) ====
# 使用 slim (Debian) 以支持 Playwright Chromium（alpine 不兼容）
FROM node:22-slim AS runner

WORKDIR /app

# 设置为生产环境
ENV NODE_ENV=production

# 增大 Node.js 堆内存上限，防止日志文件过大时加载 OOM（tesseract.js / js-tiktoken 初始化也有一定内存需求）
ENV NODE_OPTIONS="--max-old-space-size=4096"

# 安装 wget（用于 entrypoint 健康检查）
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

# 出于安全考虑，避免使用 root 用户运行服务（stealth 模式下使用 --no-sandbox）
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs cursor

# ── cursor2api 主服务依赖 ──
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

# 从 builder 阶段拷贝编译后的产物
COPY --from=builder --chown=cursor:nodejs /app/dist ./dist

# 拷贝前端静态资源（日志查看器 Web UI）
COPY --chown=cursor:nodejs public ./public

# ── stealth-proxy 内置（可选，通过 ENABLE_STEALTH=true 启用） ──
# 将 Playwright 浏览器安装到固定路径，避免 root 构建 vs cursor 运行时路径不一致
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
COPY stealth-proxy/package.json ./stealth-proxy/
RUN cd stealth-proxy && npm install --omit=dev && npm cache clean --force
# 安装 Playwright Chromium 及系统依赖（字体、图形库等）
RUN cd stealth-proxy && npx playwright install --with-deps chromium
# 授权 cursor 用户访问浏览器文件
RUN chown -R cursor:nodejs /app/.playwright-browsers
COPY stealth-proxy/index.js ./stealth-proxy/

# 创建日志目录并授权
RUN mkdir -p /app/logs && chown cursor:nodejs /app/logs

# 拷贝启动脚本
COPY --chown=cursor:nodejs start.sh ./
RUN chmod +x start.sh

# 注意：config.yaml 不打包进镜像，通过 docker-compose volumes 挂载
# 如果未挂载，服务会使用内置默认值 + 环境变量

# 切换到非 root 用户
USER cursor

# 声明对外暴露的端口和持久化卷
EXPOSE 3010
VOLUME ["/app/logs"]

# 启动服务（通过 start.sh 统一管理 stealth-proxy + cursor2api）
CMD ["./start.sh"]
