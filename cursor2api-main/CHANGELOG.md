# Changelog

## v2.7.7 (2026-03-23)

### 🩺 降级日志与可观测性增强

- **新增 `degraded` 状态**：将“工具看起来可用但未真正调用”、“`max_tokens` 截断且未自动续写”、“模型自述上一步输出被截断、正在补写”等情况从 `success` 中拆分出来
- **补充 `statusReason` / `issueTags`**：日志落盘、统计接口、Vue 日志页和旧版 `/logs` 页面均可显示降级原因并单独筛选
- **修复 Anthropic 工具统计失真**：`/v1/messages` 路径会正确写入 `toolCallsDetected`，不再出现 `stop_reason=tool_use` 但统计为 0 的情况

### ✂️ 长 Write/Edit 截断恢复修复

- **新增语义级截断检测**：即使 `json action` 代码块本身已经闭合，只要大负载 `Write/Edit` 参数尾部明显半截，也会继续判定为需要续写
- **OpenAI 流式长工具调用恢复**：OpenAI 兼容流式路径现在至少会尝试 1 次内部续写，修复长 `Write` 被截断后无法恢复完整多帧 `tool_calls` 的回归
- **补充回归测试**：新增并整理 `unit-handler-truncation.mjs` 与 `unit-openai-stream-truncation.mjs`，覆盖长 `Write/Edit` 截断、自愈补写和 OpenAI 流式恢复场景

---

## v2.7.5 (2026-03-19)

### 🏗️ 常量集中管理

- **新增 `constants.ts`**：将 `REFUSAL_PATTERNS`（50+ 条拒绝检测规则）、`IDENTITY_PROBE_PATTERNS`、`TOOL_CAPABILITY_PATTERNS`、`CLAUDE_IDENTITY_RESPONSE`、`CLAUDE_TOOLS_RESPONSE` 及自定义拒绝规则逻辑从 `handler.ts` 提取到独立文件
- **提升可维护性**：贡献者修改内置规则时只需查看 `constants.ts`，无需翻阅 2000 行的 handler 业务逻辑
- **`isRefusal()` 函数统一导出**：内置规则 + 自定义规则合并检测，所有调用点自动生效

### 🔧 自定义拒绝检测规则

- **`config.yaml` 新增 `refusal_patterns` 字段**：用户可添加自定义正则匹配规则，追加到内置列表之后（不替换），匹配到即触发重试逻辑
- **无效正则容错**：无效的正则表达式自动退化为字面量匹配，不会导致服务报错
- **缓存编译**：自定义规则只在配置变更时重新编译 RegExp，运行时零开销
- **热重载支持**：修改后下一次请求即生效

### 🔀 响应内容清洗开关

- **`config.yaml` 新增 `sanitize_response` 字段**：控制 `sanitizeResponse()` 函数（将 Cursor 身份引用替换为 Claude），**默认关闭**
- **环境变量支持**：`SANITIZE_RESPONSE=true` 可覆盖配置文件
- **零开销设计**：关闭时函数入口直接返回原文本，无正则计算
- **热重载支持**：修改配置后立即生效

---

## v2.7.4 (2026-03-18)

### 🛡️ 截断安全 — 防止损坏的工具调用

- **截断时跳过工具解析**：当响应被截断（`stop_reason=max_tokens`）时，不再尝试解析不完整的 `json action` 块，避免生成损坏的工具调用（如写入半截文件）
- **纯文本回退**：截断响应中的不完整工具块被自动剥离，剩余文本作为纯文本返回，由客户端（Claude Code）原生续写
- **默认禁用代理续写**：`maxAutoContinue` 默认值改为 `0`，让 Claude Code 原生处理续写（体验更好、进度可见），配置同步更新至 `config.yaml`、`config.yaml.example`、`docker-compose.yml`

### 🧹 提示词注入防御增强

- **身份声明清除**：自动剥离系统提示词中的 Claude Code / Anthropic 身份声明（`You are Claude Code`、`I'm Claude, made by Anthropic` 等），防止模型将其判定为 prompt injection 并拒绝服务
- **流式热身窗口扩大**：混合流式模式的 `warmupChars` 从 96 增至 300 字符，确保拒绝检测完成前不释放任何文本给客户端

### 📊 日志查看器增强

- **提示词对比视图**：「💬 提示词」tab 重命名为「💬 提示词对比」，分区展示原始请求 vs 转换后的 Cursor 消息
- **转换摘要面板**：顶部新增 6 格摘要（原始工具数 → Cursor 工具数 0、工具指令占用字符数、消息数变化、总上下文大小）
- **工具去向提示**：当有工具时显示黄色提示「Cursor API 不支持原生 tools 参数，N 个工具已转换为文本指令嵌入 user #1」
- **标题提取优化**：通用 XML 标签清除（覆盖所有注入标签）+ 清除 `Respond with the appropriate action` 引导语

---
## v2.7.2 (2026-03-17)

### 🖥️ 日志查看器全面升级

- **前端重构为独立静态文件**：`logs.html` / `logs.css` / `logs.js` 分离到 `public/` 目录，告别单文件嵌入，更易维护
- **🌙 日/夜主题切换**：一键切换明暗主题（☀️/🌙），自动检测系统偏好，选择持久化到 `localStorage`
- **暗色主题完整适配**：深蓝渐变背景，所有 UI 元素（标签、状态灯、代码块、JSON 高亮）均有独立暗色配色
- **标题提取修复**：过滤 `<system-reminder>...</system-reminder>` 注入内容和 Claude Code `"First, think step by step..."` 引导语，确保标题显示用户真实提问
- **登录页同步更新**：独立 `login.html`，视觉风格与日志页一致

### 🧹 工程化改进

- **移除 `WELL_KNOWN_TOOLS` 白名单**：所有工具统一保留描述（截取前 50 字符），简化逻辑
- **`config.yaml` 停止追踪**：含敏感 token 的配置文件加入 `.gitignore`，不再上传
- **新增 `config.yaml.example`**：配置模板，安全默认值，用户只需 `cp config.yaml.example config.yaml`
- **`.gitignore` 清理**：去除重复条目，排除开发截图文件
- **Thinking 默认关闭**：`thinking.enabled` 默认值改为 `false`
- **Express v5 兼容**：修复 `path-to-regexp` 通配符路由报错，改用 `express.static` 中间件
- **CSS 兼容性**：补充标准 `background-clip` 属性

### 📝 README 大幅更新

- 新增日志查看器功能介绍（特性列表 + 鉴权说明）
- 新增配置项速查表格
- 新增环境变量参考表
- 项目结构补充 `public/` 目录说明
- 配置说明改为引导用户从 `config.yaml.example` 复制

---

## v2.7.1 (2026-03-16)

### 🗜️ 智能历史压缩算法

- **修复 JSON Action 块截断**：之前朴素的 `substring` 截断会切断 `` ```json action `` 代码块，产生未闭合标记和不完整 JSON，严重误导模型。现在对包含工具调用的 assistant 消息，提取工具名生成摘要（如 `[Executed: Write, Read]`），不再做子串截断
- **工具结果头尾保留**：工具结果截断从"只保留头部"改为 **60% 头 + 40% 尾**，确保错误信息、stack trace 等末尾关键内容不丢失
- **修复非工具模式偏移量**：few-shot 消息跳过偏移量从硬编码 `+2` 改为动态计算 `hasTools ? 2 : 0`，修复非工具模式下前2条消息无法参与压缩的问题
- **自然边界截断**：普通文本在换行符处截断，避免切断单词或代码

### ⚙️ 可配置压缩系统

- 新增 `compression` 配置段（config.yaml），支持：
  - `enabled`：压缩开关（`true`/`false`），关闭后所有消息原样保留
  - `level`：压缩级别 1-3（轻度/中等/激进），每级预设不同的保留消息数和字符限制
  - `keep_recent`：高级选项，覆盖级别预设的保留消息数
  - `early_msg_max_chars`：高级选项，覆盖级别预设的早期消息字符上限
- 支持环境变量 `COMPRESSION_ENABLED` / `COMPRESSION_LEVEL`，方便 Docker 部署

### 🔐 日志查看器鉴权

- 配置了 `auth_tokens` 后，访问 `/logs` 及所有 `/api/logs*` 端点需要验证身份
- 精美的登录页面，输入 token 后通过 `/api/stats` 验证有效性
- Token 存入 `localStorage`，刷新页面无需重新输入
- 支持 query 参数 `?token=xxx`、`Authorization` header、`x-api-key` 三种传入方式
- 页面右上角显示退出按钮，清除缓存并跳回登录页
- 未配置 `auth_tokens` 时保持完全开放（向后兼容）

### 🧠 Thinking 拒绝误判修复

- **修复 thinking 触发拒绝检测**：模型的 `<thinking>` 内容中包含反思性语言（如 "haven't given a specific task"），被拒绝检测正则误判为拒绝响应
- 拒绝检测现在先剥离 `<thinking>` 标签内容，仅对实际输出文本进行检测
- 流式和非流式路径均已修复

### 🧠 OpenAI 格式 Thinking 默认启用

- OpenAI Chat Completions 协议不再依赖模型名包含 `thinking` 或传入 `reasoning_effort` 才启用
- 所有 OpenAI 格式请求默认启用 thinking，确保 Claude Code 等客户端始终获得推理内容

---

## v2.7.0 (2026-03-16)

### 🔐 API Token 鉴权

- **公网部署安全**：新增 `auth_tokens` 配置项，支持 Bearer token 鉴权
- 支持多 token（数组格式）、环境变量 `AUTH_TOKEN`、`x-api-key` 头
- 未配置时全部放行（向后兼容），GET 请求和 /health 端点无需鉴权
- 启动 banner 显示鉴权状态

### 🧠 Thinking 支持（客户端驱动）

- **Anthropic 协议**：请求体传 `thinking.type = "enabled"` 即启用
- **OpenAI 协议**：模型名含 `thinking` 或传 `reasoning_effort` 参数即启用
- 系统提示词注入 `<thinking>` 引导，模型输出自动提取
- Anthropic 返回 `thinking` content block，OpenAI 返回 `reasoning_content` 字段
- 提取在拒绝检测之前执行，防止 thinking 内容触发误判
- 未启用时仍会剥离 thinking 标签（防误判），但内容不返回

### 🔧 已知工具跳过描述（已在 v2.7.2 移除）

- `WELL_KNOWN_TOOLS` 集合中的 17 个常用工具（Read、Write、Bash 等）不再生成描述文本
- 减少约 30% 工具指令输入，节省上下文空间

### 📊 动态工具结果预算

- `getToolResultBudget()` 替代固定 15K 限制
- 根据当前上下文大小动态调整：小上下文 20K → 大上下文 8K
- `setCurrentContextChars()` 跟踪实际上下文字符数

### 🛡️ isTruncated 重写

- 重新实现截断检测逻辑，正确处理工具调用 JSON 中的反引号
- 优先检查 `` ```json action`` 代码块，避免 JSON 字符串值内的反引号导致误判
- 消除因误判导致的无限重试

### 📦 response_format 支持

- `OpenAIChatRequest` 新增 `response_format` 字段（`json_object` / `json_schema`）
- JSON 格式请求自动追加格式指令到最后一条用户消息
- `stripMarkdownJsonWrapper()` 自动剥离响应中的 markdown 代码块包装
- 流式和非流式路径均支持

### 🧹 计费头清除

- 自动清除系统提示词中的 `x-anthropic-billing-header`
- 防止模型将其判定为恶意伪造并触发注入警告

### 🌐 Vision 独立代理

- 新增 `vision.proxy` 配置项，图片分析 API 单独走代理
- Cursor API 保持直连（国内可用），不因代理影响响应速度
- 未配置时回退到全局 `proxy`

### 🛡️ 新增拒绝模式

- 补充 4 个 Cursor 新拒绝措辞：`isn't something I can help with`、`not something I can help with`、`scoped to answering questions about Cursor`、`falls outside`

---

## v2.5.6 (2026-03-12)

### 🗜️ 渐进式历史压缩

- **新策略**：保留最近 6 条消息完整不动，仅压缩早期消息中超过 2000 字符的文本部分
- 不删除任何消息（保留完整对话结构），只截短单条消息的超长文本
- 兼顾上下文完整性与输出空间，替代之前被移除的全删式智能压缩
- 工具描述截断从 200 → **80 字符**（Schema 已包含参数信息，短描述节省输入体积）
- 工具结果截断从 30000 → **15000 字符**（为输出留更多空间）

### 🔧 续写智能去重

- **问题**：模型续写时经常重复截断点附近的内容，拼接后出现重复段落
- **新增 `deduplicateContinuation()`**：在原内容尾部和续写头部之间搜索最长重叠，自动移除重复部分
- 支持字符级精确匹配和行级模糊匹配两种去重策略
- 去重后无新内容时自动停止续写（防止无限循环）
- 流式和非流式路径均已集成

### ⚡ 非流式截断续写（与流式路径对齐）

- **问题**：非流式模式下 Write 大文件等长输出被截断后，Claude Code 直接收到不完整的工具调用 JSON，导致 `tool_use` 退化为纯文本
- **修复**：非流式路径新增内部截断续写（最多 6 次），与流式路径逻辑完全对齐
- 新增 `tool_choice=any` 强制重试（非流式）：模型未输出工具调用时自动追加强制消息重试
- 新增极短响应重试（非流式）：响应 < 10 字符时自动重试

### 📊 Token 估算优化

- 提取 `estimateInputTokens()` 为独立函数，Anthropic 和 OpenAI handler 共用
- 估算比例从 1/4 调整为 **1/3**（更适合中英文混合和代码场景）+ 10% 安全边距
- 新增工具定义的 token 估算（每个压缩工具签名 ~200 chars + 1000 chars 指令开销）
- 替代之前 `input_tokens: 100` 的硬编码占位符

### 🛡️ JSON 解析器加固

- **反斜杠计数精确化**：`tolerantParse` 和 `parseToolCalls` 中的字符串状态跟踪从 `escaped` 布尔标志改为**反向计数连续反斜杠**，正确处理 `\\\"` (未转义) vs `\\\\\\\"` (已转义) 等边界情况
- **新增第五层逆向贪婪提取**：当所有 JSON 修复手段失败时，对 Write/Edit 等工具的 `content`/`command`/`text` 等大值字段进行逆向贪婪提取，从 JSON 末尾向前搜索值的结束引号
- 小值字段（`file_path`、`path` 等）仍用精确正则提取

---

## v2.5.5 (2026-03-12)

### 🐛 修复长响应误判为拒绝

- **问题**：工具模式下，模型输出长文本（如 8654 字符的深度分析报告），正文中碰巧包含 `无法提供...信息`、`工具调用场景`、`即报错` 等拒绝检测关键词，导致整个响应被替换为无意义的引导文本 `"I understand the request..."`，进而 Claude Code 陷入死循环
- **修复策略**：
  - 截断响应（`stop_reason=max_tokens`）完全跳过拒绝检测 — 8654 字符的响应不可能是拒绝
  - 长响应（≥ 500 字符）仅检查**前 300 字符**是否包含拒绝模式 — 拒绝一定在开头
  - 短响应（< 500 字符）保持全文检测 — 真正的拒绝回复通常很短
- 流式和非流式处理均已修复

### 🔇 减少 tolerantParse 日志噪音

- 模型输出中的普通 JSON 代码块（如含正则 `[\s\S]*?` 的代码示例）不再打印 `error` 级别日志
- 仅当内容包含 `"tool"` / `"name"` 键（疑似工具调用）时才报 error，其余降为 `warn` 级别

---
## v2.5.4 (2026-03-11)

### 🌐 内网代理支持 (Issue #17)

- **修复 `fetch failed`**：Node.js 原生 `fetch()` 不读取 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，内网用户设置这些变量后请求仍然直连失败
- **新增 `proxy-agent.ts`**：使用 `undici.ProxyAgent` 作为 fetch dispatcher，所有外发请求（Cursor API、Vision API）均可通过 HTTP 代理转发
- **配置方式**：在 `config.yaml` 中设置 `proxy` 字段，或通过 `PROXY` 环境变量指定（支持 `http://用户名:密码@代理:端口` 格式）
- **单元测试**：新增 16 个测试用例覆盖代理模块的核心逻辑

---
## v2.5.3 (2026-03-11)

### 🗜️ Schema 压缩 — 根治截断问题

- **根本原因定位**：90 个工具的完整 JSON Schema 占用 ~135,000 chars，导致 Cursor API 输出预算仅 ~3,000 chars，Write/Edit 工具的 content 参数被严重截断
- **compactSchema() 压缩**：将完整 JSON Schema 转为紧凑类型签名（如 `{file_path!: string, encoding?: utf-8|base64}`），输入体积降至 ~15,000 chars
- **工具描述截断**：每个工具描述最多 200 chars，避免个别工具（如 Agent）的超长描述浪费 token
- **效果**：输出预算从 ~3k 提升到 ~8k+ chars，Write 工具可一次写入完整文件

### 🔧 JSON-String-Aware 解析器

- **修复致命 Bug**：旧的 lazy regex `/```json[\s\S]*?```/g` 会在 JSON 字符串值内部的 ``` 处提前闭合，导致 Write/Edit 工具的 content 参数（如含 markdown 代码块的文档）被截断为仅前几行
- **新实现**：手动扫描器跟踪 JSON 字符串状态（`"` 配对 + `\` 转义），只在字符串外部匹配闭合 ```
- **截断恢复**：无闭合 ``` 的代码块也能通过 tolerantParse 恢复工具调用

### ⚠️ 续写机制重写

- **修复空响应问题**：旧实现只追加 assistant 消息，Cursor API 看到最后是 assistant 的消息后返回空响应
- **新实现**：每次续写添加 user 引导消息 + 最后 300 chars 上下文锚点
- **防膨胀**：每次基于原始消息快照重建，而非累积消息
- **MAX_AUTO_CONTINUE** 从 4 提升至 6

---
## v2.5.2 (2026-03-11)

### 🗜️ 移除上下文智能压缩 (Reverted)

移除上一版本引入的“智能压缩替裁剪”功能。
- **原因**：Claude Code等Agent非常依赖完整的工具调用历史（尤其是 `Read` 和 `Bash` 的具体输出）来决定下一步行动。将 `Action output` 压缩为 `[30000 chars...]` 以及将历史命令压缩为 `[System Note...]` 会导致大模型“失忆”，进而在多轮对话中陷入死循环、产生幻觉，甚至复读 `[Called Bash...]` 等错误格式。
- **替代方案**：通过新增的 `isTruncated` 自动检测并返回 `stop_reason: "max_tokens"`，已经能有效解决需要频繁点“继续”按钮的问题，因此粗暴的历史压缩不再被需要。

### ⚠️ 截断无缝续写 (Internal Auto-Continue)

- **Proxy-Side 无缝拼接**：彻底解决大文件编辑（如 `Write` 工具写了几万字）时被 API 截断，导致 JSON 解析失败、变为普通文本从而丢失工具调用的致命问题！
- **自动检测与请求**：当模型输出触发截断（如代码块/XML未闭合），Proxy 将在 **底层直接自动重试续写**，无需任何额外交互。
- **防止工具调用退化为文本**：由于 Anthropic API 会在不同消息间打断工具调用块，造成 Claude Code 将 `{"tool": "Write", ...}` 降级为屏幕上的纯文本并崩溃停顿（Crunched 几分钟）。现在，Proxy 会内部拼接 2-4 次请求，始终将一个完整未截断的 JSON 动作一次性抛给 Claude Code，极大提高了多轮复杂任务的成功率！

### 🔧 工具参数容错 (tool-fixer)

- **移除隐式重命名 `file_path` 为 `path` 行动**：修复 Claude Code 2.1.71 中 `Read` 工具因为必需参数 `file_path` 被强制丢弃而陷入请求验证失败死循环的问题。
- **新增第四层正则兜底**：当模型生成的 JSON 工具调用包含未转义双引号（如代码内容参数）导致标准解析和控制字符修复均失败时，使用正则提取 `tool` 名称和 `parameters` 字段
- 解决 `SyntaxError: Expected ',' or '}'` at position 5384 等长参数解析崩溃问题

### 🛡️ 拒绝 Fallback 优化

- 工具模式下拒绝时返回极短文本 `"Let me proceed with the task."`，避免 Claude Code 误判为任务完成

---

## v2.5.0 (2026-03-10)

- OpenAI Responses API (`/v1/responses`) 支持 Cursor IDE Agent 模式
- 跨协议防御对齐（Anthropic + OpenAI handler 共享拒绝检测和重试逻辑）
- 统一图片预处理管道（OCR/Vision API）
