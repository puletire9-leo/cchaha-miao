/**
 * 测试故障转移
 */

const axios = require('axios')

// 按速度排序的模型
const MODELS = [
  'kilo-auto/free',
  'arcee-ai/trinity-large-thinking:free',
  'openrouter/elephant-alpha',
  'bytedance-seed/dola-seed-2.0-pro:free',
  'openrouter/free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'minimax-m2.5-free',
  'x-ai/grok-code-fast-1:optimized:free'
]

const BASE_URL = 'http://localhost:9019'
const API_KEY = 'liumiao'

// 熔断器状态
let currentIndex = 0
let consecutiveFailures = 0
let isOpen = false
const FAILURE_THRESHOLD = 3

async function testModel(model, timeout = 10000) {
  try {
    const start = Date.now()
    const response = await axios.post(
      `${BASE_URL}/v1/chat/completions`,
      {
        model: model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5
      },
      {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        timeout
      }
    )
    const time = Date.now() - start
    return { success: true, time }
  } catch (error) {
    return { success: false, error: error.response?.status || error.code }
  }
}

function recordFailure() {
  consecutiveFailures++
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    currentIndex = (currentIndex + 1) % MODELS.length
    isOpen = true
    console.log(`\n⚡ 打开熔断器！连续${FAILURE_THRESHOLD}次失败，切换到: ${MODELS[currentIndex]}\n`)
  }
}

function recordSuccess() {
  if (isOpen) {
    isOpen = false
    consecutiveFailures = 0
    console.log(`\n✅ 恢复成功，使用: ${MODELS[currentIndex]}\n`)
  }
}

// 测试1：模拟主模型失败
async function testSimulateFailover() {
  console.log('=== 测试1：模拟 minimax 失败，自动切换 ===\n')

  // 把 minimax 放到第一位
  currentIndex = MODELS.indexOf('minimax-m2.5-free')

  console.log(`当前模型: ${MODELS[currentIndex]}`)

  // 模拟连续失败
  for (let i = 0; i < FAILURE_THRESHOLD; i++) {
    console.log(`尝试 ${i + 1}/${FAILURE_THRESHOLD}: ${MODELS[currentIndex]}... 模拟失败`)
    recordFailure()
  }

  console.log(`\n当前模型: ${MODELS[currentIndex]}`)
  console.log(`连续失败: ${consecutiveFailures}`)
  console.log(`熔断器打开: ${isOpen}`)
}

// 测试2：真实请求测试
async function testRealRequest() {
  console.log('\n=== 测试2：真实请求测试 ===\n')

  currentIndex = 0
  console.log(`当前模型: ${MODELS[currentIndex]}`)

  const result = await testModel(MODELS[currentIndex])

  if (result.success) {
    recordSuccess()
    console.log(`✅ 成功！耗时: ${result.time}ms`)
  } else {
    recordFailure()
    console.log(`❌ 失败: ${result.error}`)
  }
}

// 测试3：循环请求直到成功
async function testFailoverChain() {
  console.log('\n=== 测试3：故障转移链测试 ===\n')

  let attempts = 0
  const maxAttempts = 10

  while (attempts < maxAttempts) {
    attempts++
    const model = MODELS[currentIndex]

    console.log(`\n尝试 ${attempts}: ${model}`)

    const result = await testModel(model, 15000)

    if (result.success) {
      recordSuccess()
      console.log(`✅ 成功！耗时: ${result.time}ms`)
      break
    } else {
      console.log(`❌ 失败: ${result.error}`)
      currentIndex = (currentIndex + 1) % MODELS.length

      if (currentIndex === 0) {
        console.log('\n⚠️ 所有模型都失败了！')
        break
      }
    }
  }

  if (attempts >= maxAttempts) {
    console.log(`\n达到最大尝试次数: ${maxAttempts}`)
  }
}

// 运行测试
async function run() {
  console.log('\n🧪 故障转移测试\n')

  await testSimulateFailover()
  await testRealRequest()
  await testFailoverChain()

  console.log('\n=== 测试完成 ===')
}

run().catch(console.error)