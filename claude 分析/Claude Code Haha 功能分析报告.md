# Claude Code Haha 功能分析报告

> 项目地址：https://github.com/NanmiCoder/cc-haha
> 分析日期：2026-04-14

---

## 一、项目概述

Claude Code Haha 是基于 Claude Code 泄露源码修复的**本地可运行版本**，支持接入任意 Anthropic 兼容 API（如 MiniMax、OpenRouter 等）。

### 1.1 核心理念

原始泄露源码无法直接运行。本仓库修复了启动链路中的多个阻塞问题，使完整的 Ink TUI 交互界面可以在本地工作。

### 1.2 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Bun |
| UI 框架 | Ink (React in terminal) |
| 语言 | TypeScript |
| API 协议 | Anthropic 兼容 |

### 1.3 项目目录结构

```
cc-haha/
├── src/
│   ├── assistant/       # 助手模块
│   ├── bootstrap/    # 启动引导
│   ├── bridge/      # 桥接层
│   ├── cli/         # CLI 入口
│   ├── commands/    # 命令定义
│   ├── components/ # UI 组件
│   ├── hooks/      # React hooks
│   ├── ink/       # Ink TUI
│   ├── skills/    # Skills 系统
│   ├── services/  # 服务层
│   ├── tools/     # 工具系统
│   └── ...
├── docs/           # 文档
├── runtime/        # 运行时（Python bridge）
└── bin/           # 编译后的二进制
```

---

## 二、核心功能详解

### 2.1 记忆系统（Memory System）

> 官方文档：[docs/memory/01-usage-guide.md](./docs/memory/01-usage-guide.md)

记忆系统是一套**基于文件的持久化知识库**，让 Claude 能够跨越多次对话，持续积累对你和你的项目的理解。

#### 1. 四种记忆类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **User** | 用户画像 | "你是数据科学家，关注日志系统" |
| **Feedback** | 行为反馈 | "不要 mock 数据库" |
| **Project** | 项目动态 | "周四后冻结非关键合并" |
| **Reference** | 外部引用 | "Bug 跟踪在 Linear INGEST 项目" |

#### 2. 触发保存方式

| 方式 | 说明 |
|------|------|
| **自动提取** | Claude 在每次对话结束时自动分析，提取值得记住的信息（最常用） |
| **显式要求** | 直接告诉 Claude "记住这个" |
| **/memory 命令** | 手动编辑记忆文件 |
| **/remember 命令** | 记忆审查技能，提议提升记忆条目 |

#### 3. 存储结构

```
~/.claude/projects/{项目路径哈希}/
└── memory/
    ├── MEMORY.md              # 索引文件（始终加载到上下文）
    ├── user_role.md           # 用户画像
    ├── feedback_testing.md   # 行为反馈
    ├── project_*.md          # 项目动态
    └── reference_*.md        # 外部引用
```

#### 4. AutoDream 机制

当满足以下条件时，Claude 会在后台静默启动"做梦"子智能体进行记忆整合：
- 距上次整合 >= 24 小时
- 期间积累了 >= 5 个会话

---

### 2.2 多 Agent 系统

> 官方文档：[docs/agent/01-usage-guide.md](./docs/agent/01-usage-guide.md)

多 Agent 系统是一套**智能任务编排框架**，让主代理能够生成多个专业化的子代理，各自独立执行任务，最终将结果汇总。

#### 1. 六种内置 Agent

| Agent | 读写 | 工具池 | 模型 | 用途 |
|-------|------|--------|------|------|
| **general-purpose** | 读写 | 全部 | 继承 | 通用任务 |
| **Explore** | 只读 | 搜索+读取 | Haiku | 快速探索 |
| **Plan** | 只读 | 搜索+读取 | 继承 | 架构规划 |
| **verification** | 只读 | 搜索+读取 | 继承 | 独立验证 |
| **claude-code-guide** | 只读 | 搜索+网络 | Haiku | 文档指南 |
| **statusline-setup** | 读写 | Read+Edit | Sonnet | 状态栏配置 |

#### 2. Agent 使用方式

```typescript
// 基本用法
Agent({
  description: "分析错误日志",
  prompt: "读取 logs/ 下最近的错误日志...",
  subagent_type: "Explore"
})

// 后台异步执行
Agent({
  description: "全面代码审查",
  prompt: "审查 src/ 下所有文件...",
  run_in_background: true
})

// Worktree 隔离
Agent({
  description: "实验性重构",
  prompt: "尝试将模块 X 重构为...",
  isolation: "worktree"
})
```

#### 3. Agent Teams 协作

```typescript
// 创建团队
TeamCreate({ team_name: "feature-team", description: "开发用户认证功能" })

// 添加成员
Agent({ description: "前端开发", name: "frontend-dev", team_name: "feature-team" })

// 队友通信
SendMessage({ to: "frontend-dev", message: "API 接口已就绪..." })

// 请求关停
SendMessage({ to: "frontend-dev", message: { type: "shutdown_request" } })
TeamDelete()
```

---

### 2.3 Skills 系统

> 官方文档：[docs/skills/01-usage-guide.md](./docs/skills/01-usage-guide.md)

Skills 是 Claude Code 的**可扩展能力插件系统**，用 Markdown 文件定义专属的自动化工作流。

#### 1. 六种 Skill 来源

| 来源 | 路径 | 优先级 |
|------|------|--------|
| **Bundled** | 编译到 CLI 中 | 1 (最高) |
| **Managed** | `<managed-path>/.claude/skills/` | 2 |
| **User** | `~/.claude/skills/` | 3 |
| **Project** | `.claude/skills/` | 4 |
| **Plugin** | 插件提供 | 5 |
| **MCP** | MCP 服务器 | 6 (最低) |

#### 2. 当前内置 Skills

| Skill | 说明 | 条件 |
|-------|------|------|
| `/verify` | 验证代码变更 | — |
| `/debug` | 调试助手 | — |
| `/simplify` | 代码简化审查 | — |
| `/remember` | 记忆管理 | 需启用 auto-memory |
| `/batch` | 批量处理 | — |
| `/stuck` | 卡住时求助 | — |
| `/skillify` | 创建新 Skill | — |
| `/keybindings` | 自定义快捷键 | — |
| `/loop` | 定时循环任务 | AGENT_TRIGGERS |
| `/schedule` | 远程代理调度 | AGENT_TRIGGERS_REMOTE |
| `/dream` | 自动记忆整理 | KAIROS |

#### 3. Skill 定义格式

```yaml
---
name: 我的技能
description: 这个技能做什么
user-invocable: true       # 用户能否通过 /skill-name 调用
context: inline          # 执行上下文：inline 或 fork
allowed-tools: "Bash, Read"  # 允许的工具
paths: "src/**/*.ts"    # 条件激活
hooks:                 # 生命周期钩子
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - command: "echo 'Before bash'"
---

# Skill 正文内容
这里是 Markdown 格式的提示词。
```

#### 4. 调用方式

```
// 用户斜杠命令
> /commit
> /verify

// 模型自动调用
Agent 调用 superpowers:code-reviewer

// 嵌套调用
/verify → 内部调用 → /simplify
```

---

### 2.4 Channel 系统

> 官方文档：[docs/channel/01-channel-system.md](./docs/channel/01-channel-system.md)

Channel 是 Claude Code 的 **IM 集成系统**，允许用户通过 Telegram、飞书、Discord 等即时通讯平台远程控制 Agent。

#### 1. 六层访问控制

| 层级 | 检查内容 | 阻断原因 |
|------|----------|----------|
| 1 | 能力声明 | 未声明 `claude/channel` capability |
| 2 | 运行时开关 | `tengu_harbor` feature 关闭 |
| 3 | OAuth 认证 | 未通过 claude.ai 认证 |
| 4 | 组织策略 | Team/Enterprise 未启用 channels |
| 5 | 会话白名单 | 未在 `--channels` 列表中 |
| 6 | Marketplace 验证 | 插件不在白名单中 |

#### 2. 消息协议

```xml
<!-- 入站：IM → Agent -->
<channel source="plugin:telegram:tg" user="alice" chat_id="123456">
帮我看看 main.ts 有什么问题
</channel>

<!-- 出站：Agent → IM -->
<!-- 使用 reply/react/edit_message 工具 -->
```

#### 3. 权限中继系统

当 Agent 触发权限确认时，用户可以在 IM 中直接审批：

```
# 用户回复格式
yes tbxkq    # 允许
no tbxkq     # 拒绝

# 5字母 request_id 由短 ID 生成器产生
```

---

### 2.5 Computer Use 桌面控制

> 官方文档：[docs/features/computer-use.md](./docs/features/computer-use.md)

Computer Use 让 AI 模型能够**直接控制电脑**——截屏、移动鼠标、点击按钮、输入文字。

#### 1. 支持的操作（共 24 个工具）

| 类别 | 工具 |
|------|------|
| 截屏 | `screenshot`、`zoom` |
| 鼠标 | `left_click`、`right_click`、`double_click`、`triple_click`、`left_click_drag`、`mouse_move`、`scroll` |
| 键盘 | `type`、`key`、`hold_key` |
| 应用 | `open_application`、`switch_display` |
| 权限 | `request_access`、`list_granted_applications` |
| 剪贴板 | `read_clipboard`、`write_clipboard` |

#### 2. 技术架构

```
┌────────────────────────────┐
│  AI 模型                   │
│  (分析截图 → 识别 UI)      │
└────────────┬─────────────┘
             │ MCP Tool Call
             ▼
┌────────────────────────────┐
│  TypeScript 工具层           │
│  (computer-use-mcp)        │
│  - 安全检查                │
│  - 坐标转换               │
└────────────┬─────────────┘
             │ callPythonHelper()
             ▼
┌────────────────────────────┐
│  Python Bridge            │
│  (runtime/mac_helper.py)   │
│  pyautogui + mss + pyobjc │
└────────────────────────────┘
```

#### 3. 安全机制

| 机制 | 说明 |
|------|------|
| **应用白名单** | 每次会话需要明确授权允许操作的应用 |
| **并发保护** | 同一时间只有一个会话可使用（文件锁） |
| **剪贴板保护** | 输入文本时自动保存和恢复剪贴板 |
| **操作确认** | 敏感操作需要额外授权 |

---

### 2.6 其他核心功能

| 功能 | 说明 |
|------|------|
| **完整 Ink TUI** | 与官方 Claude Code 一致的终端交互界面 |
| **无头模式** | `--print` 支持脚本/CI 场景 |
| **MCP 服务器** | 支持 Model Context Protocol |
| **插件系统** | 可扩展的插件架构 |
| **Recovery CLI** | `CLAUDE_CODE_FORCE_RECOVERY_CLI=1` 降级模式 |

---

## 三、架构概览

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    CLI 入口                            │
│                  (bin/claude-haha)                     │
└──────────────────────┬────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   启动引导                              │
│                  (bootstrap/)                         │
│  - 环境检查                                             │
│  - 依赖安装                                             │
│  - 配置加载                                             │
└──────────────────────┬────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Ink TUI 层                           │
│                  (ink/main.tsx)                       │
│  - 对话窗口                                             │
│  - 状态栏                                              │
│  - 权限对话框                                          │
└──────────────────────┬────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   查询引擎                             │
│                  (QueryEngine.ts)                      │
│  - Agent 编排                                           │
│  - 工具调用                                            │
│  - 记忆管理                                            │
└──────────────────────┬────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   API 桥接层                           │
│                  (bridge/)                            │
│  - Anthropic 兼容 API                                  │
│  - MiniMax/OpenRouter 支持                             │
└─────────────────────────────────────────────────────────┘
```

### 3.2 请求生命周期

```
用户输入
    │
    ▼
┌──────────────────┐
│ 输入解析器        │ ← 斜杠命令、Skill 调用、普通消息
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 记忆加载器       │ ← MEMORY.md 加载 + 相关记忆注入
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Agent 编排器     │ ← 单 Agent / 多 Agent / Teams
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 工具系统         │ ← Tool 定义、权限检查、执行
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ API 客户端       │ ← Anthropic 兼容格式
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 响应渲染器       │ ← Ink TUI 终端渲染
└──────────────────┘
```

---

## 四、安全机制

### 4.1 权限系统

| 权限模式 | 说明 |
|----------|------|
| `default` | 正常权限请求，需要用户确认 |
| `plan` | 所有操作需要显式审批 |
| `acceptEdits` | 自动接受文件编辑 |
| `bypassPermissions` | 跳���所有权限检查 |
| `dontAsk` | 拒绝所有未预批准的操作 |

### 4.2 工具权限控制

```typescript
// Skill 中限制工具
allowed-tools: "Bash, Read, Glob"  // 只允许这些工具

// Agent 中限制工具
tools: ["Read", "Grep"]  // 只能读取，不能修改
```

### 4.3 MCP 安全

| 机制 | 说明 |
|------|------|
| **Skill 来源限制** | MCP Skills 为远程来源，禁止内联 shell 命令 |
| **Channel 访问控制** | 六层门控确保只有授权的 Channel 可用 |
| **权限中继验证** | 5 字母短 ID +脏话过滤 |

---

## 五、快速开始

### 5.1 安装

```bash
# 1. 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 2. 安装依赖
bun install
cp .env.example .env

# 3. 配置 API Key
# 编辑 .env 填入 ANTHROPIC_API_KEY 或其他兼容 API
```

### 5.2 启动

```bash
# 交互 TUI 模式
./bin/claude-haha

# 无头模式
./bin/claude-haha -p "your prompt here"

# 查看帮助
./bin/claude-haha --help
```

### 5.3 常用命令

```
/help           # 查看帮助
/memory         # 管理记忆
/remember       # 记忆审查
/skills         # 查看可用 Skills
/verify         # 验证代码变更
/debug          # 调试助手
/simplify       # 代码简化
```

---

## 六、环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `ANTHROPIC_BASE_URL` | API 端点（支持第三方） |
| `ANTHROPIC_MODEL` | 模型名称 |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | 禁用自动记忆 |
| `CLAUDE_CODE_FORCE_RECOVERY_CLI` | 强制降级 CLI 模式 |
| `CLAUDE_COMPUTER_USE_ENABLED` | 启用 Computer Use |

---

## 七、总结

Claude Code Haha 是一个功能完整的 Claude Code 开源复刻版本，具备以下核心特点：

1. **完整 TUI 体验** - 与官方一致的终端交互界面
2. **记忆系统** - 跨会话持久化知识积累
3. **多 Agent** - 并行任务处理和团队协作
4. **Skills** - 可扩展的自动化工作流
5. **Channel** - IM 远程控制支持
6. **Computer Use** - 桌面控制能力

该项目适合：
- 希望本地运行 Claude Code 的开发者
- 研究 AI 编程助手架构的学习者
- 需要定制化 AI 工具链的企业

---

*报告生成时间：2026-04-14*