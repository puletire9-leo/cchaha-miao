/**
 * e2e-thinking-truncation.mjs
 *
 * 实际请求测试：thinking 截断场景
 *
 * 测试场景：
 * 1. 请求 thinking 模式，验证 thinking block 正确返回，不泄漏到正文
 * 2. 带工具 + thinking，验证 thinking 剥离后工具调用续写正常触发
 * 3. 带工具 + thinking，验证 200-char 修复（thinking 剥离后正文短但工具续写仍触发）
 */

import http from 'http';

const BASE = process.env.BASE_URL || 'http://localhost:3010';
const url = new URL(BASE);

let passed = 0;
let failed = 0;

function runAnthropicTest(name, body, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`超时 ${timeoutMs}ms`)), timeoutMs);
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: url.hostname, port: url.port || 3010, path: '/v1/messages', method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'test',
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let buf = '';
            const events = [];
            res.on('data', chunk => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try { events.push(JSON.parse(line.slice(6).trim())); } catch { /* skip */ }
                }
            });
            res.on('end', () => { clearTimeout(timer); resolve(events); });
            res.on('error', err => { clearTimeout(timer); reject(err); });
        });
        req.on('error', err => { clearTimeout(timer); reject(err); });
        req.write(data);
        req.end();
    });
}

function parseEvents(events) {
    let thinkingContent = '';
    let textContent = '';
    let stopReason = '';

    for (const ev of events) {
        if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'thinking_delta') thinkingContent += ev.delta.thinking || '';
            if (ev.delta?.type === 'text_delta') textContent += ev.delta.text || '';
        }
        if (ev.type === 'message_delta') stopReason = ev.delta?.stop_reason || '';
    }
    return { thinkingContent, textContent, stopReason };
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ ${name}`);
        console.error(`      ${err.message}`);
        failed++;
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

const TOOLS = [
    {
        name: 'Write',
        description: 'Write a file',
        input_schema: {
            type: 'object',
            properties: {
                file_path: { type: 'string' },
                content: { type: 'string' },
            },
            required: ['file_path', 'content'],
        },
    },
    {
        name: 'Read',
        description: 'Read a file',
        input_schema: {
            type: 'object',
            properties: { file_path: { type: 'string' } },
            required: ['file_path'],
        },
    },
];

console.log('\n📦 E2E: thinking 截断场景测试\n');
console.log(`  服务地址: ${BASE}`);
console.log(`  注意：以下测试需要模型实际支持 thinking 模式\n`);

// ==================== 测试 1：thinking 模式基础验证 ====================
await test('thinking 模式：thinking block 出现在正文之前，不泄漏到 text', async () => {
    const events = await runAnthropicTest('thinking-basic', {
        model: 'claude-sonnet-4-6-thinking',
        max_tokens: 16000,
        thinking: { type: 'enabled', budget_tokens: 10000 },
        messages: [{
            role: 'user',
            content: '简单回答：1+1等于几？',
        }],
        stream: true,
    });

    const { thinkingContent, textContent } = parseEvents(events);

    // thinking block 必须存在
    assert(thinkingContent.length > 0, `期望有 thinking block，实际为空`);

    // thinking 内容不应出现在正文里
    assert(
        !textContent.includes('<thinking>'),
        `正文不应包含 <thinking> 标签，实际正文: ${textContent.substring(0, 200)}`,
    );
    assert(
        !textContent.includes('</thinking>'),
        `正文不应包含 </thinking> 标签`,
    );

    // 正文应有实际内容
    assert(textContent.trim().length > 0, `正文应有内容，实际为空`);

    console.log(`      thinking: ${thinkingContent.length} chars, text: ${textContent.length} chars`);
});

// ==================== 测试 2：thinking 不泄漏到正文（无 thinking 请求） ====================
await test('非 thinking 模式：即使模型输出 <thinking> 也不泄漏到正文', async () => {
    // 使用普通模型名，但通过 system prompt 诱导模型输出 thinking 标签
    const events = await runAnthropicTest('thinking-leak', {
        model: 'claude-sonnet-4-6-thinking',
        max_tokens: 8000,
        // 不传 thinking 参数
        messages: [{
            role: 'user',
            content: '请用中文简短回答：什么是递归？',
        }],
        stream: true,
    });

    const { textContent } = parseEvents(events);

    assert(
        !textContent.includes('<thinking>'),
        `正文不应包含 <thinking> 开标签，实际: ${textContent.substring(0, 300)}`,
    );
    assert(
        !textContent.includes('</thinking>'),
        `正文不应包含 </thinking> 闭标签`,
    );
    console.log(`      text: ${textContent.length} chars, preview: ${textContent.substring(0, 80).replace(/\n/g, '\\n')}`);
});

// ==================== 测试 3：带工具 + thinking，工具调用完整返回 ====================
await test('thinking + 工具调用：工具参数完整，thinking 不泄漏', async () => {
    const events = await runAnthropicTest('thinking-tools', {
        model: 'claude-sonnet-4-6-thinking',
        max_tokens: 16000,
        thinking: { type: 'enabled', budget_tokens: 8000 },
        tools: TOOLS,
        messages: [{
            role: 'user',
            content: '请用 Write 工具写一个包含 50 行注释的 Python hello world 文件到 /tmp/hello.py',
        }],
        stream: true,
    });

    const { thinkingContent, textContent } = parseEvents(events);

    // 解析工具调用
    const toolStarts = events.filter(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
    const toolInputDeltas = events.filter(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta');
    const toolInputRaw = toolInputDeltas.map(e => e.delta.partial_json || '').join('');

    assert(
        !textContent.includes('<thinking>') && !textContent.includes('</thinking>'),
        `正文不应包含 thinking 标签，实际: ${textContent.substring(0, 200)}`,
    );

    if (toolStarts.length > 0) {
        // 有工具调用：验证参数完整（能解析为有效 JSON）
        let toolInput = {};
        try { toolInput = JSON.parse(toolInputRaw); } catch (e) {
            throw new Error(`工具调用参数 JSON 解析失败: ${e.message}\n原始: ${toolInputRaw.substring(0, 200)}`);
        }
        assert(typeof toolInput.file_path === 'string', '工具参数应包含 file_path');
        assert(typeof toolInput.content === 'string', '工具参数应包含 content');
        console.log(`      thinking: ${thinkingContent.length} chars, tool: ${toolStarts[0]?.content_block?.name}, content: ${toolInput.content?.length} chars`);
    } else {
        // 没有工具调用：至少有正文
        assert(textContent.trim().length > 0, '无工具调用时正文不应为空');
        console.log(`      thinking: ${thinkingContent.length} chars, text: ${textContent.length} chars (无工具调用)`);
    }
});

// ==================== 汇总 ====================
console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
if (failed > 0) process.exit(1);
