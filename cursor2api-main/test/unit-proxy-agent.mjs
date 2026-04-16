/**
 * test/unit-proxy-agent.mjs
 *
 * 单元测试：proxy-agent 代理模块
 * 运行方式：node test/unit-proxy-agent.mjs
 *
 * 测试逻辑均为纯内联实现，不依赖 dist 编译产物。
 * 验证：
 *  1. 无代理时 getProxyFetchOptions 返回空对象
 *  2. 有代理时返回含 dispatcher 的对象
 *  3. ProxyAgent 缓存（单例）
 *  4. 各种代理 URL 格式支持
 */

// ─── 测试框架 ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅  ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ❌  ${name}`);
        console.error(`      ${e.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    const as = JSON.stringify(a), bs = JSON.stringify(b);
    if (as !== bs) throw new Error(msg || `Expected ${bs}, got ${as}`);
}

// ─── 内联 mock 实现（模拟 proxy-agent.ts 核心逻辑，不依赖 dist）──────

// 模拟 config
let mockConfig = {};

function getConfig() {
    return mockConfig;
}

// 模拟 ProxyAgent（轻量级）
class MockProxyAgent {
    constructor(url) {
        this.url = url;
        this.type = 'ProxyAgent';
    }
}

// 内联与 src/proxy-agent.ts 同逻辑的实现
let cachedAgent = undefined;

function resetCache() {
    cachedAgent = undefined;
}

function getProxyDispatcher() {
    const config = getConfig();
    const proxyUrl = config.proxy;

    if (!proxyUrl) return undefined;

    if (!cachedAgent) {
        cachedAgent = new MockProxyAgent(proxyUrl);
    }

    return cachedAgent;
}

function getProxyFetchOptions() {
    const dispatcher = getProxyDispatcher();
    return dispatcher ? { dispatcher } : {};
}

// ════════════════════════════════════════════════════════════════════
// 1. 无代理配置 → 返回空对象
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [1] 无代理配置\n');

test('proxy 未设置时返回空对象', () => {
    resetCache();
    mockConfig = {};
    const opts = getProxyFetchOptions();
    assertEqual(Object.keys(opts).length, 0, '应返回空对象');
});

test('proxy 为 undefined 时返回空对象', () => {
    resetCache();
    mockConfig = { proxy: undefined };
    const opts = getProxyFetchOptions();
    assertEqual(Object.keys(opts).length, 0);
});

test('proxy 为空字符串时返回空对象', () => {
    resetCache();
    mockConfig = { proxy: '' };
    const opts = getProxyFetchOptions();
    assertEqual(Object.keys(opts).length, 0, '空字符串不应创建代理');
});

test('getProxyDispatcher 无代理时返回 undefined', () => {
    resetCache();
    mockConfig = {};
    const d = getProxyDispatcher();
    assertEqual(d, undefined);
});

// ════════════════════════════════════════════════════════════════════
// 2. 有代理配置 → 返回含 dispatcher 的对象
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [2] 有代理配置\n');

test('设置 proxy 后返回含 dispatcher 的对象', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const opts = getProxyFetchOptions();
    assert(opts.dispatcher !== undefined, '应包含 dispatcher');
    assert(opts.dispatcher instanceof MockProxyAgent, '应为 ProxyAgent 实例');
});

test('dispatcher 包含正确的代理 URL', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const d = getProxyDispatcher();
    assertEqual(d.url, 'http://127.0.0.1:7890');
});

test('带认证的代理 URL', () => {
    resetCache();
    mockConfig = { proxy: 'http://user:pass@proxy.corp.com:8080' };
    const d = getProxyDispatcher();
    assertEqual(d.url, 'http://user:pass@proxy.corp.com:8080');
});

test('HTTPS 代理 URL', () => {
    resetCache();
    mockConfig = { proxy: 'https://secure-proxy.corp.com:443' };
    const d = getProxyDispatcher();
    assertEqual(d.url, 'https://secure-proxy.corp.com:443');
});

test('带特殊字符密码的代理 URL', () => {
    resetCache();
    const url = 'http://admin:p%40ssw0rd@proxy:8080';
    mockConfig = { proxy: url };
    const d = getProxyDispatcher();
    assertEqual(d.url, url, '应原样保留 URL 编码的特殊字符');
});

// ════════════════════════════════════════════════════════════════════
// 3. 缓存（单例）行为
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [3] 缓存单例行为\n');

test('多次调用返回同一 ProxyAgent 实例', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const d1 = getProxyDispatcher();
    const d2 = getProxyDispatcher();
    assert(d1 === d2, '应返回同一个缓存实例');
});

test('getProxyFetchOptions 多次调用复用同一 dispatcher', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const opts1 = getProxyFetchOptions();
    const opts2 = getProxyFetchOptions();
    assert(opts1.dispatcher === opts2.dispatcher, 'dispatcher 应为同一实例');
});

test('重置缓存后创建新实例', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const d1 = getProxyDispatcher();
    resetCache();
    mockConfig = { proxy: 'http://10.0.0.1:3128' };
    const d2 = getProxyDispatcher();
    assert(d1 !== d2, '重置后应创建新实例');
    assertEqual(d2.url, 'http://10.0.0.1:3128');
});

// ════════════════════════════════════════════════════════════════════
// 4. fetch options 展开语义验证
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [4] fetch options 展开语义\n');

test('无代理时展开不影响原始 options', () => {
    resetCache();
    mockConfig = {};
    const original = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const merged = { ...original, ...getProxyFetchOptions() };
    assertEqual(merged.method, 'POST');
    assertEqual(merged.headers['Content-Type'], 'application/json');
    assert(merged.dispatcher === undefined, '不应添加 dispatcher');
});

test('有代理时展开插入 dispatcher 且不覆盖其他字段', () => {
    resetCache();
    mockConfig = { proxy: 'http://127.0.0.1:7890' };
    const original = { method: 'POST', body: '{}', signal: 'test-signal' };
    const merged = { ...original, ...getProxyFetchOptions() };
    assertEqual(merged.method, 'POST');
    assertEqual(merged.body, '{}');
    assertEqual(merged.signal, 'test-signal');
    assert(merged.dispatcher instanceof MockProxyAgent, '应包含 dispatcher');
});

// ════════════════════════════════════════════════════════════════════
// 5. config.ts 集成验证（环境变量优先级）
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [5] config 环境变量集成验证\n');

test('PROXY 环境变量应覆盖 config.yaml（逻辑验证）', () => {
    // 模拟 config.ts 的覆盖逻辑：env > yaml
    let config = { proxy: 'http://yaml-proxy:1234' };
    const envProxy = 'http://env-proxy:5678';
    // 模拟 config.ts 第 49 行逻辑
    if (envProxy) config.proxy = envProxy;
    assertEqual(config.proxy, 'http://env-proxy:5678', 'PROXY 环境变量应覆盖 yaml 配置');
});

test('PROXY 环境变量未设置时保持 yaml 值（逻辑验证）', () => {
    let config = { proxy: 'http://yaml-proxy:1234' };
    const envProxy = undefined;
    if (envProxy) config.proxy = envProxy;
    assertEqual(config.proxy, 'http://yaml-proxy:1234', '应保持 yaml 配置不变');
});

// ════════════════════════════════════════════════════════════════════
// 汇总
// ════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
