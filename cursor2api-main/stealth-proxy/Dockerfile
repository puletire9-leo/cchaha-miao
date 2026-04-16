# stealth-proxy Dockerfile
# 基于 Debian slim，安装 Chromium 及其依赖
FROM node:22-slim

WORKDIR /app

# 安装 npm 依赖
COPY package.json ./
RUN npm install --omit=dev

# 安装 Playwright Chromium 及系统依赖（字体、图形库等）
RUN npx playwright install --with-deps chromium

COPY index.js ./

# 非 root 用户运行（Chromium 需要 --no-sandbox）
ENV NODE_ENV=production

EXPOSE 3011

CMD ["node", "index.js"]
