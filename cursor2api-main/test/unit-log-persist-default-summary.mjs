/**
 * test/unit-log-persist-default-summary.mjs
 *
 * 回归测试：未显式设置 LOG_PERSIST_MODE / logging.persist_mode 时，
 * 默认落盘模式应为 summary。
 * 运行方式：npm run build && node test/unit-log-persist-default-summary.mjs
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = '/tmp/cursor2api-log-default-summary';
process.env.LOG_FILE_ENABLED = '1';
process.env.LOG_DIR = LOG_DIR;
delete process.env.LOG_PERSIST_MODE;

const { handleOpenAIChatCompletions } = await import('../dist/openai-handler.js');
const { clearAllLogs } = await import('../dist/logger.js');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function createCursorSseResponse(deltas) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            for (const delta of deltas) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta })}\n\n`));
            }
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

class MockResponse {
    constructor() {
        this.statusCode = 200;
        this.headers = {};
        this.body = '';
        this.ended = false;
    }
    writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = { ...this.headers, ...headers };
    }
    write(chunk) {
        this.body += String(chunk);
        return true;
    }
    end(chunk = '') {
        this.body += String(chunk);
        this.ended = true;
    }
    json(obj) {
        this.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
        this.end(JSON.stringify(obj));
    }
    status(code) {
        this.statusCode = code;
        return this;
    }
}

function resetLogs() {
    clearAllLogs();
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
}

function latestPersistedRecord() {
    const files = fs.readdirSync(LOG_DIR).filter(name => name.endsWith('.jsonl')).sort();
    assert(files.length > 0, '应生成 JSONL 文件');
    const file = path.join(LOG_DIR, files[files.length - 1]);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert(lines.length > 0, 'JSONL 不应为空');
    return JSON.parse(lines[lines.length - 1]);
}

async function runTest(name, fn) {
    try {
        resetLogs();
        await fn();
        console.log(`  ✅  ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ❌  ${name}`);
        console.error(`      ${e.message}`);
        failed++;
    }
}

console.log('\n📦 [1] 默认落盘模式为 summary 回归\n');

await runTest('未显式配置 persist_mode 时默认只保留问答摘要', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => createCursorSseResponse(['Hello', ' world']);
    try {
        const req = {
            method: 'POST',
            path: '/v1/chat/completions',
            body: {
                model: 'gpt-4.1',
                stream: true,
                messages: [{ role: 'user', content: 'Please greet me briefly.' }],
            },
        };
        const res = new MockResponse();
        await handleOpenAIChatCompletions(req, res);

        const persisted = latestPersistedRecord();
        assert(persisted.payload.question.includes('Please greet me briefly.'), '默认模式应保留 question');
        assert(persisted.payload.answer.includes('Hello world'), '默认模式应保留 answer');
        assert(persisted.payload.finalResponse === undefined, '默认模式不应保留 finalResponse');
        assert(persisted.payload.messages === undefined, '默认模式不应保留 messages');
    } finally {
        global.fetch = originalFetch;
    }
});

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
