/**
 * test/unit-openai-log-persistence.mjs
 *
 * 回归测试：OpenAI Chat / Responses 成功请求应更新 summary 并落盘 JSONL。
 * 运行方式：npm run build && node test/unit-openai-log-persistence.mjs
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = '/tmp/cursor2api-openai-log-persistence';
process.env.LOG_FILE_ENABLED = '1';
process.env.LOG_DIR = LOG_DIR;

const { handleOpenAIChatCompletions, handleOpenAIResponses } = await import('../dist/openai-handler.js');
const { clearAllLogs, getRequestSummaries } = await import('../dist/logger.js');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    const as = JSON.stringify(a);
    const bs = JSON.stringify(b);
    if (as !== bs) throw new Error(msg || `Expected ${bs}, got ${as}`);
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

function readPersistedRecords() {
    if (!fs.existsSync(LOG_DIR)) return [];
    const files = fs.readdirSync(LOG_DIR)
        .filter(name => name.endsWith('.jsonl'))
        .sort();
    const rows = [];
    for (const file of files) {
        const lines = fs.readFileSync(path.join(LOG_DIR, file), 'utf8')
            .split('\n')
            .filter(Boolean);
        for (const line of lines) {
            rows.push(JSON.parse(line));
        }
    }
    return rows;
}

function latestSummary() {
    return getRequestSummaries(10)[0];
}

async function withMockCursor(deltas, fn) {
    const originalFetch = global.fetch;
    global.fetch = async () => createCursorSseResponse(deltas);
    try {
        await fn();
    } finally {
        global.fetch = originalFetch;
    }
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

console.log('\n📦 [1] OpenAI 成功请求日志持久化回归\n');

await runTest('Chat Completions stream=true 会完成 summary 并落盘', async () => {
    await withMockCursor(['Hello', ' world'], async () => {
        const req = {
            method: 'POST',
            path: '/v1/chat/completions',
            body: {
                model: 'gpt-4.1',
                stream: true,
                messages: [{ role: 'user', content: 'Say hello' }],
            },
        };
        const res = new MockResponse();
        await handleOpenAIChatCompletions(req, res);

        assert(res.ended, '响应应结束');
        const summary = latestSummary();
        assert(summary, '应生成 summary');
        assertEqual(summary.path, '/v1/chat/completions');
        assertEqual(summary.stream, true);
        assertEqual(summary.status, 'success');
        assert(summary.responseChars > 0, 'responseChars 应大于 0');

        const records = readPersistedRecords();
        const persisted = records.find(r => r.summary?.requestId === summary.requestId);
        assert(persisted, '应写入 JSONL');
        assertEqual(persisted.summary.status, 'success');
        assertEqual(persisted.summary.stream, true);
    });
});

await runTest('Chat Completions stream=false 会完成 summary 并落盘', async () => {
    await withMockCursor(['Hello', ' world'], async () => {
        const req = {
            method: 'POST',
            path: '/v1/chat/completions',
            body: {
                model: 'gpt-4.1',
                stream: false,
                messages: [{ role: 'user', content: 'Say hello' }],
            },
        };
        const res = new MockResponse();
        await handleOpenAIChatCompletions(req, res);

        assert(res.ended, '响应应结束');
        const summary = latestSummary();
        assert(summary, '应生成 summary');
        assertEqual(summary.path, '/v1/chat/completions');
        assertEqual(summary.stream, false);
        assertEqual(summary.status, 'success');
        assert(summary.responseChars > 0, 'responseChars 应大于 0');

        const records = readPersistedRecords();
        const persisted = records.find(r => r.summary?.requestId === summary.requestId);
        assert(persisted, '应写入 JSONL');
        assertEqual(persisted.summary.status, 'success');
        assertEqual(persisted.summary.stream, false);
    });
});

await runTest('Responses stream=true 会完成 summary 并落盘', async () => {
    await withMockCursor(['Hello', ' world'], async () => {
        const req = {
            method: 'POST',
            path: '/v1/responses',
            body: {
                model: 'gpt-4.1',
                stream: true,
                input: 'Say hello',
            },
        };
        const res = new MockResponse();
        await handleOpenAIResponses(req, res);

        assert(res.ended, '响应应结束');
        const summary = latestSummary();
        assert(summary, '应生成 summary');
        assertEqual(summary.path, '/v1/responses');
        assertEqual(summary.stream, true);
        assertEqual(summary.apiFormat, 'responses');
        assertEqual(summary.status, 'success');
        assert(summary.responseChars > 0, 'responseChars 应大于 0');

        const records = readPersistedRecords();
        const persisted = records.find(r => r.summary?.requestId === summary.requestId);
        assert(persisted, '应写入 JSONL');
        assertEqual(persisted.summary.status, 'success');
        assertEqual(persisted.summary.stream, true);
    });
});

await runTest('Responses stream=false 会完成 summary 并落盘', async () => {
    await withMockCursor(['Hello', ' world'], async () => {
        const req = {
            method: 'POST',
            path: '/v1/responses',
            body: {
                model: 'gpt-4.1',
                stream: false,
                input: 'Say hello',
            },
        };
        const res = new MockResponse();
        await handleOpenAIResponses(req, res);

        assert(res.ended, '响应应结束');
        const summary = latestSummary();
        assert(summary, '应生成 summary');
        assertEqual(summary.path, '/v1/responses');
        assertEqual(summary.stream, false);
        assertEqual(summary.apiFormat, 'responses');
        assertEqual(summary.status, 'success');
        assert(summary.responseChars > 0, 'responseChars 应大于 0');

        const records = readPersistedRecords();
        const persisted = records.find(r => r.summary?.requestId === summary.requestId);
        assert(persisted, '应写入 JSONL');
        assertEqual(persisted.summary.status, 'success');
        assertEqual(persisted.summary.stream, false);
    });
});

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
