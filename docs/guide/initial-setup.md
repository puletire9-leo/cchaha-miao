# Claude Code Haha 初始配置指南

> 本指南帮助你从零开始配置 cc-haha，连接到 MiniMax M2.5 或其他 API 提供商

---

## 一、环境要求

### 1.1 必需软件

| 软件 | 版本 | 用途 |
|------|------|------|
| [Bun](https://bun.sh) | 最新版 | 运行时和包管理 |
| Git | 任意 | 版本控制 |

### 1.2 安装 Bun

```bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# macOS/Linux
curl -fsSL https://bun.sh/install | bash
```

验证安装：
```bash
bun --version
```

---

## 二、项目初始化

### 2.1 克隆项目

```bash
git clone <repository-url> cc-haha
cd cc-haha
```

### 2.2 安装依赖

```bash
bun install
```

---

## 三、API 配置

### 3.1 方案一：MiniMax 官方 API（推荐）

#### 获取 API Key

1. 访问 [MiniMax 开放平台](https://platform.minimaxi.com)
2. 注册账号并完成实名认证
3. 创建应用并获取 API Key

#### 配置环境变量

创建 `.env` 文件：

```bash
# MiniMax 官方 API 配置
ANTHROPIC_AUTH_TOKEN=your_minimax_api_key_here
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7

# 可选：指定不同场景的默认模型
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7

# API 超时时间（毫秒）
API_TIMEOUT_MS=300000

# 禁用遥测（推荐）
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### 3.2 方案二：通过 liumiao 代理

如果你使用 liumiao 等本地代理工具：

```bash
# liumiao 本地代理配置
ANTHROPIC_AUTH_TOKEN=liumiao
ANTHROPIC_BASE_URL=http://localhost:9019
ANTHROPIC_MODEL=minimax-m2.5-free

# 其他配置同上
API_TIMEOUT_MS=300000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

### 3.3 方案三：OpenRouter（多模型聚合）

```bash
# OpenRouter 配置
ANTHROPIC_AUTH_TOKEN=sk-or-v1-your-openrouter-key
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
ANTHROPIC_MODEL=anthropic/claude-3.5-sonnet

# 其他配置同上
API_TIMEOUT_MS=300000
DISABLE_TELEMETRY=1
```

---

## 四、启动方式

### 4.1 Windows PowerShell

```powershell
# 方式一：使用 bun 直接运行
bun --env-file=.env ./src/entrypoints/cli.tsx

# 方式二：使用 Git Bash
./bin/claude-haha
```

### 4.2 macOS / Linux

```bash
# 使用启动脚本
./bin/claude-haha

# 或直接运行
bun --env-file=.env ./src/entrypoints/cli.tsx
```

---

## 五、首次启动配置

### 5.1 主题选择

启动后会显示主题选择界面：

```
❯ 1. Dark mode
  2. Light mode
  3. Dark mode (colorblind-friendly)
  4. Light mode (colorblind-friendly)
  5. Dark mode (ANSI colors only)
  6. Light mode (ANSI colors only)
```

按 `Enter` 选择默认的 **Dark mode**，或使用方向键切换。

### 5.2 终端设置

接下来会询问：

```
❯ 1. Yes, use recommended settings
    2. No, maybe later with /terminal-setup
```

选择 **Yes** 使用推荐设置。

### 5.3 验证连接

进入主界面后，输入测试消息：

```
你好
```

如果配置正确，MiniMax M2.5 会回复你。

---

## 六、常用配置项

### 6.1 环境变量完整列表

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `ANTHROPIC_AUTH_TOKEN` | ✅ | - | API 认证令牌 |
| `ANTHROPIC_BASE_URL` | ✅ | - | API 基础 URL |
| `ANTHROPIC_MODEL` | ❌ | - | 默认模型 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | ❌ | - | Sonnet 场景默认模型 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | ❌ | - | Haiku 场景默认模型 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | ❌ | - | Opus 场景默认模型 |
| `API_TIMEOUT_MS` | ❌ | 60000 | API 超时时间（毫秒） |
| `DISABLE_TELEMETRY` | ❌ | - | 禁用遥测（设为 1） |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | ❌ | - | 禁用非必要流量（设为 1） |
| `CLAUDE_CODE_DEBUG_API` | ❌ | - | 调试 API 请求（设为 1） |

### 6.2 MCP 服务器配置（可选）

创建 `mcp.json` 文件：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
    }
  }
}
```

---

## 七、故障排查

### 7.1 401 Unauthorized

**现象**：
```
401 {"error":{"type":"authentication_error","message":"invalid api key"}}
```

**解决**：
- 检查 `ANTHROPIC_AUTH_TOKEN` 是否正确
- 确认 API Key 未过期
- 如果使用代理，确认代理配置正确

### 7.2 连接超时

**现象**：
```
API_TIMEOUT_MS=60000ms, try increasing it
```

**解决**：
- 增加 `API_TIMEOUT_MS` 值
- 检查网络连接
- 确认 API 服务可访问

### 7.3 模型不可用

**现象**：
```
Model not found or not available
```

**解决**：
- 检查 `ANTHROPIC_MODEL` 值是否正确
- 确认账户有权限使用该模型

---

## 八、高级配置

### 8.1 禁用自动记忆

```bash
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
```

### 8.2 自定义记忆目录

在 `settings.json` 中：

```json
{
  "autoMemoryDirectory": "~/my-claude-memories"
}
```

### 8.3 精简模式（无 TUI）

```bash
# 无头模式
./bin/claude-haha -p "你的问题"

# 或设置环境变量
CLAUDE_CODE_SIMPLE=1
```

---

## 九、常用命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有可用命令 |
| `/exit` | 退出程序 |
| `/memory` | 编辑记忆文件 |
| `/remember` | 审查和整理记忆 |
| `/terminal-setup` | 重新配置终端 |
| `/cost` | 查看 API 使用成本 |

---

## 十、配置示例汇总

### 完整 `.env` 示例（MiniMax 官方）

```bash
# ============================================================
# MiniMax 官方 API 配置
# ============================================================

# API 认证
ANTHROPIC_AUTH_TOKEN=sk-your-actual-minimax-key

# API 端点
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic

# 模型配置
ANTHROPIC_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_SONNET_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_HAIKU_MODEL=MiniMax-M2.7
ANTHROPIC_DEFAULT_OPUS_MODEL=MiniMax-M2.7

# 超时设置（5分钟）
API_TIMEOUT_MS=300000

# 隐私设置
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# 调试（可选）
# CLAUDE_CODE_DEBUG_API=1
```

### 完整 `.env` 示例（liumiao 代理）

```bash
# ============================================================
# liumiao 代理配置
# ============================================================

ANTHROPIC_AUTH_TOKEN=liumiao
ANTHROPIC_BASE_URL=http://localhost:9019
ANTHROPIC_MODEL=minimax-m2.5-free
ANTHROPIC_DEFAULT_SONNET_MODEL=minimax-m2.5-free
ANTHROPIC_DEFAULT_HAIKU_MODEL=minimax-m2.5-free
ANTHROPIC_DEFAULT_OPUS_MODEL=minimax-m2.5-free
API_TIMEOUT_MS=300000
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

---

## 十一、下一步

配置完成后，你可以：

1. **开始对话**：直接输入问题或指令
2. **查看帮助**：输入 `/help`
3. **管理记忆**：使用 `/memory` 命令
4. **查看成本**：使用 `/cost` 命令

---

*配置指南版本：1.0*
*更新日期：2026-04-14*
