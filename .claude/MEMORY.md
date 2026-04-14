# cc-haha 项目记忆

> 本项目的独立记忆，其他 cc-haha 不共享

## Failover 代理配置

### 问题
- zen2api (9019) 的 minimax-m2.5-free 经常 502 不稳定

### 解决方案
创建了 Failover Proxy (localhost:9018) 做故障转移代理

### 文件
| 文件 | 说明 |
|------|------|
| `bin/api-failover-proxy.cjs` | 故障转移代理 |
| `.env` | 配置为 localhost:9018 |
| `docs/failover-proxy.md` | 详细文档 |

### 功能
1. 自动测速8个模型
2. 按速度排序
3. 失败3次自动切换
4. 每5分钟重新测速

### 启动
```bash
# 先启动代理
./bin/api-failover-proxy.cjs

# 再启动 cc-haha
./bin/claude-haha
```

## 其他信息
- 主系统位置：E:/项目/生产/主系统-mysql → E:/project/sjzm
- 使用 tool/node (v24.12.0)