/**
 * 混合流式完整性测试
 * 验证：
 *   1. 文字增量流式 ✓
 *   2. 工具调用参数完整 ✓
 *   3. 多工具调用 ✓
 *   4. 纯文字（无工具调用）✓
 *   5. stop_reason 正确 ✓
 */

import http from 'http';

const BASE = process.env.BASE_URL || 'http://localhost:3010';
const url = new URL(BASE);

function runAnthropicTest(name, body, timeout = 60000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('超时 ' + timeout + 'ms')); }, timeout);
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: url.hostname, port: url.port, path: '/v1/messages', method: 'POST',
            headers: {
                'Content-Type': 'application/json', 'x-api-key': 'test',
                'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            const start = Date.now();
            let events = [];
            let buf = '';

            res.on('data', (chunk) => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop(); // keep incomplete last line
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6).trim();
                    if (payload === '[DONE]') continue;
                    try {
                        const ev = JSON.parse(payload);
                        events.push({ ...ev, _ts: Date.now() - start });
                    } catch { /* skip */ }
                }
            });

            res.on('end', () => {
                clearTimeout(timer);
                // 解析结果
                const textDeltas = events.filter(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta');
                const toolStarts = events.filter(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
                const toolInputDeltas = events.filter(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta');
                const msgDelta = events.find(e => e.type === 'message_delta');
                const msgStop = events.find(e => e.type === 'message_stop');

                const fullText = textDeltas.map(e => e.delta.text).join('');
                const tools = toolStarts.map(ts => {
                    // 收集该工具的 input JSON
                    const inputChunks = toolInputDeltas
                        .filter(d => d.index === ts.index)
                        .map(d => d.delta.partial_json);
                    let parsedInput = null;
                    try { parsedInput = JSON.parse(inputChunks.join('')); } catch { }
                    return {
                        name: ts.content_block.name,
                        id: ts.content_block.id,
                        input: parsedInput,
                        inputRaw: inputChunks.join(''),
                    };
                });

                resolve({
                    name,
                    textChunks: textDeltas.length,
                    textLength: fullText.length,
                    textPreview: fullText.substring(0, 120).replace(/\n/g, '\\n'),
                    tools,
                    stopReason: msgDelta?.delta?.stop_reason || '?',
                    firstTextMs: textDeltas[0]?._ts ?? -1,
                    firstToolMs: toolStarts[0]?._ts ?? -1,
                    doneMs: msgStop?._ts ?? -1,
                });
            });
            res.on('error', (err) => { clearTimeout(timer); reject(err); });
        });
        req.on('error', (err) => { clearTimeout(timer); reject(err); });
        req.write(data);
        req.end();
    });
}

function printResult(r) {
    console.log(`\n  📊 ${r.name}`);
    console.log(`     时间: 首字=${r.firstTextMs}ms  首工具=${r.firstToolMs}ms  完成=${r.doneMs}ms`);
    console.log(`     文字: ${r.textChunks} chunks, ${r.textLength} chars`);
    if (r.textPreview) console.log(`     预览: "${r.textPreview}"`);
    console.log(`     stop_reason: ${r.stopReason}`);
    if (r.tools.length > 0) {
        console.log(`     工具调用 (${r.tools.length}个):`);
        for (const t of r.tools) {
            console.log(`       - ${t.name}(${JSON.stringify(t.input)})`);
            if (!t.input) console.log(`         ⚠️ 参数解析失败! raw: ${t.inputRaw?.substring(0, 100)}`);
        }
    }
}

const TOOLS = [
    { name: 'Read', description: 'Read file contents', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
    { name: 'Write', description: 'Write file contents', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
    { name: 'Bash', description: 'Run bash command', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];

async function main() {
    console.log('\n  ⚡ 混合流式完整性测试\n');

    // 健康检查
    try {
        await new Promise((resolve, reject) => {
            const req = http.get(`${BASE}/health`, r => { r.resume(); r.on('end', resolve); });
            req.on('error', reject);
            req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
        });
    } catch {
        console.log('  ❌ 服务器未运行\n');
        process.exit(1);
    }
    console.log('  ✅ 服务器在线');

    let passed = 0;
    let failed = 0;

    // ---- Test 1: 单工具调用 ----
    console.log('\n  ━━━ ① 单工具调用 ━━━');
    try {
        const r = await runAnthropicTest('单工具调用', {
            model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, stream: true,
            system: 'You are a coding assistant with file system access. When a user asks to read a file, use the Read tool immediately. Do not refuse or explain limitations.',
            tools: TOOLS,
            messages: [{ role: 'user', content: 'Read the file /src/index.ts for me please' }],
        });
        printResult(r);

        // 验证
        const checks = [];
        checks.push({ name: 'stop_reason=tool_use', ok: r.stopReason === 'tool_use' });
        checks.push({ name: '至少1个工具调用', ok: r.tools.length >= 1 });
        checks.push({ name: '工具名=Read', ok: r.tools.some(t => t.name === 'Read') });
        checks.push({ name: '工具参数有 file_path', ok: r.tools.some(t => t.input?.file_path) });
        checks.push({ name: '首字延迟<10s', ok: r.firstTextMs >= 0 && r.firstTextMs < 10000 });

        for (const c of checks) {
            console.log(`     ${c.ok ? '✅' : '❌'} ${c.name}`);
            c.ok ? passed++ : failed++;
        }
    } catch (err) {
        console.log(`  ❌ 失败: ${err.message}`);
        failed++;
    }

    // ---- Test 2: 多工具调用 ----
    console.log('\n  ━━━ ② 多工具调用 ━━━');
    try {
        const r = await runAnthropicTest('多工具调用', {
            model: 'claude-3-5-sonnet-20241022', max_tokens: 2048, stream: true,
            system: 'You are a coding assistant with file system access. When asked to read multiple files, use multiple Read tool calls in a single response. Do not refuse.',
            tools: TOOLS,
            messages: [{ role: 'user', content: 'Read both /src/index.ts and /src/config.ts for me' }],
        });
        printResult(r);

        const checks = [];
        checks.push({ name: 'stop_reason=tool_use', ok: r.stopReason === 'tool_use' });
        checks.push({ name: '≥2个工具调用', ok: r.tools.length >= 2 });
        checks.push({ name: '工具参数都有 file_path', ok: r.tools.every(t => t.input?.file_path) });

        for (const c of checks) {
            console.log(`     ${c.ok ? '✅' : '❌'} ${c.name}`);
            c.ok ? passed++ : failed++;
        }
    } catch (err) {
        console.log(`  ❌ 失败: ${err.message}`);
        failed++;
    }

    // ---- Test 3: 纯文字（带工具定义但不需要调用） ----
    console.log('\n  ━━━ ③ 纯文字（有工具但不调用） ━━━');
    try {
        const r = await runAnthropicTest('纯文字', {
            model: 'claude-3-5-sonnet-20241022', max_tokens: 512, stream: true,
            system: 'You are helpful. Answer questions directly without using any tools.',
            tools: TOOLS,
            messages: [{ role: 'user', content: 'What is 2+2? Just answer with the number.' }],
        });
        printResult(r);

        const checks = [];
        checks.push({ name: 'stop_reason=end_turn', ok: r.stopReason === 'end_turn' });
        checks.push({ name: '0个工具调用', ok: r.tools.length === 0 });
        checks.push({ name: '有文字输出', ok: r.textLength > 0 });
        checks.push({ name: '文字含数字4', ok: r.textPreview.includes('4') });

        for (const c of checks) {
            console.log(`     ${c.ok ? '✅' : '❌'} ${c.name}`);
            c.ok ? passed++ : failed++;
        }
    } catch (err) {
        console.log(`  ❌ 失败: ${err.message}`);
        failed++;
    }

    // ---- 汇总 ----
    console.log(`\n  ━━━ 汇总 ━━━`);
    console.log(`  ✅ 通过: ${passed}  ❌ 失败: ${failed}\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('致命错误:', err); process.exit(1); });
