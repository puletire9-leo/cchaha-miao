---
tags:
  - Claude Code
  - OpenSpec
  - Agent
  - MCP
  - 智能体协作
---

# Claude Code 深度使用与 OpenSpec 结合方案

## 方案三 Agent 智能体协作

核心思路：利用 CC 的 Agent 能力，将 OpenSpec 流程中最耗时的环节并行化、自动化。

### 3.1 Specs 阶段：自动深挖历史逻辑

**现状：** 需要反复对话，一句一句问用户代码逻辑

**改进：** 启动 Explore Agent 自动分析代码，用户只需确认

**流程：**

```
用户：/openspec-specs 订单状态流转优化
→ CC 读取 design.md，提取涉及的接口列表
→ 并发启动多个 Explore Agent：
  ├── Agent A：分析 OrderService 调用链
  ├── Agent B：分析 OrderMapper SQL 逻辑
  └── Agent C：分析 StatusEnum 状态机定义
→ 汇总结果 → 按 specs 模板格式整理
→ 展示给用户确认："以下历史逻辑是否完整？"
→ 用户确认/补充 → 完成历史逻辑部分
→ 继续编写新增需求和边界值分析
```

**关键 Prompt 设计：**

```javascript
Agent({
  description: "深挖订单模块历史逻辑",
  subagent_type: "Explore",
  prompt: "在 D:/project/crmorder.gaodun.com 中深入分析订单状态变更相关的历史逻辑。

  需要彻底分析（very thorough）：

  1. 找到所有处理订单状态变更的 Service 方法
  2. 追踪每个方法的完整调用链：Controller → Service → Mapper
  3. 记录所有涉及的数据库表和字段
  4. 找出所有状态枚举值和转换条件
  5. 分析现有的边界条件处理（空值、异常、并发）

  输出格式：
  - 每个接口列出：调用链、核心代码片段、边界条件
  - 列出所有涉及的数据表和关键字段

  报告控制在 500 字以内，重点突出。"
})
```

### 3.2 多项目场景：并发分析

**现状：** 涉及多项目时需要逐个切换分析

**改进：** 并发启动多个 Agent，同时分析不同项目

```
用户：这个需求涉及 crmorder 和 gaodun-shoping 两个项目
→ CC 并发启动：
  ├── Agent A（Explore, worktree）: 分析 crmorder 中的相关代码
  └── Agent B（Explore, worktree）: 分析 gaodun-shoping 中的相关代码
→ 汇总结果 → 生成 specs/invoice-center/spec.md 和 specs/order-service/spec.md
```

### 3.3 Tasks 阶段：智能分解

**现状：** 手动从 specs 中提取任务

**改进：** Agent 自动分析 specs，生成结构化任务清单

```javascript
Agent({
  description: "从 specs 生成 tasks",
  subagent_type: "Plan",
  prompt: "读取以下 specs.md 文件：{路径}

  基于 specs 中的接口变更和数据模型变更，生成开发任务清单。

  任务分解原则：
  1. 按接口/模块分组
  2. 每个任务明确到具体的文件和方法
  3. 标注任务间的依赖关系
  4. 数据库变更任务排在最前面
  5. 每个任务包含验收标准

  输出 tasks.md 格式的任务清单。"
})
```

### 3.4 代码审查：OpenSpec 一致性校验

开发完成后，用 Agent 对比代码变更和 specs 定义的一致性：

```javascript
Agent({
  description: "校验代码与 specs 一致性",
  subagent_type: "Explore",
  prompt: "对比以下两份文档：
  1. specs.md：{路径}
  2. git diff master...HEAD：当前代码变更

  检查：
  - specs 中定义的接口变更是否都已实现
  - 边界值处理是否按 specs 描述实现
  - 数据模型变更是否与 specs 一致
  - 是否有 specs 中未定义的额外变更

  输出差异报告。"
})
```

---

## 方案四 记忆系统追踪

核心思路：利用 CC 的自动记忆系统，实现 OpenSpec 的跨会话进度追踪。

### 4.1 项目记忆（project 类型）

当开始一个新需求时，自动创建 project 记忆：

```yaml
---
name: openspec_order_optimization
description: 天猫订单重复推送优化 - OpenSpec 进度追踪
type: project
---
天猫订单重复推送优化需求，2026-04-10 开始。

当前阶段: specs（历史逻辑已完成，新增需求编写中）

产物位置:
- proposal: ✅ openspec/order-push-optimize/proposal.md
- design: ✅ openspec/order-push-optimize/design.md
- specs: 🔄 openspec/order-push-optimize/specs.md（60%）
- tasks: ⬜ 待开始

涉及项目: crmorder.gaodun.com

关键决策: 使用消息队列去重而非数据库唯一索引
Why: 需求由技术团队发起，目标是降低重复推送导致的资损
How to apply: 每次 OpenSpec 相关对话时，先检查此记忆了解进度
```

### 4.2 参考记忆（reference 类型）

```yaml
---
name: reference_openspec
description: OpenSpec 产物模板和规范位置
type: reference
---
- 模板目录：D:/project/openspec模板/
- 全局规则：~/.claude/CLAUDE.md 中 "OpenSpec 产物模板规则" 部分
- 项目产物：各项目下 openspec/ 目录
```

### 4.3 反馈记忆（feedback 类型）

```yaml
---
name: feedback_openspec_quality
description: OpenSpec 生成质量的用户反馈
type: feedback
---
历史逻辑深挖时，必须展示给用户确认后再写新增需求部分，不能跳步。
Why: 用户多次反馈自动生成的历史逻辑有遗漏，需要人工确认环节。
How to apply: 在 specs 生成流程中，先完成历史逻辑部分并展示，等用户确认后再继续。
```

### 4.4 记忆使用流程

```
新会话启动
→ CC 自动加载 MEMORY.md（包含 OpenSpec 进度记忆）
→ 用户说"继续上次的 OpenSpec"
→ CC 读取 project 记忆，了解：当前在哪个阶段、产物在哪里、哪些已完成、哪些待做
→ 直接从上次断点继续，无需重新描述背景
```

---

## 方案五 Rules 规则强制

核心思路：在 `.claude/rules/` 下创建专项规则，强制 OpenSpec 的质量标准。

### 5.1 边界值分析强制规则

文件：`~/.claude/rules/openspec-boundary.md`

```markdown
当生成或修改 OpenSpec specs.md 文件时，每个接口变更必须包含以下边界值分析：

## 必须覆盖的边界条件

### 空值类
- 入参为 null 时的行为
- 返回值为空集合时的处理
- Optional 的 orElse 处理

### 数值类
- 数值为 0 时的行为
- 数值超过上限（Integer.MAX_VALUE）时
- 负数输入时
- 小数精度丢失场景

### 集合类
- 空集合输入
- 集合元素超过批量上限（如 1000 条）
- 重复元素处理

### 并发类
- 同一请求并发调用时的行为
- 数据库乐观锁/悲观锁机制
- 幂等性保证

### 异常类
- 数据库连接超时
- 外部服务不可用
- 网络超时重试

缺少任何一项都应在输出中标注 ⚠️ 并给出补充提示。
```

### 5.2 历史逻辑深挖规则

文件：`~/.claude/rules/openspec-history-mining.md`

```markdown
当执行 OpenSpec specs 阶段的历史逻辑深挖时，必须按以下顺序执行：

## 第一步：接口搜索
使用 Grep 搜索涉及的所有方法名、URL 路径。

## 第二步：调用链追踪
必须追踪到最底层：
- Controller → Service → Mapper/DAO
- 如果涉及外部调用，追踪到 Feign Client / HTTP Client

## 第三步：数据模型分析
- 涉及哪些表
- 关键字段含义
- 索引情况

## 第四步：边界条件收集
- 现有的 if/else 分支逻辑
- 现有的异常处理
- 现有的空值检查

## 第五步：输出确认
历史逻辑必须展示给用户确认后，才能继续编写新增/修改需求部分。
禁止跳过确认步骤直接生成完整 specs。
```

### 5.3 产物质量规则

文件：`~/.claude/rules/openspec-quality.md`

```markdown
OpenSpec 产物质量标准

### proposal.md
- 需求背景必须说明"为什么要做"
- 变更内容必须列出具体功能点（不能是笼统描述）
- 影响范围必须包含具体的系统/模块名称

### design.md
- 技术决策必须包含"为什么选 X 而不是 Y"
- 非目标和目标必须明确区分
- 风险必须有对应的缓解措施

### specs.md
- 历史逻辑必须包含完整调用链路径
- 接口变更必须按 Controller → Service → Mapper 分层描述
- 每层变更必须包含具体的文件路径
- 核心逻辑必须附上代码片段
- 边界值分析不得少于 5 项

### tasks.md
- 任务必须按模块/功能分组
- 每个任务必须可独立验证
- 数据库变更任务必须排在最前面
```

---

## 方案六 MCP 服务器增强

核心思路：集成 MCP 服务器，让 CC 能直接访问数据库、项目管理、代码索引等外部资源。

### 6.1 数据库 MCP --- 自动获取表结构

推荐 MCP：

- 微软官方 `@modelcontextprotocol/server-sqlite`（SQLite）
- `mssql-mcp-server`（SQL Server）
- 自建 MySQL MCP（Java 项目常用 MySQL）

配置示例：

```json
{
  "mcpServers": {
    "mysql-crmorder": {
      "command": "npx",
      "args": ["mysql-mcp-server"],
      "env": {
        "MYSQL_HOST": "your-host",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "readonly",
        "MYSQL_PASSWORD": "***",
        "MYSQL_DATABASE": "crmorder"
      }
    }
  }
}
```

### 6.2 项目管理 MCP --- 需求信息同步

推荐 MCP：Jira 官方 MCP、Linear MCP、社区 Tapd MCP

配置示例：

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["@anthropic-ai/mcp-jira"],
      "env": {
        "JIRA_URL": "https://your-domain.atlassian.net",
        "JIRA_TOKEN": "your-api-token"
      }
    }
  }
}
```

### 6.3 代码质量 MCP --- 质量风险评估

推荐 MCP：`@sonarsource/sonarqube-mcp-server`

### 6.4 GitHub MCP --- PR 自动化

推荐 MCP：`@modelcontextprotocol/server-github`（官方）

### 6.5 MCP 集成优先级

[图片：MCP 集成优先级表格]

---

## 实施路线图

### 第一阶段：基础建设（1-2 天，零依赖）

**第 1 天：**

```
├── 创建 ~/.claude/rules/openspec-boundary.md（边界值规则）
├── 创建 ~/.claude/rules/openspec-quality.md（产物质量规则）
├── 创建 ~/.claude/rules/openspec-history-mining.md（深挖规则）
└── 在项目记忆中记录 OpenSpec 产物位置
```

**第 2 天：**

```
├── 配置 settings.json 的 UserPromptSubmit 钩子
├── 配置 settings.json 的 PostToolUse 钩子
└── 测试钩子是否生效
```

**预期效果：** OpenSpec 产物质量有基线保障

### 第二阶段：Skill 命令（2-3 天）

**第 1 天：**

```
├── 创建 openspec-init.md（初始化 Skill）
├── 创建 openspec-status.md（进度查看 Skill）
└── 创建 openspec-validate.md（产物校验 Skill）
```

**第 2 天：**

```
├── 创建 openspec-proposal.md（需求提案 Skill）
├── 创建 openspec-specs.md（详细规格 Skill，含 Agent 协作）
└── 创建 openspec-design.md 和 openspec-tasks.md
```

**第 3 天：**

```
└── 端到端测试：用一个真实需求跑一遍完整流程
```

**预期效果：**

- `/openspec-init` 一键初始化需求
- `/openspec-specs` 自动深挖历史逻辑
- `/openspec-validate` 自动校验产物完整性
- `/openspec-status` 随时查看进度

### 第三阶段：Agent 协作（3-5 天）

**第 1-2 天：**

```
├── 调试 Explore Agent 的历史逻辑深挖 prompt
├── 优化 prompt 使输出与 specs 模板格式对齐
└── 测试多个需求场景的深挖效果
```

**第 3-4 天：**

```
├── 实现多项目并发分析
├── 调试 Tasks 自动分解
└── 实现代码变更与 specs 一致性校验
```

**第 5 天：**

```
└── 完整流程测试
```

**预期效果：**

- 历史逻辑深挖时间从 30 分钟降到 5 分钟
- 多项目分析可并行处理
- Tasks 自动从 specs 提取

### 第四阶段：MCP 集成（按需，持续）

优先接入数据库 MCP：

```
├── 选择适合项目的数据库 MCP
├── 配置只读连接（安全）
├── 测试表结构查询
└── 集成到 /openspec-specs Skill 中
```

后续按需接入：

```
├── GitHub MCP（PR 自动化）
├── 项目管理 MCP（需求同步）
└── 代码质量 MCP（风险评估）
```

---

## 完整架构图

```
用户
  ↓
  "/openspec-init 天猫订单优化"
  ↓
┌─────────────────── Skill 层 ───────────────────┐
│ /openspec-init → 创建目录 + 记忆              │
│ /openspec-proposal → 生成 proposal.md         │
│ /openspec-design → 生成 design.md             │
│ /openspec-specs → 生成 specs.md（核心）       │
│ /openspec-tasks → 生成 tasks.md               │
│ /openspec-validate → 校验完整性               │
│ /openspec-status → 查看进度                   │
└─────────────────────────────────────────────────┘
  ↓ 调用
┌─────────────────── Agent 层 ───────────────────┐
│ Explore Agent × N（并发深挖历史逻辑）          │
│ Plan Agent（智能分解 tasks）                   │
│ General-purpose Agent（多项目并发分析）        │
└─────────────────────────────────────────────────┘
  ↓ 增强
┌─────────────────── MCP 层 ─────────────────────┐
│ 数据库 MCP（表结构查询）                       │
│ GitHub MCP（PR 自动化）                        │
│ 项目管理 MCP（需求同步）                       │
│ 代码质量 MCP（风险评估）                       │
└─────────────────────────────────────────────────┘
  ↑ 约束
┌─────────────────── Rules 层 ───────────────────┐
│ 边界值分析强制规则                             │
│ 历史逻辑深挖规则                               │
│ 产物质量标准规则                               │
└─────────────────────────────────────────────────┘
  ↑ 驱动
┌─────────────────── Hooks 层 ───────────────────┐
│ UserPromptSubmit（关键词识别→注入规则）        │
│ PostToolUse（产物生成→提示下一步）             │
│ SessionStart（自动加载进度）                   │
│ Stop（会话结束→保存进度）                      │
└─────────────────────────────────────────────────┘
  ↑ 持久化
┌─────────────────── 记忆层 ─────────────────────┐
│ project 记忆（需求进度追踪）                   │
│ reference 记忆（模板位置、产物路径）           │
│ feedback 记忆（生成质量反馈）                  │
└─────────────────────────────────────────────────┘
```

---

> 本文档基于 Claude Code 官方能力和 OpenSpec 实践调研，最后更新：2026-04-10
> 建议从第一阶段开始渐进式实施，每完成一个阶段验证效果后再推进下一个。
