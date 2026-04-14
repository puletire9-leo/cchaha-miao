# Claude Code 框架学习计划

> 学习日期：2026-04-14
> 目标：全面理解这个顶级 AI Agent 框架

---

## 一、整体架构概览

### 1.1 核心组成

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                            │
│                    (顶层入口)                               │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   用户      │◄───│   TUI      │◄───│   Agent     │    │
│  │ 输入/输出   │    │  (Ink)    │    │   引擎      │    │
│  └─────────────┘    └─────────────┘    └──────┬──────┘    │
│                                                │           │
│                                    ┌────────────┴────────┐ │
│                                    │                     │ │
│                              ┌─────▼─────┐        ┌────▼──────┐
│                              │  Tools   │        │  Memory  │
│                              │  系统    │        │   系统   │
│                              └─────┬─────┘        └────┬──────┘
│                                    │                 │
│                              ┌─────▼─────┐        ┌────▼──────┐
│                              │ Skills   │        │   MCP    │
│                              │  系统    │        │   系统   │
│                              └─────────┘        └──────────┘
└─────────────────────────────────────────────────────────────┘
```

### 1.2 数据流

```
用户输入
     │
     ▼
┌────────────┐
│  解析器    │ ← 斜杠命令、普通消息、Skill 调用
└─────┬──────┘
     │
     ▼
┌────────────┐
│ 记忆加载   │ ← MEMORY.md 加载 + 相关记忆注入
└─────┬──────┘
     │
     ▼
┌────────────┐
│ Agent 编排  │ ← 单 Agent / 多 Agent / Teams
└─────┬──────┘
     │
     ▼
┌────────────┐
│ 工具系统   │ ← Tool 定义、权限检查、执行
└─────┬──────┘
     │
     ▼
┌────────────┐
│ API 客户端 │ ← Anthropic 兼容格式
└─────┬──────┘
     │
     ▼
┌────────────┐
│ 响应渲染   │ ← Ink TUI 终端渲染
└────────────┘
```

---

## 二、十大系统详解

### 系统 1：查询引擎（Query Engine）

**文件**：`src/query.ts`、`src/QueryEngine.ts`

**职责**：核心 AI 循环，处理用户请求

| 关键概念 | 说明 |
|---------|------|
| **Prompt** | 用户输入如何变成 AI 消息 |
| **Tool Use** | AI 如何调用工具 |
| **Tool Result** | 工具结果如何返回给 AI |
| **Stream** | 流式响应如何处理 |

**核心流程**：
```
1. 用户输入 → 格式化为 Message
2. 加载系统提示（System Prompt）
3. 加载记忆（MEMORY.md）
4. 发送给 AI 模型
5. AI 返回 → 解析 Tool Call
6. 执行工具 → 返回结果
7. 循环直到完成
```

---

### 系统 2：工具系统（Tools）

**文件**：`src/tools.ts`、`src/tools/*.ts`

**职责**：定义和管理 AI 可以调用的工具

| 工具类别 | 数量 | 例子 |
|---------|------|------|
| 文件操作 | 6 | Read, Edit, Write, Glob |
| Shell | 3 | Bash, npm, git |
| 搜索 | 2 | Grep, Task |
| 网络 | 2 | WebFetch, WebSearch |
| MCP | 20+ | 各种 MCP 服务器 |

**权限机制**：
```
Tool 定义 → 权限检查 → 用户确认 → 执行 → 结果返回
```

**权限模式**：
| 模式 | 说明 |
|------|------|
| `default` | 每次请求确认 |
| `bypassPermissions` | 跳过所有确认 |
| `dontAsk` | 拒绝未批准操作 |
| `plan` | 计划模式确认 |

---

### 系统 3：记忆系统（Memory）

**文件**：`src/memdir/*.ts`

**职责**：跨会话持久化知识

**四种类型**：

| 类型 | 英文 | Scope | 用途 |
|------|------|-------|------|
| 用户画像 | User | always private | 你的背景、偏好 |
| 行为反馈 | Feedback | default private | 你的纠正和肯定 |
| 项目动态 | Project | private/team | 项目正在发生什么 |
| 外部引用 | Reference | usually team | 外部系统指针 |

**核心流程**：
```
对话结束 → 后台提取代理分析 → 识别值得保存 → 写入 memory/ → 更新 MEMORY.md
```

**存储结构**：
```
~/.claude/projects/{项目hash}/
└── memory/
    ├── MEMORY.md              ← 索引（始终加载）
    ├── user_*.md             ← 用户画像
    ├── feedback_*.md         ← 行为反馈
    ├── project_*.md           ← 项目动态
    └── reference_*.md         ← 外部引用
```

---

### 系统 4：Skills 系统

**文件**：`src/skills/`、`src/commands/skills.tsx`

**职责**：可扩展的自动化工作流

**六种来源**：

| 来源 | 路径 | 优先级 |
|------|------|--------|
| Bundled | 编译到 CLI | 1 |
| Managed | 组织策略 | 2 |
| User | ~/.claude/skills/ | 3 |
| Project | .claude/skills/ | 4 |
| Plugin | 插件提供 | 5 |
| MCP | MCP 服务器 | 6 |

**内置 Skills**：
| Skill | 用途 |
|-------|------|
| /verify | 验证代码变更 |
| /debug | 调试助手 |
| /simplify | 代码简化审查 |
| /remember | 记忆管理 |
| /memory | 编辑记忆 |
| /skills | 查看 Skills |

**调用方式**：
```
/skill-name           ← 用户斜杠命令
Agent 调用           ← 模型自动调用
nested-skill         ← 嵌套调用
```

---

### 系统 5：多 Agent 系统

**文件**：`src/coordinator/`、`src/assistant/`

**职责**：并行任务处理

**六种内置 Agent**：

| Agent | 工具池 | 模型 | 用途 |
|-------|--------|------|------|
| general-purpose | 全部 | 继承 | 通用任务 |
| Explore | 只读 | Haiku | 快速探索 |
| Plan | 只读 | 继承 | 规划 |
| verification | 只读 | 继承 | 验证 |
| claude-code-guide | 搜索 | Haiku | 文档 |
| statusline-setup | Read+Edit | Sonnet | 配置 |

**使用方式**：
```typescript
Agent({
  description: "分析错误日志",
  prompt: "读取 logs/ 下...",
  subagent_type: "Explore",
  run_in_background: true  // 后台执行
})
```

**Teams 协作**：
```typescript
TeamCreate({ team_name: "feature" })
Agent({ name: "frontend", team_name: "feature" })
SendMessage({ to: "frontend", message: "..." })
TeamDelete()
```

---

### 系统 6：权限系统

**文件**：`src/hooks/permission.ts`

**职责**：控制工具使用权限

| 权限模式 | 说明 |
|----------|------|
| `default` | 每次请求确认 |
| `plan` | 计划模式确认 |
| `acceptEdits` | 自动接受编辑 |
| `bypassPermissions` | 跳过所有检查 |
| `dontAsk` | 拒绝未批准 |

**流程**：
```
Tool 声明 → Capability 检查 → 权限模式 → 用户确认 → 执行
```

---

### 系统 7：MCP 系统

**文件**：`src/services/mcp/`、`src/plugins/`

**职责**：Model Context Protocol 集成

**MCP 能力声明**：
```typescript
{
  "capabilities": {
    "tools": {},
    "resources": {},
    "prompts": {}
  }
}
```

**工具暴露**：
- 工具通过 MCP 暴露给 AI
- AI 可以调用 MCP 服务器的工具
- MCP 服务器可以访问文件系统等

---

### 系统 8：Channel 系统

**文件**：`src/services/mcp/channel*.ts`

**职责**：IM 远程控制（Telegram/飞书/Discord）

**六层访问控制**：

| 层级 | 检查 |
|------|------|
| 1 | 能力声明 |
| 2 | 运行时开关 |
| 3 | OAuth 认证 |
| 4 | 组织策略 |
| 5 | 会话白名单 |
| 6 | Marketplace 验证 |

**消息协议**：
```xml
<channel source="plugin:telegram:tg" user="alice">
帮我看看 main.ts
</channel>
```

---

### 系统 9：Computer Use

**文件**：`src/utils/computerUse/`、`runtime/`

**职责**：桌面控制

**24 个工具**：

| 类别 | 工具 |
|------|------|
| 截屏 | screenshot, zoom |
| 鼠标 | left_click, right_click, mouse_move, scroll |
| 键盘 | type, key, hold_key |
| 应用 | open_application, switch_display |
| 权限 | request_access |
| 剪贴板 | read_clipboard, write_clipboard |

**技术架构**：
```
AI 模型 → TypeScript工具层 → Python Bridge → pyautogui/mss
```

---

### 系统 10：Recovery CLI

**文件**：`src/localRecoveryCli.ts`

**职责**：降级 fallback 模式

**启用方式**：
```bash
CLAUDE_CODE_FORCE_RECOVERY_CLI=1 ./bin/claude-haha
```

---

## 三、源码目录结构

```
src/
├── query.ts              ← 请求入口（约 70000 行）
├── QueryEngine.ts        ← 核心循环（约 48000 行）
├── Tool.ts              ← 工具定义（约 30000 行）
├── tools.ts             ← 工具注册（约 18000 行）
├── commands.ts          ← CLI 命令（约 26000 行）
│
├── bootstrap/           ← 启动引导
│   └── state.ts        ← 全局状态
│
├── memdir/              ← 记忆系统
│   ├── memoryTypes.ts  ← 4种类型定义
│   ├── paths.ts        ← 路径逻辑
│   ├── memdir.ts       ← 核心存储
│   └── memoryAge.ts   ← 新鲜度
│
├── skills/              ← Skills 系统
├── coordinator/         ← Agent 协调
├── assistant/           ← Agent 定义
├── hooks/              ← React Hooks
│   └── permission.ts   ← 权限
├── services/           ← 服务层
│   └── mcp/           ← MCP 服务
├── utils/              ← 工具函数
│   ├── computerUse/   ← 桌面控制
│   └── plugins/       ← 插件
│
└── components/         ← UI 组件
    └── messages/      ← 消息渲染
```

---

## 四、学习路径（10天）

### 第 1-2 天：Query Engine（核心）

| 时间 | 内容 | 重点 |
|------|------|------|
| 第1天 | src/query.ts | 请求如何变成 AI 消息 |
| 第2天 | src/QueryEngine.ts | AI 循环如何运转 |

**目标**：理解请求 → AI → 响应 的完整流程

---

### 第 3-4 天：工具系统

| 时间 | 内容 | 重点 |
|------|------|------|
| 第3天 | src/tools.ts | 工具注册和权限 |
| 第4天 | src/tools/*.ts | 具体工具实现 |

**目标**：理解 Tool 定义、权限检查、执行

---

### 第 5-6 天：记忆系统

| 时间 | 内容 | 重点 |
|------|------|------|
| 第5天 | src/memdir/memoryTypes.ts | 4种类型定义 |
| 第6天 | src/memdir/paths.ts | 存储路径逻辑 |

**目标**：理解记忆如何工作

---

### 第 7 天：Skills 系统

| 时间 | 内容 | 重点 |
|------|------|------|
| 第7天 | src/skills/ | Skill 定义和加载 |

**目标**：理解自动化工作流

---

### 第 8 天：多 Agent

| 时间 | 内容 | 重点 |
|------|------|------|
| 第8天 | src/coordinator/ | Agent 协调 |

**目标**：理解并行处理

---

### 第 9-10 天：整合

| 时间 | 内容 | 重点 |
|------|------|------|
| 第9天 | 整体回顾 | 如何串联 |
| 第10天 | 实践 | 自己设计一个小功能 |

---

## 五、关键文件索引

### 核心文件（必须读）

| 优先级 | 文件 | 行数 | 用途 |
|--------|------|------|------|
| ⭐⭐⭐ | src/query.ts | 70K | 请求处理入口 |
| ⭐⭐⭐ | src/QueryEngine.ts | 48K | 核心循环 |
| ⭐⭐⭐ | src/tools.ts | 18K | 工具注册 |
| ⭐⭐ | src/Tool.ts | 30K | 工具定义 |
| ⭐⭐ | src/memdir/memoryTypes.ts | 23K | 记忆类型 |
| ⭐⭐ | src/memdir/paths.ts | 11K | 记忆路径 |
| ⭐ | src/coordinator/ | - | Agent 协调 |
| ⭐ | src/skills/ | - | Skills |

### 次要文件（选读）

| 文件 | 用途 |
|------|------|
| src/commands.ts | CLI 命令 |
| src/hooks/permission.ts | 权限 |
| src/services/mcp/ | MCP |
| src/utils/computerUse/ | 桌面控制 |

---

## 六、实践建议

### 学习方法

| 方法 | 说明 |
|------|------|
| 1. 先跑通 | `./bin/claude-haha --help` 看有哪些功能 |
| 2. 读 README | 先理解整体，再深入细节 |
| 3. 读关键文件 | 按上面优先级读源码 |
| 4. 动手修改 | 尝试添加一个小功能 |
| 5. 教别人 | 教是最好的学习 |

### 快速上手

```bash
# 1. 体验 TUI
./bin/claude-haha

# 2. 查看帮助
./bin/claude-haha --help

# 3. 尝试无头模式
./bin/claude-haha -p "用中文介绍你自己"

# 4. 查看 Skills
# 在对话中输入 /skills
```

---

## 七、总结

Claude Code 是一个**完整的 AI Agent 框架**，核心包括：

| 系统 | 作用 |
|------|------|
| Query Engine | AI 循环 |
| Tools | 能力扩展 |
| Memory | 知识持久化 |
| Skills | 自动化 |
| Multi-Agent | 并行处理 |
| Permission | 安全控制 |
| MCP | 生态集成 |
| Channel | 远程控制 |
| Computer Use | 桌面控制 |

**核心理念**：让 AI 能自主工作，而不只是回答问题。

---

*学习计划制定时间：2026-04-14*