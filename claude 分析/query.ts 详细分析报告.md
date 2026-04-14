# query.ts 详细分析报告

> 文件路径：`src/query.ts`  
> 文件大小：1729 行  
> 核心功能：Claude Code 的查询引擎主循环

---

## 一、文件概述

`query.ts` 是 Claude Code 的**核心查询引擎**，负责管理对话生命周期、处理 API 请求、执行工具调用、管理上下文压缩等复杂逻辑。

### 1.1 主要功能

| 功能 | 说明 |
|------|------|
| API 请求管理 | 调用 AI 模型，处理流式响应 |
| 工具调用执行 | 解析和执行 tool_use 块 |
| 上下文压缩 | 自动 compact、reactive compact、context collapse |
| 错误恢复 | 处理 prompt-too-long、max_output_tokens 等错误 |
| 预算控制 | Token 预算管理和续期 |
| 记忆预取 | 相关记忆的异步预加载 |
| 附件处理 | 文件变更、命令队列等附件消息 |

---

## 二、核心数据结构

### 2.1 QueryParams（查询参数）

**定义位置**：第 181-199 行

```typescript
export type QueryParams = {
  messages: Message[]                    // 对话历史
  systemPrompt: SystemPrompt            // 系统提示词
  userContext: { [k: string]: string }   // 用户上下文
  systemContext: { [k: string]: string } // 系统上下文
  canUseTool: CanUseToolFn              // 工具权限检查函数
  toolUseContext: ToolUseContext        // 工具使用上下文
  fallbackModel?: string                // 备用模型
  querySource: QuerySource              // 查询来源
  maxOutputTokensOverride?: number      // 最大输出 token 覆盖
  maxTurns?: number                     // 最大轮数限制
  skipCacheWrite?: boolean              // 是否跳过缓存写入
  taskBudget?: { total: number }        // 任务预算
  deps?: QueryDeps                      // 依赖注入
}
```

### 2.2 State（循环状态）

**定义位置**：第 203-217 行

```typescript
type State = {
  messages: Message[]                                    // 当前消息列表
  toolUseContext: ToolUseContext                        // 工具上下文
  autoCompactTracking: AutoCompactTrackingState | undefined  // 自动压缩跟踪
  maxOutputTokensRecoveryCount: number                  // 输出 token 恢复计数
  hasAttemptedReactiveCompact: boolean                  // 是否已尝试 reactive compact
  maxOutputTokensOverride: number | undefined           // 最大输出 token 覆盖
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined  // 待处理的工具使用摘要
  stopHookActive: boolean | undefined                   // stop hook 是否激活
  turnCount: number                                     // 当前轮数
  transition: Continue | undefined                      // 上一轮继续的原因
}
```

---

## 三、主循环架构

### 3.1 入口函数

**`query()` 函数**（第 219-239 行）

```typescript
export async function* query(params: QueryParams): AsyncGenerator<...> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  
  // 通知所有已消费的命令已完成
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

这是外部调用的入口，主要作用是：
- 跟踪消费的命令 UUID
- 在循环结束后通知命令生命周期

### 3.2 核心循环

**`queryLoop()` 函数**（第 241-1728 行）

这是一个巨大的异步生成器函数，采用 `while (true)` 无限循环模式，通过 `continue` 和 `return` 控制流程。

#### 循环流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                         queryLoop 主循环                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 状态解构 (第 311-321 行)                                      │
│     └── 从 state 中读取当前迭代所需的所有状态                       │
│                                                                 │
│  2. Skill 预取 (第 331-335 行)                                    │
│     └── 异步预取相关 skills                                       │
│                                                                 │
│  3. 上下文压缩链 (第 400-467 行)                                   │
│     ├── Snip Compact (可选)                                       │
│     ├── Micro Compact                                             │
│     ├── Context Collapse (可选)                                   │
│     └── Auto Compact                                              │
│                                                                 │
│  4. Token 预算检查 (第 628-648 行)                                 │
│     └── 检查是否达到阻塞限制                                        │
│                                                                 │
│  5. API 调用循环 (第 654-954 行)                                   │
│     └── 处理流式响应，支持模型回退                                  │
│                                                                 │
│  6. 错误恢复 (第 1062-1256 行)                                     │
│     ├── Prompt Too Long 恢复                                      │
│     ├── Media Size 错误恢复                                       │
│     └── Max Output Tokens 恢复                                    │
│                                                                 │
│  7. Stop Hooks (第 1267-1306 行)                                  │
│     └── 执行停止钩子，检查是否阻止继续                              │
│                                                                 │
│  8. Token 预算续期 (第 1308-1355 行)                               │
│     └── 检查是否需要继续生成                                        │
│                                                                 │
│  9. 工具执行 (第 1363-1408 行)                                    │
│     └── 执行所有 tool_use 块                                       │
│                                                                 │
│  10. 工具摘要生成 (第 1412-1482 行)                                │
│      └── 异步生成工具使用摘要                                       │
│                                                                 │
│  11. 附件处理 (第 1580-1690 行)                                    │
│      ├── 命令队列附件                                              │
│      ├── 记忆预取消费                                              │
│      └── Skill 发现结果                                            │
│                                                                 │
│  12. 递归继续 (第 1715-1727 行)                                    │
│      └── 更新 state 并 continue 到下一轮                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、关键功能详解

### 4.1 上下文压缩链

#### 4.1.1 Snip Compact（第 401-410 行）

```typescript
if (feature('HISTORY_SNIP')) {
  queryCheckpoint('query_snip_start')
  const snipResult = snipModule!.snipCompactIfNeeded(messagesForQuery)
  messagesForQuery = snipResult.messages
  snipTokensFreed = snipResult.tokensFreed
  if (snipResult.boundaryMessage) {
    yield snipResult.boundaryMessage
  }
  queryCheckpoint('query_snip_end')
}
```

**功能**：从历史消息中删除不必要的内容，释放 token。

#### 4.1.2 Micro Compact（第 413-426 行）

```typescript
const microcompactResult = await deps.microcompact(
  messagesForQuery,
  toolUseContext,
  querySource,
)
messagesForQuery = microcompactResult.messages
```

**功能**：轻量级压缩，通常用于缓存编辑。

#### 4.1.3 Context Collapse（第 440-447 行）

```typescript
if (feature('CONTEXT_COLLAPSE') && contextCollapse) {
  const collapseResult = await contextCollapse.applyCollapsesIfNeeded(
    messagesForQuery,
    toolUseContext,
    querySource,
  )
  messagesForQuery = collapseResult.messages
}
```

**功能**：将相关消息折叠成摘要，保持上下文粒度。

#### 4.1.4 Auto Compact（第 453-467 行）

```typescript
const { compactionResult, consecutiveFailures } = await deps.autocompact(
  messagesForQuery,
  toolUseContext,
  { systemPrompt, userContext, systemContext, toolUseContext, forkContextMessages: messagesForQuery },
  querySource,
  tracking,
  snipTokensFreed,
)
```

**功能**：全自动上下文压缩，当 token 数超过阈值时触发。

### 4.2 API 流式处理

#### 4.2.1 主循环（第 654-954 行）

```typescript
while (attemptWithFallback) {
  attemptWithFallback = false
  try {
    for await (const message of deps.callModel({...})) {
      // 处理流式消息
      // 1. 处理回退情况
      // 2. 工具输入回填
      // 3. 错误保留（prompt-too-long, max_output_tokens）
      // 4. 收集 tool_use 块
      // 5. 流式工具执行
    }
  } catch (innerError) {
    // 处理模型回退
    if (innerError instanceof FallbackTriggeredError && fallbackModel) {
      currentModel = fallbackModel
      attemptWithFallback = true
      // 清理并重试
    }
  }
}
```

#### 4.2.2 错误保留机制（第 799-825 行）

```typescript
let withheld = false
if (feature('CONTEXT_COLLAPSE')) {
  if (contextCollapse?.isWithheldPromptTooLong(message, isPromptTooLongMessage, querySource)) {
    withheld = true
  }
}
if (reactiveCompact?.isWithheldMaxOutputTokens(message)) {
  withheld = true
}
if (!withheld) {
  yield yieldMessage
}
```

**关键设计**：某些错误（如 prompt-too-long）不会立即抛出，而是保留到后续尝试恢复。

### 4.3 工具执行

#### 4.3.1 流式 vs 非流式（第 1366-1382 行）

```typescript
const toolUpdates = streamingToolExecutor
  ? streamingToolExecutor.getRemainingResults()
  : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

for await (const update of toolUpdates) {
  if (update.message) {
    yield update.message
    toolResults.push(...)
  }
  if (update.newContext) {
    updatedToolUseContext = { ...update.newContext, queryTracking }
  }
}
```

**两种模式**：
- **流式**：工具在 API 响应流式传输时并行执行
- **非流式**：等待完整响应后串行执行

### 4.4 错误恢复策略

#### 4.4.1 Prompt Too Long 恢复（第 1085-1117 行）

```typescript
if (isWithheld413) {
  // 第一步：尝试 Context Collapse 恢复
  if (feature('CONTEXT_COLLAPSE') && contextCollapse && 
      state.transition?.reason !== 'collapse_drain_retry') {
    const drained = contextCollapse.recoverFromOverflow(messagesForQuery, querySource)
    if (drained.committed > 0) {
      state = { ...state, messages: drained.messages, transition: { reason: 'collapse_drain_retry' } }
      continue
    }
  }
}
```

#### 4.4.2 Reactive Compact 恢复（第 1119-1166 行）

```typescript
if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
  const compacted = await reactiveCompact.tryReactiveCompact({...})
  if (compacted) {
    state = { ...state, messages: postCompactMessages, transition: { reason: 'reactive_compact_retry' } }
    continue
  }
  // 恢复失败，抛出错误
}
```

#### 4.4.3 Max Output Tokens 恢复（第 1188-1256 行）

```typescript
if (isWithheldMaxOutputTokens(lastMessage)) {
  // 第一步：升级到 64k tokens
  if (capEnabled && maxOutputTokensOverride === undefined) {
    state = { ...state, maxOutputTokensOverride: ESCALATED_MAX_TOKENS }
    continue
  }
  
  // 第二步：多轮恢复（最多 3 次）
  if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
    const recoveryMessage = createUserMessage({...})
    state = { ...state, messages: [...messages, recoveryMessage], maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1 }
    continue
  }
}
```

---

## 五、状态转换图

```
┌────────────────────────────────────────────────────────────────────────┐
│                              State 转换                                 │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Initial                                                               │
│    │                                                                   │
│    ▼                                                                   │
│  ┌─────────────────┐                                                   │
│  │  API 调用        │◄─────────────────────────────────────────────┐   │
│  │  (callModel)     │                                              │   │
│  └────────┬────────┘                                              │   │
│           │                                                        │   │
│    ┌──────┴──────┬──────────────┬──────────────┐                  │   │
│    ▼             ▼              ▼              ▼                  │   │
│  Success    Prompt Too    Max Output    Tool Use                  │   │
│    │          Long         Tokens        Blocks                    │   │
│    │            │             │             │                      │   │
│    ▼            ▼             ▼             ▼                      │   │
│  Return   Collapse/      Escalate/     Execute                    │   │
│  Done     Reactive       Multi-turn     Tools                     │   │
│           Compact         Recovery                              │   │
│             │                │             │                      │   │
│             └────────────────┴─────────────┘                      │   │
│                          │                                         │   │
│                          ▼                                         │   │
│                   ┌─────────────┐                                  │   │
│                   │  Continue   │──────────────────────────────────┘   │
│                   │  (next turn)│                                      │
│                   └─────────────┘                                      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 六、关键常量

| 常量 | 值 | 说明 | 位置 |
|------|-----|------|------|
| `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT` | 3 | 最大输出 token 恢复尝试次数 | 第 164 行 |
| `ESCALATED_MAX_TOKENS` | 64000 | 升级后的最大输出 token 数 | `src/utils/context.ts` |

---

## 七、性能检查点

**`queryCheckpoint()` 调用位置**：

| 检查点 | 说明 |
|--------|------|
| `query_fn_entry` | 函数入口 |
| `query_snip_start/end` | Snip Compact 开始/结束 |
| `query_microcompact_start/end` | Micro Compact 开始/结束 |
| `query_autocompact_start/end` | Auto Compact 开始/结束 |
| `query_setup_start/end` | 查询设置开始/结束 |
| `query_api_loop_start` | API 循环开始 |
| `query_api_streaming_start/end` | API 流式传输开始/结束 |
| `query_tool_execution_start/end` | 工具执行开始/结束 |
| `query_recursive_call` | 递归调用 |

---

## 八、依赖注入

**`QueryDeps` 接口**（定义在 `src/query/deps.ts`）：

```typescript
export type QueryDeps = {
  callModel: typeof callModelWithStreaming
  autocompact: typeof autocompact
  microcompact: typeof microcompact
  uuid: () => string
}
```

**生产依赖**（`src/query/deps.ts`）：

```typescript
export const productionDeps = (): QueryDeps => ({
  callModel: callModelWithStreaming,
  autocompact,
  microcompact,
  uuid: () => randomUUID(),
})
```

---

## 九、总结

`query.ts` 是 Claude Code 的**心脏**，负责：

1. **对话生命周期管理**：通过无限循环和状态机管理多轮对话
2. **智能上下文压缩**：多级压缩策略（Snip → Micro → Collapse → Auto）
3. **健壮的错误恢复**：针对各种 API 错误的恢复策略
4. **流式工具执行**：支持并行工具执行以提高效率
5. **预算和限制管理**：Token 预算、轮数限制等

这个文件体现了 Claude Code 的核心设计理念：**在有限的上下文窗口内，尽可能多地完成用户任务**。

---

*报告生成时间：2026-04-14*
