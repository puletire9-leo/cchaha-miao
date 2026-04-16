# cursor2api Vue3 日志 UI

基于 Vue3 + Vite + TypeScript 构建的日志查看与配置前端，挂载在 `/vuelogs` 路由下。

## 技术栈

- Vue 3.5 + Pinia 状态管理
- Vite 6 构建工具
- TypeScript
- highlight.js（代码高亮）
- marked（Markdown 渲染）

## 目录结构

```
vue-ui/
├── src/
│   ├── App.vue                  # 根组件
│   ├── main.ts                  # 入口
│   ├── api.ts                   # API 请求封装
│   ├── types.ts                 # 类型定义
│   ├── components/
│   │   ├── LoginPage.vue        # 登录页
│   │   ├── AppHeader.vue        # 顶部导航（含配置按钮）
│   │   ├── LogList.vue          # 日志列表
│   │   ├── RequestList.vue      # 请求列表（支持后端过滤和分页）
│   │   ├── DetailPanel.vue      # 请求详情面板
│   │   ├── PayloadView.vue      # Payload 查看
│   │   ├── PhaseTimeline.vue    # 阶段时间线
│   │   └── ConfigDrawer.vue     # 配置抽屉（热重载配置）
│   ├── composables/
│   │   └── useSSE.ts            # SSE 实时推送
│   └── stores/
│       ├── auth.ts              # 登录状态
│       ├── logs.ts              # 日志数据
│       ├── stats.ts             # 统计数据
│       └── config.ts            # 配置状态
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 本地开发

```bash
# 同时启动后端（项目根目录）
npm run dev

# 启动前端开发服务器（vue-ui 目录，默认 http://localhost:5173）
cd vue-ui && npm install && npm run dev
```

前端开发服务器会自动将 `/api` 请求代理到 `http://localhost:3010`。

## 构建

```bash
cd vue-ui && npm run build
```

产物输出到项目根目录的 `public/vue/`，后端通过 `/vuelogs` 路由提供服务。

> **重要**：Docker 镜像打包前必须先执行此构建步骤，否则容器内将缺少前端静态资源。

## Docker 部署

```bash
# 1. 准备配置文件
cp config.yaml.example config.yaml

# 2. 构建前端
cd vue-ui && npm install && npm run build && cd ..

# 3. 构建并启动容器
docker compose up -d --build

# 4. 访问日志 UI
open http://localhost:3010/vuelogs
```

**注意事项：**

- `config.yaml` 挂载时**不能**加 `:ro` 只读标志，否则配置抽屉无法保存
- 如遇到 `EACCES: permission denied` 写入权限错误，需设置文件权限：
  ```bash
  chmod 666 config.yaml
  ```

## 配置抽屉

点击顶部右侧的 **⚙ 配置** 按钮可打开配置面板。大部分配置保存后通过 fs.watch 热重载，下一次请求即生效，无需重启。

| 分组 | 字段 | 说明 |
|------|------|------|
| 基础 | `cursor_model` | 使用的 Cursor 模型 |
| 基础 | `timeout` | 请求超时（秒） |
| 基础 | `max_auto_continue` | 自动续写次数 |
| 基础 | `max_history_messages` | 历史消息条数上限（建议改用 max_history_tokens） |
| 基础 | `max_history_tokens` | 历史消息 token 数上限（推荐），默认 150000，参考值 130000~170000 |
| 功能 | `thinking.enabled` | Thinking 模式（跟随客户端/强制关闭/强制开启） |
| 功能 | `sanitize_response` | 响应内容清洗 |
| 历史压缩 | `compression.*` | 压缩开关、级别、保留条数等 |
| 工具处理 | `tools.*` | Schema 模式、透传/禁用 |
| 日志持久化 | `logging.db_enabled` / `logging.db_path` | SQLite 持久化（推荐） |
| 日志持久化 | `logging.file_enabled` / `logging.dir` / `logging.persist_mode` | JSONL 文件持久化 |
| 高级 | `refusal_patterns` | 自定义拒绝检测正则 |

## 与原有日志页面的关系

| 路由 | 实现 | 鉴权方式 |
|------|------|----------|
| `/logs` | 原生 HTML（`public/logs.html`）| 服务端 cookie 鉴权 |
| `/vuelogs` | 本 Vue3 应用 | 前端登录页处理 |

两者独立共存，互不影响。
