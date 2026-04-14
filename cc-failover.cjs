/**
 * cc-failover.js - 简单故障转移模块
 *
 * 用法:
 *   const { createFailoverProxy } = require('./cc-failover.js')
 *   const api = createFailoverProxy('http://localhost:9019', 'liumiao', models)
 */

const axios = require('axios')

// 模型优先级（故障转移顺序，按速度排序）
const DEFAULT_MODELS = [
  'kilo-auto/free',                              // 935ms 最快
  'arcee-ai/trinity-large-thinking:free',          // 1005ms
  'openrouter/elephant-alpha',                     // 1163ms
  'bytedance-seed/dola-seed-2.0-pro:free',    // 1715ms
  'openrouter/free',                           // 4572ms
  'nvidia/nemotron-3-super-120b-a12b:free', // 5210ms
  'minimax-m2.5-free',                         // 6154ms
  'x-ai/grok-code-fast-1:optimized:free',    // 13255ms 最慢
]

// 熔断器状态
const circuitState = {
  currentIndex: 0,
  consecutiveFailures: 0,
  isOpen: false,       // 熔断器是否打开
  lastOpenTime: 0,
  FAILURE_THRESHOLD: 4,
  RECOVERY_TIMEOUT: 60000 // 60秒后尝试恢复
}

/**
 * 测试模型是否可用
 */
async function testModel(baseUrl, apiKey, model, timeout = 10000) {
  try {
    const response = await axios.post(
      `${baseUrl}/v1/chat/completions`,
      {
        model: model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: timeout
      }
    )
    return { success: true, response: response.data }
  } catch (error) {
    const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    const is5xx = error.response?.status >= 500
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      isTimeout: isTimeout,
      is5xx: is5xx
    }
  }
}

/**
 * 获取当前可用的模型
 */
function getCurrentModel() {
  return DEFAULT_MODELS[circuitState.currentIndex]
}

/**
 * 获取下一个可用模型（故障转移）
 */
function getNextModel() {
  const nextIndex = (circuitState.currentIndex + 1) % DEFAULT_MODELS.length
  return DEFAULT_MODELS[nextIndex]
}

/**
 * 记录失败，触发熔断
 */
function recordFailure() {
  circuitState.consecutiveFailures++

  if (circuitState.consecutiveFailures >= circuitState.FAILURE_THRESHOLD) {
    // 打开熔断器，换模型
    circuitState.isOpen = true
    circuitState.lastOpenTime = Date.now()
    circuitState.currentIndex = (circuitState.currentIndex + 1) % DEFAULT_MODELS.length

    console.log(`[Failover] 连续${circuitState.FAILURE_THRESHOLD}次失败，打开熔断器，切换到: ${getCurrentModel()}`)
  }
}

/**
 * 记录成功
 */
function recordSuccess() {
  if (circuitState.isOpen) {
    // 尝试恢复
    circuitState.isOpen = false
    circuitState.consecutiveFailures = 0
    console.log(`[Failover] 恢复成功，切回: ${getCurrentModel()}`)
  } else {
    circuitState.consecutiveFailures = Math.max(0, circuitState.consecutiveFailures - 1)
  }
}

/**
 * 检查是否应该尝试恢复
 */
async function checkRecovery(baseUrl, apiKey) {
  if (!circuitState.isOpen) return

  const timeSinceOpen = Date.now() - circuitState.lastOpenTime
  if (timeSinceOpen >= circuitState.RECOVERY_TIMEOUT) {
    // 尝试恢复
    const result = await testModel(baseUrl, apiKey, getCurrentModel())
    if (result.success) {
      circuitState.isOpen = false
      circuitState.consecutiveFailures = 0
      console.log(`[Failover] 恢复成功，使用: ${getCurrentModel()}`)
    }
  }
}

/**
 * 创建带故障转移的 API 客户端
 */
function createFailoverProxy(baseUrl, apiKey, models = DEFAULT_MODELS) {
  return {
    // 发送消息，自动故障转移
    async sendMessage(messages, options = {}) {
      const model = options.model || getCurrentModel()
      const maxRetries = models.length

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const currentModel = models[circuitState.currentIndex]

        console.log(`[Request] 尝试模型: ${currentModel} (${attempt + 1}/${maxRetries})`)

        const result = await testModel(baseUrl, apiKey, currentModel, options.timeout || 15000)

        if (result.success) {
          recordSuccess()
          return result.response
        } else {
          console.log(`[Fail] ${currentModel}: ${result.error || result.status}`)
          recordFailure()

          // 检查是否应该尝试恢复
          await checkRecovery(baseUrl, apiKey)
        }
      }

      throw new Error('所有模型都失败了')
    },

    // 获取状态
    getStatus() {
      return {
        currentModel: getCurrentModel(),
        consecutiveFailures: circuitState.consecutiveFailures,
        isOpen: circuitState.isOpen,
        models: DEFAULT_MODELS
      }
    },

    // 重置
    reset() {
      circuitState.currentIndex = 0
      circuitState.consecutiveFailures = 0
      circuitState.isOpen = false
      circuitState.lastOpenTime = 0
    }
  }
}

/**
 * 测速所有模型
 */
async function benchmarkModels(baseUrl, apiKey) {
  console.log('=== 模型测速 ===\n')

  const results = []

  for (const model of DEFAULT_MODELS) {
    process.stdout.write(`测试 ${model}... `)

    const start = Date.now()
    const result = await testModel(baseUrl, apiKey, model, 15000)
    const time = Date.now() - start

    if (result.success) {
      console.log(`✓ ${time}ms`)
      results.push({ model, time, success: true })
    } else {
      console.log(`✗ ${result.status || result.error}`)
      results.push({ model, time, success: false })
    }
  }

  // 按速度排序
  results.sort((a, b) => a.time - b.time)

  console.log('\n=== 排序结果 ===')
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.model}: ${r.time}ms ${r.success ? '✓' : '✗'}`)
  })

  return results
}

module.exports = {
  createFailoverProxy,
  benchmarkModels,
  testModel,
  getCurrentModel,
  DEFAULT_MODELS
}

// 命令行测速
if (require.main === module) {
  const baseUrl = process.argv[2] || 'http://localhost:9019'
  const apiKey = process.argv[3] || 'liumiao'

  benchmarkModels(baseUrl, apiKey)
}