/**
 * API Failover Proxy - 带自动测速的故障转移
 *
 * 功能：
 * - 自动测速所有模型
 * - 按速度排序
 * - 失败3次自动切换
 * - 每5分钟重新测速
 */

const http = require('http')

const ZEN2API = 'http://localhost:9019'
const API_KEY = 'liumiao'

// 初始模型
let models = []
const FAILURE_THRESHOLD = 3

// 状态
let currentIndex = 0
let consecutiveFailures = 0
let isFirstRequest = true

// HTTP 请求
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 30000
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        const time = Date.now() - startTime
        resolve({
          status: res.statusCode,
          time,
          data
        })
      })
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

// 测速所有模型
async function benchmark() {
  console.log('\n=== 开始测速 ===')

  const results = []
  const testMessage = JSON.stringify({
    model: models[0],  // 需要指定模型
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 3
  })

  for (const model of models) {
    process.stdout.write(`测速 ${model}... `)

    try {
      const result = await request(`${ZEN2API}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: testMessage
      })

      if (result.status >= 200 && result.status < 300) {
        console.log(`${result.time}ms ✓`)
        results.push({ model, time: result.time, success: true })
      } else {
        console.log(`失败 ${result.status}`)
        results.push({ model, time: 99999, success: false })
      }
    } catch (e) {
      console.log(`错误: ${e.message}`)
      results.push({ model, time: 99999, success: false })
    }

    await new Promise(r => setTimeout(r, 300))
  }

  // 按速度排序
  results.sort((a, b) => a.time - b.time)

  const successful = results.filter(r => r.success).map(r => r.model)

  if (successful.length > 0) {
    models = [...successful]
    console.log(`\n=== 测速完成 ===`)
    console.log(`排序: ${models.join(' → ')}\n`)
  } else {
    console.log('\n=== 所有模型都失败 ===\n')
  }

  currentIndex = 0

  return results
}

// 获取模型列表
async function fetchModels() {
  try {
    const result = await request(`${ZEN2API}/v1/models`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    })

    if (result.status === 200) {
      const data = JSON.parse(result.data)
      return data.data.map(m => m.id)
    }
  } catch (e) {
    console.log(`获取模型失败: ${e.message}`)
  }

  return null
}

// 处理请求
async function handleRequest(req, res) {
  if (!req.url.startsWith('/v1/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', async () => {
    let requestBody
    try {
      requestBody = JSON.parse(body)
    } catch {
      requestBody = {}
    }

    // 首次请求时测速
    if (isFirstRequest && models.length > 0) {
      isFirstRequest = false
      console.log('[首次请求] 触发测速...')
      await benchmark()
    }

    // 尝试当前模型
    for (let attempt = 0; attempt < models.length; attempt++) {
      const model = models[currentIndex]

      console.log(`[请求] ${attempt + 1}/${models.length}: ${model}`)

      try {
        const result = await request(`${ZEN2API}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: requestBody.messages || requestBody.text,
            max_tokens: requestBody.max_tokens
          })
        })

        if (result.status >= 200 && result.status < 300) {
          if (consecutiveFailures > 0) {
            consecutiveFailures = 0
            console.log(`[恢复] 成功`)
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Used-Model': model,
            'X-Fastest-Model': models[0],
            'X-Response-Time': result.time + 'ms',
            'X-Attempts': attempt + 1,
            'X-Status': 'success'
          })
          res.end(result.data)
          return
        }

        console.log(`[失败] ${model}: ${result.status}`)
      } catch (e) {
        console.log(`[错误] ${model}: ${e.message}`)
      }

      // 失败 → 立即换下一个模型
      currentIndex = (currentIndex + 1) % models.length
    }

    // 所有模型都失败
    res.writeHead(502, {
      'Content-Type': 'application/json',
      'X-Used-Model': models[currentIndex],
      'X-Fastest-Model': models[0],
      'X-Attempts': models.length,
      'X-Status': 'all_failed'
    })
    res.end(JSON.stringify({ error: 'all models failed' }))
  })
}

// 启动
const PORT = 9018
const server = http.createServer(handleRequest)

async function init() {
  // 获取模型列表
  const fetchedModels = await fetchModels()

  if (fetchedModels && fetchedModels.length > 0) {
    models = fetchedModels
    console.log(`\n发现 ${models.length} 个模型\n`)
  } else {
    // 默认模型列表
    models = [
      'kilo-auto/free',
      'arcee-ai/trinity-large-thinking:free',
      'openrouter/elephant-alpha',
      'bytedance-seed/dola-seed-2.0-pro:free',
      'openrouter/free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'minimax-m2.5-free',
      'x-ai/grok-code-fast-1:optimized:free'
    ]
    console.log('\n使用默认模型列表\n')
  }

  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║   Failover Proxy + 自动测速           ║
║   端口: ${PORT}                            ║
║   目标: ${ZEN2API}                      ║
║   启动后自动测速                     ║
║   每5分钟重新测速                    ║
╚═══════════════════════════════════════════╝
`)

    // 启动后立即测速
    setTimeout(benchmark, 1500)

    // 每5分钟重新测速
    setInterval(() => {
      console.log('\n[定时测速]')
      benchmark()
    }, 5 * 60 * 1000)
  })
}

init().catch(console.error)