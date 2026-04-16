***

tags:

- Claude Code
- AI编程
- 记忆系统
- 命令速查

***

# Claude Code 命令速查与记忆系统完整指南

***

## 第一类：高频基础命令（必须掌握）

这些命令在日常开发中使用频率最高：

### `/help` - 查看帮助

- **作用**：显示所有可用命令的帮助信息
- **使用场景**：忘记命令时快速查阅

### `/clear` - 清空对话

- **作用**：清空当前会话的所有对话历史
- **使用场景**：想重新开始对话时
- **注意**：会保留项目记忆，仅清空对话内容

### `/fast` - 快速模式（CC模型限用）

- **作用**：切换到快速模式（使用 Haiku 模型）
- **使用场景**：简单任务、快速查询、不需要深度思考的场景

### `/slow` - 详细模式（CC模型限用）

- **作用**：切换到详细模式（使用 Sonnet/Opus 模型）
- **使用场景**：复杂任务、需要深度思考、代码重构等

### `/commit` - Git 提交

- **作用**：自动分析变更并创建 Git 提交
- **功能**：
  - 自动分析 `git diff`
  - 生成合适的提交信息
  - 添加相关文件到暂存区
  - 创建提交（包含 `Co-Authored-By`）
- **注意**：不会自动 push，仅创建本地提交

### `/btw` - 随手记（重要！）

- **作用**：快速记录想法、灵感、待办事项等到项目记忆
- **优势**：
  - 无需切换上下文
  - 自动保存到项目记忆
  - 支持未来会话中回忆

***

## 第二类：会话管理命令

### `/resume` - 恢复会话（五星）

- **作用**：恢复历史会话
- **不带参数**：显示最近会话列表
- **带会话ID**：恢复指定会话

### `/tasks` - 任务管理（四星）

- **作用**：查看当前任务列表
- **功能**：
  - 显示所有待办任务
  - 显示任务状态
  - 显示任务依赖关系

***

## 第三类：高级功能命令

### `/plan` - 计划模式（一星）

> ps：主要是 OpenSpec 出现让它显得有点没必要了

- **作用**：进入计划模式，制定实施计划

### `/loop` - 循环任务（五星）

> ps：可以和 OpenSpec 结合让它去修改代码中的方案，存档等

- **作用**：按固定间隔重复执行命令

### `/schedule` - 定时任务（五星）

> 可以配合任何一个命令使用

- **作用**：创建定时任务（cron 风格）

***

## 第四类：配置管理命令

### `/plugin` - 插件管理

```
/plugin list              # 列出已安装插件
/plugin install <插件名>   # 安装插件
/plugin remove <插件名>    # 卸载插件
```

### `/memory` - 记忆管理

```
/memory list              # 列出所有记忆
/memory show <记忆名>      # 查看指定记忆
/memory forget <记忆名>    # 删除记忆
```

### `/forget` - 忘记记忆

- **作用**：删除指定的项目记忆

### `/hook` - 钩子管理

- **作用**：管理自动化钩子（Hooks），在特定事件触发时自动执行命令
- <br />
- **配置方式**：通过 `settings.json` 中的 `hooks` 字段配置

**钩子事件类型包括**：`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`SessionEnd`

**配置示例**：

```json
{
  "hooks": {
    "preEdit": [
      {
        "description": "编辑前自动备份",
        "command": "mkdir -p .claude/backups && cp {{file_path}} .claude/backups/{{timestamp}}.bak"
      }
    ],
    "postEdit": [
      {
        "description": "Java 代码自动格式化",
        "command": "if echo '{{file_path}}' | grep -q '\\.java$'; then google-java-format -i {{file_path}}; fi"
      },
      {
        "description": "自动添加到 git",
        "command": "git add {{file_path}}"
      }
    ]
  }
}
```

***

## 其他实用命令

- `/continue` - 继续对话（等同于 `-c` 参数）
- `/skip` - 跳过某些自动操作或提示

***

## 命令速查表

\[图片：命令速查表电子表格]

***

## 使用技巧

### 技巧1：组合使用命令

| 场景     | 命令组合         |
| ------ | ------------ |
| 快速查阅文档 | `/fast` + 查阅 |
| 复杂代码重构 | `/slow` + 重构 |
| 提交代码   | `/commit`    |
| 查看进度   | `/tasks`     |

### 技巧2：命令与自然语言结合

将命令与自然语言描述结合使用，可以让 Claude Code 更好地理解你的意图。

***

# Claude Code 记忆系统完整指南

***

## 一、什么是记忆系统？

Claude Code 的记忆系统是一个**多层次的持久化上下文存储机制**，解决 AI 无状态的核心问题。

**核心能力**：

- 跨会话记住用户偏好、项目背景、工作习惯
- 自动学习并保存项目模式和见解
- 多层次架构：全局 → 项目 → 个人，分层管理

**工作流程**：

```
会话启动 → 扫描并加载记忆文件 → 注入系统提示 → 处理用户输入 → 自动/手动保存新记忆
```

***

## 二、记忆层次架构（按优先级排序）

\[图片：记忆层次表格]

> **优先级规则**：高优先级覆盖低优先级。用户级设置可被项目级覆盖。

***

## 三、四种自动记忆类型

### 3.1 user - 用户记忆

\[图片：表格]

**示例**：

```yaml
---
name: user_role
description: 用户角色和技术背景
type: user
---
```

> 用户是 Java 后端高级开发工程师，熟悉 Spring Boot、MyBatis-Plus。对前端（Vue/React）不太熟悉，解释前端概念时用后端类比。偏好简洁直接的回答风格，不需要过多解释。

### 3.2 feedback - 反馈记忆

\[图片：表格]

> **文件结构要求**：规则 + Why（原因）+ How to apply（如何应用）

**示例**：

```yaml
---
name: feedback_testing
description: 测试相关的工作方式反馈
type: feedback
---
```

> 集成测试必须连接真实数据库，不使用 Mock。
>
> **Why**: 上季度出现过 Mock 测试通过但生产迁移失败的事故。
>
> **How to apply**: 编写测试时直接连真实数据库，不 mock 数据层。

### 3.3 project - 项目记忆

\[图片：表格]

**示例**：

```yaml
---
name: project_auth_rewrite
description: 认证中间件重写背景
type: project
---
```

> 认证中间件重写是因为法务标记 session token 存储方式不符合新合规要求。
>
> **Why**: 合规要求，不是技术债务清理。
>
> **How to apply**: 范围决策应优先合规性而非开发体验。

### 3.4 reference - 参考记忆

\[图片：表格]

**示例**：

```yaml
---
name: reference_monitoring
description: 监控和告警相关的外部资源
type: reference
---
```

> - Grafana 面板：`grafana.internal/d/api-latency`（值班监控用）
> - Linear 项目 "INGEST"：跟踪所有管道 Bug
> - Slack `#deployments` 频道：发布通知

***

## 四、MEMORY.md 索引文件

### 4.1 作用

自动记忆系统的**主索引文件**，每次会话启动时自动加载。

### 4.2 关键规则

\[图片：表格]

### 4.3 格式

```markdown
# 项目记忆

- [用户角色](user_role.md) --- Java 高级后端开发，偏好简洁回答
- [测试反馈](feedback_testing.md) --- 集成测试必须连真实数据库
- [认证重写](project_auth_rewrite.md) --- 法务合规驱动的中间件重写
- [外部资源](reference_monitoring.md) --- Grafana、Linear、Slack 链接
```

### 4.4 目录结构

```
~/.claude/projects/D--project-crmorder-gaodun-com/memory/
├── MEMORY.md            # 主索引（自动加载前200行）
├── user_role.md         # 用户角色记忆
├── feedback_testing.md  # 反馈记忆
├── project_auth.md      # 项目背景记忆
└── reference_monitoring.md # 参考资源记忆
```

***

## 五、记忆的加载机制

### 5.1 加载顺序

1. 托管策略文件（组织级）
2. 托管插件目录（按字母顺序合并）
3. 项目 `CLAUDE.md`（根目录）
4. `.claude/CLAUDE.md`
5. `.claude/rules/*.md`（项目规则）
6. `~/.claude/CLAUDE.md`（用户全局）
7. `~/.claude/rules/*.md`（用户规则）
8. `CLAUDE.local.md`（本地项目）
9. 自动记忆 `MEMORY.md`（前200行）

### 5.2 导入机制

在 `CLAUDE.md` 中可以使用 `@path` 语法导入外部内容：

```
@README.md
@docs/architecture.md
@~/.claude/my-instructions.md
```

支持最多 **5 层嵌套导入**。

***

## 六、什么不应保存到记忆中

\[图片：表格]

***

## 七、记忆相关命令速查

\[图片：表格]

***

## 八、自动记忆的工作方式

### 8.1 Claude 何时自动保存记忆

| 触发条件       | 保存类型             |
| ---------- | ---------------- |
| 了解到用户身份/偏好 | `user` 类型记忆      |
| 收到工作方式反馈   | `feedback` 类型记忆  |
| 了解到项目背景/决策 | `project` 类型记忆   |
| 了解到外部资源位置  | `reference` 类型记忆 |

### 8.2 启用/禁用自动记忆

**方式一：环境变量**

```bash
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude
```

**方式二：settings.json 配置**

```json
{
  "autoMemoryEnabled": false
}
```

### 8.3 自定义记忆目录

```json
{
  "autoMemoryDirectory": "/path/to/custom/memory/directory"
}
```

***

## 九、记忆的生命周期与新鲜度管理

### 9.1 生命周期

```
创建 → 自动/手动加载 → 使用 → 更新/验证 → 清理
```

### 9.2 记忆可能过期的情况

- 文件路径被重命名或删除
- 函数/方法被重构或移除
- 项目技术栈发生变更
- 团队规范发生调整

### 9.3 如何验证记忆是否仍然有效

\[图片：表格]

> **关键原则**：记忆记录的是"过去某个时间点的事实"。使用前应验证，如果与当前状态冲突，以当前观察为准，并更新或删除过期记忆。

***

## 十、记忆管理最佳实践

### 推荐做法

- 具体而非模糊
- 包含 Why
- 定期清理
- 项目 `CLAUDE.md` 提交到 git
- `MEMORY.md` 保持简洁

### 避免的做法

- 不要创建过多记忆文件
- 不要在记忆中存储敏感信息
- 不要重复代码中已有的信息
- 不要让 `MEMORY.md` 超过 200 行
- 不要保存临时/会话级状态到记忆

### 实战建议

```bash
# 新项目启动：初始化项目记忆
/init

# 开发过程中：随时记录关键信息
/btw 数据库迁移脚本在 src/main/resources/db/
/remember 分支命名规范：feature_日期_描述

# 定期维护：清理过期记忆
/memory list
/memory forget outdated-idea

# 重大变更后：更新相关记忆
```

***

## 十一、记忆系统与其他持久化机制的区别

\[图片：表格]

### 选择原则

| 持久化类型         | 适用场景        |
| ------------- | ----------- |
| **记忆**        | 需要在未来会话中使用的 |
| **计划**        | 当前任务的实施规划   |
| **任务**        | 当前会话的进度跟踪   |
| **CLAUDE.md** | 固定不变的项目规范   |

***

> 用法总结参考：<https://www.ginonotes.com/posts/how-i-use-every-claude-code-feature>

