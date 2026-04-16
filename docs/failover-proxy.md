# Failover Proxy 配置指南

> 自动故障转移 + 测速 | cc-haha 专用

## 架构

```
cc-haha → localhost:9018 (Failover代理)
              ↓ 自动选择最快模型
         zen2api (9019)
              ↓
         [minimax | nvidia | kilo | bytedance ...]
```

## 问题背景

- zen2api 集成了8个免费模型
- minimax-m2.5-free 经常 502 不稳定
- 需要自动选择最快的模型
- 失败时自动切换到下一个

## 解决方案

### 1. 文件结构

| 文件 | 说明 |
|-----|------|
| `bin/api-failover-proxy.cjs` | 故障转移代理程序 |
| `.env` | cc-haha 配置文件 |

### 2. 配置 `.env`

```bash
# API 认证
ANTHROPIC_AUTH_TOKEN=liumiao

# Failover 代理地址
ANTHROPIC_BASE_URL=http://localhost:9018

# 模型由代理自动选择
ANTHROPIC_MODEL=
```

### 3. 启动代理

```bash
cd D:/项目/claude code official/cc-haha
./bin/api-failover-proxy.cjs
```

### 4. 启动 cc-haha

```bash
cd D:/项目/claude code official/cc-haha
./bin/claude-haha
```

## 功能说明

### 自动测速

- 启动时自动测8个模型
- 按响应时间排序
- 最快的排在前面

### 模型列表（按速度）

| 排名 | 模型 | 来源 |
|-----|------|-----|
| 1 | kilo-auto/free | Kilo Code |
| 2 | arcee-ai/trinity-large-thinking | Arcee AI |
| 3 | openrouter/elephant-alpha | OpenRouter |
| 4 | bytedance-seed/dola-seed-2.0-pro | 字节跳动 |
| 5 | openrouter/free | OpenRouter |
| 6 | nvidia/nemotron-3-super | NVIDIA |
| 7 | minimax-m2.5-free | MiniMax |
| 8 | x-ai/grok-code-fast | xAI |

### 故障转移

- 失败3次自动切换
- 每5分钟重新测速
- 恢复成功后切回最快模型

## 组件端口

| 端口 | 服务 |
|-----|------|
| 9018 | Failover Proxy (我们的) |
| 9019 | zen2api (原本的) |

## 命令行工具

### 测速所有模型

```bash
cd D:/项目/claude code official/cc-haha
node cc-failover.cjs
```

### 测试代理

```bash
curl -X POST http://localhost:9018/v1/chat/completions \
  -H "Authorization: Bearer liumiao" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
```

## 故障排除

### 端口占用

```bash
# 查看端口占用
netstat -ano | findstr "9018"

# 杀掉进程
taskkill //F //PID <PID>
```

### 重启代理

```bash
# 先杀掉
taskkill //F //IM node.exe

# 再启动
cd D:/项目/claude code official/cc-haha
./bin/api-failover-proxy.cjs
```

## 技术原理

### 1. HTTP 代理

代理收到请求后，转发到 zen2api，并处理响应。

### 2. 故障检测

- HTTP 500+ 错误
- 连接超时
- 响应错误

### 3. 熔断器模式

```
连续失败 3 次 → 打开熔断器 → 切换模型
60秒后尝试恢复 → 成功则切回
```

### 4. 定时测速

每5分钟重新测所有模型，动态调整顺序。

## 文件位置

```
D:/项目/claude code official/cc-haha/
├── .env                     # 配置
├── bin/
│   └── api-failover-proxy.cjs  # 代理程序
└── docs/
    └── failover-proxy.md     # 本文档
```

## 更新日志

- 2026-04-14: 初始版本