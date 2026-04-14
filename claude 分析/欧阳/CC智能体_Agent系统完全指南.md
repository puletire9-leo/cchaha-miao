---
tags:
  - Claude Code
  - Agent
  - 智能体
  - SDK
  - 并发
  - Worktree
---

# Claude Code 智能体（Agent）系统完全指南

## 第二章 Agent 类型详解

### 2.1 general-purpose（通用型）

工具权限：完整（Read, Write, Edit, Bash, Grep, Glob, Agent, MCP 等）

适用场景：

- 需要同时探索和修改代码的复杂任务
- 多步骤研究后需要综合分析
- 代理执行需要复杂推理的任务

使用示例：

```
场景：分析三个不同方案的优劣
Agent({
  description: "技术方案对比研究",
  prompt: "分析以下三种缓存方案的优劣：Redis、Memcached、Caffeine。
  在项目代码中找到现有的缓存使用方式，
  结合项目实际情况给出推荐方案。
  报告控制在 300 字以内。",
  subagent_type: "general-purpose"
})
```

注意事项：拥有完整工具权限，消耗的上下文较多，适合需要"边探索边修改"的场景

### 2.2 Explore（探索型）

工具权限：只读（Read, Grep, Glob, Bash 有限），不能 Write/Edit/NotebookEdit

彻底程度级别：

[图片：彻底程度级别表格]

使用示例：

```
场景：快速查找功能代码
Agent({
  description: "查找支付相关代码",
  prompt: "在项目中查找所有与支付回调相关的代码。
  搜索包含 'payCallback'、'notify' 等关键词的文件。
  彻底程度：quick",
  subagent_type: "Explore"
})
```

```
场景：深入了解模块架构
Agent({
  description: "探索订单模块架构",
  prompt: "深入分析项目的订单处理模块。
  包括订单创建、支付、发货的完整流程。
  找到所有相关的 Service、Controller、Entity。
  彻底程度：very thorough",
  subagent_type: "Explore"
})
```

何时选 Explore：

- 只需要理解代码，不需要修改
- 快速定位文件或代码位置
- 保护主对话上下文不被大量搜索结果淹没

### 2.3 Plan（规划型）

工具权限：只读（与 Explore 相同），不能 Write/Edit/NotebookEdit

与 EnterPlanMode 的区别：

[图片：Plan vs EnterPlanMode 对比表格]

使用示例：

```
场景：规划新功能的实现方案
Agent({
  description: "设计权限系统方案",
  prompt: "分析现有项目的用户认证和权限管理代码。
  了解当前的 RBAC 实现。
  设计一个支持动态权限的扩展方案。
  输出：架构图、涉及的文件清单、改动点。",
  subagent_type: "Plan"
})
```

### 2.4 claude-code-guide（引导型）

工具权限：Glob, Grep, Read, WebFetch, WebSearch

知识覆盖范围：

- Claude Code 功能和配置
- Claude Agent SDK 使用
- Claude API（Anthropic SDK）使用
- MCP 服务器配置
- IDE 集成和 Hooks

使用示例：

```
场景：了解 Claude Code 功能
Agent({
  description: "查询 MCP 配置方法",
  prompt: "如何在 Claude Code 中配置 MCP 服务器？
  支持哪些传输协议？
  给出具体的配置示例。",
  subagent_type: "claude-code-guide"
})
```

### 2.5 状态行配置型（statusline-setup）

工具权限：Read, Edit

用途：配置 Claude Code 的状态行 UI 显示。通过 `/statusline` 命令触发时自动调用。

### 2.6 类型选择决策树

```
你的任务是什么？
│
├── 需要修改代码？
│   └── 是 → general-purpose
│
├── 只需要搜索/阅读代码？
│   ├── 快速查找 → Explore (quick)
│   ├── 深入分析 → Explore (medium/very thorough)
│   └── 架构规划 → Plan
│
├── 询问 Claude Code 使用方法？
│   └── claude-code-guide
│
└── 配置状态行？
    └── statusline-setup
```

---

## 第三章 并发执行与后台运行

### 3.1 并发执行的工作原理

核心机制：在一条消息中发起多个 Agent 调用，Claude Code 会同时启动这些子智能体并行工作。

```
主对话：一条消息
├── Agent A（研究方案1）──→ 结果A
├── Agent B（研究方案2）──→ 结果B
└── Agent C（研究方案3）──→ 结果C
↓
主对话收到所有结果，综合分析
```

并发示例：

```
// 一条消息中启动多个 Agent
Agent({ description: "研究模块A", prompt: "...", subagent_type: "Explore" })
Agent({ description: "研究模块B", prompt: "...", subagent_type: "Explore" })
Agent({ description: "研究模块C", prompt: "...", subagent_type: "Explore" })
```

### 3.2 后台运行（run_in_background）

设置 `run_in_background: true` 后，Agent 在后台执行，主对话可以继续工作。

工作流程：

1. 启动后台 Agent，立即获得 task_id
2. 主对话继续处理其他任务
3. Agent 完成后自动通知
4. 使用 Read 工具读取输出文件获取结果

前台 vs 后台对比：

[图片：前台vs后台对比表格]

### 3.3 后台任务的通知机制

后台任务完成后，系统会自动发送通知到主对话，不需要轮询或 sleep 等待。

### 3.4 TaskOutput 工具

```
TaskOutput({
  task_id: "task-12345",  // 后台任务的 ID
  block: true,            // 是否等待完成（默认 true）
  timeout: 30000          // 最大等待时间（ms）
})
```

### 3.5 使用场景选择

**用前台**：需要结果才能决定下一步、任务执行时间短（< 30 秒）、需要即时反馈

**用后台**：有多个独立任务可并行执行、任务耗时长不想阻塞、可以继续做其他工作

**用并发前台**：多个调研结果需要综合对比、所有结果都是下一步操作的输入

---

## 第四章 Worktree 隔离模式

### 4.1 什么是 Worktree 隔离

设置 `isolation: "worktree"` 后，Agent 会在一个独立的 git worktree 中工作，与主工作区完全隔离。

```
主工作区（D:\project\crmorder.gaodun.com\）
├── 你的代码和修改
│
└── .claude/worktrees/
    └── agent-task-name/  ← 独立的 worktree
        ├── 完整的仓库镜像
        └── Agent 在此工作
```

### 4.2 工作原理

创建过程：

1. Agent 启动时，自动在 `.claude/worktrees/` 下创建新的 worktree
2. 基于 HEAD 创建新分支
3. 切换工作目录到 worktree
4. Agent 在 worktree 中独立工作

内部等价于：`git worktree add .claude/worktrees/agent-name HEAD`

### 4.3 自动清理机制

[图片：自动清理机制表格]

### 4.4 与手动 git worktree add 的区别

[图片：区别对比表格]

### 4.5 安全性保证

- Worktree 在 `.claude/` 目录下，受版本控制忽略
- 文件修改完全隔离，不影响主工作区
- 每个 worktree 有独立的工作目录和分支
- 自动清理防止磁盘空间浪费

### 4.6 使用场景

- **场景1**：安全的代码实验
- **场景2**：并行开发多个功能
- **场景3**：批量操作隔离

### 4.7 使用示例

```
Agent({
  description: "尝试重构认证模块",
  prompt: "在当前项目中重构认证模块，
  将 Session 认证改为 JWT 认证。
  确保所有相关测试通过。",
  isolation: "worktree"  // 在独立 worktree 中工作
})
```

---

## 第五章 Claude Agent SDK

### 5.1 SDK 定位

Claude Agent SDK 是 Anthropic 官方提供的开发工具包，允许在自己的应用程序中嵌入 Claude Code 的核心能力。

与 CLI 的区别：

[图片：SDK vs CLI 对比表格]

### 5.2 安装

- **TypeScript**（Node.js 18+）：`npm install @anthropic-ai/claude-agent-sdk`
- **Python**（3.10+）：`pip install claude-agent-sdk`

### 5.3 核心概念

#### 5.3.1 Agent 定义（AgentDefinition）

```typescript
type AgentDefinition = {
  description: string;        // 智能体自然语言描述
  prompt: string;             // 系统提示词
  tools?: string[];           // 允许的工具列表
  disallowedTools?: string[]; // 禁用的工具列表
  model?: "sonnet" | "opus" | "haiku";  // 模型选择
  mcpServers?: AgentMcpServerSpec[];     // MCP 服务器配置
  skills?: string[];          // 预加载技能
  maxTurns?: number;          // 最大交互轮次
};
```

#### 5.3.2 权限模式（PermissionMode）

```typescript
type PermissionMode =
  | "default"           // 标准权限
  | "acceptEdits"       // 自动接受文件编辑
  | "bypassPermissions" // 绕过所有权限检查
  | "plan"              // 计划模式（只读）
  | "dontAsk"           // 拒绝未预批准的操作
  | "auto";             // 模型自动判断批准/拒绝
```

#### 5.3.3 会话管理

```typescript
// 列出历史会话
const sessions = await listSessions({
  dir: "/path/to/project",
  limit: 10
});

// 获取会话消息
const messages = await getSessionMessages(sessionId, {
  dir: "/path/to/project",
  limit: 20
});

// 重命名会话
await renameSession(sessionId, "新名称");
```

### 5.4 基本使用示例

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// 基本查询
for await (const message of query({
  prompt: "分析这个代码库的架构",
  options: {
    model: "claude-sonnet-4-6",
    permissionMode: "plan"  // 只读模式
  }
})) {
  console.log(message);
}
```

### 5.5 自定义智能体示例

```typescript
// 定义代码审查智能体
const codeReviewer: AgentDefinition = {
  description: "代码质量审查专家",
  prompt: `你是一个经验丰富的代码审查专家。
  专注于代码质量、安全漏洞和性能优化。
  审查时重点关注：空指针风险、边界条件、资源泄漏。`,
  tools: ["Read", "Grep", "Glob"],
  model: "sonnet"
};

// 使用自定义智能体
for await (const message of query({
  prompt: "审查 src/auth/ 目录下的所有代码",
  options: {
    agents: { codeReviewer },
    permissionMode: "plan"
  }
})) {
  if (message.type === "assistant") {
    console.log(`审查结果: ${message.message.content}`);
  }
}
```

### 5.6 MCP 服务器集成

```typescript
const mcpServers = {
  // stdio 模式
  securityScanner: {
    type: "stdio",
    command: "node",
    args: ["./security-scanner.js"]
  },
  // SSE 模式
  databaseTools: {
    type: "sse",
    url: "https://tools.example.com/mcp"
  }
};

// 在智能体中使用
for await (const message of query({
  prompt: "扫描代码安全漏洞",
  options: {
    agents: { securityAgent },
    mcpServers
  }
})) {
  // 处理消息
}
```

### 5.7 Hook 系统

```typescript
const options = {
  agents: { codeReviewer },
  hooks: {
    PreToolUse: [
      {
        matcher: "Edit",
        hooks: [async (context) => {
          // 编辑前自动备份
          console.log(`即将编辑: ${context.file_path}`);
        }]
      }
    ]
  }
};
```

### 5.8 官方资源

**GitHub 仓库：**

- TypeScript SDK: <https://github.com/anthropics/claude-agent-sdk-typescript>
- Python SDK: <https://github.com/anthropics/claude-agent-sdk-python>
- 演示项目: <https://github.com/anthropics/claude-agent-sdk-demos>

**官方文档：**

- Agent SDK 概述: <https://code.claude.com/docs/en/agent-sdk/overview>
- TypeScript API: <https://platform.claude.com/docs/en/agent-sdk/typescript>
- Python API: <https://platform.claude.com/docs/en/agent-sdk/python>

---

## 第六章 实际使用场景

### 6.1 代码审查（Writer/Reviewer 模式）

场景：让一个 Agent 写代码，另一个 Agent 审查代码，互相迭代。

- **Writer Agent**: 工具 Read, Write, Edit, Bash，职责编写代码实现功能
- **Reviewer Agent**: 工具 Read, Grep, Glob，职责审查代码质量、安全性、性能，不能修改代码只提建议

### 6.2 并行技术调研

场景：同时调研多个技术方案，综合对比。

```
用户：帮我对比 Redis、Memcached、Caffeine 三种缓存方案

Claude 会同时启动 3 个 Explore Agent：
├── Agent A：调研 Redis 的优缺点和适用场景
├── Agent B：调研 Memcached 的优缺点和适用场景
└── Agent C：调研 Caffeine 的优缺点和适用场景

所有结果返回后，主对话综合对比，给出推荐。
```

### 6.3 多模块代码分析

```
用户：帮我分析订单模块、支付模块、物流模块的架构

Claude 会同时启动 3 个 Explore Agent（very thorough）：
├── Agent A：深入分析订单模块
├── Agent B：深入分析支付模块
└── Agent C：深入分析物流模块

主对话收到结果后，生成整体架构分析报告。
```

### 6.4 安全实验与重构

```
用户：尝试把 Session 认证改成 JWT 认证

Claude 会：
1. 启动 Agent（isolation: "worktree"）
2. Agent 在独立的 worktree 中实施重构
3. 完成后返回 worktree 路径和分支名
4. 用户检查后决定是否合并
```

### 6.5 后台长任务

```
用户：在后台跑一下全部单元测试，我继续写代码

Claude 会：
1. 启动 Agent（run_in_background: true）
2. 立即继续响应用户的其他请求
3. 测试完成后自动通知
4. 用户查看结果
```

### 6.6 企业级多智能体协作

```
团队配置示例（使用 Agent SDK）：

需求分析师 Agent
  ↓ 输出需求文档
架构师 Agent
  ↓ 输出设计文档
开发工程师 Agent
  ↓ 输出代码
测试工程师 Agent
  ↓ 输出测试报告
代码审查 Agent
  ↓ 输出审查意见
最终交付
```

---

## 第七章 最佳实践与决策指南

### 7.1 Agent 使用决策矩阵

[图片：决策矩阵表格]

### 7.2 Prompt 编写要点

编写 Agent prompt 时应遵循以下原则：

- **自包含**：子智能体没有之前对话的记忆，prompt 必须包含所有必要上下文
- **明确目标**：清楚说明期望的输出格式和内容
- **限制范围**：指定搜索范围、文件类型等约束
- **控制长度**：明确要求报告长度（如"控制在 200 字以内"）

好的 Prompt 示例：

```
在项目 src/main/java/com/gaodun/storm/crmorder/service/ 目录下
查找所有处理订单状态变更的代码。
重点关注状态机流转逻辑和边界条件处理。
列出所有涉及的状态枚举值和转换条件。
报告控制在 300 字以内。
```

不好的 Prompt 示例：

```
看看订单相关的代码
```

### 7.3 资源管理

- **并发数量**：合理控制并发 Agent 数量，避免资源争抢
- **模型选择**：只读任务优先用 Haiku（Explore），复杂推理用 Sonnet/Opus
- **后台任务**：长任务设为后台，短任务用前台
- **清理 Worktree**：确认不需要后及时清理

### 7.4 常见陷阱

[图片：常见陷阱表格]

### 7.5 Agent vs 直接工具对比

[图片：Agent vs 直接工具对比表格]

---

本文档基于 Claude Code 官方文档和社区实践整理，最后更新：2026-04-10
