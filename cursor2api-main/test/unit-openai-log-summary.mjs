/**
 * test/unit-openai-log-summary.mjs
 *
 * 回归测试：summary 落盘模式仅保留问答摘要与少量元数据。
 * 运行方式：npm run build && node test/unit-openai-log-summary.mjs
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = '/tmp/cursor2api-openai-log-summary';
process.env.LOG_FILE_ENABLED = '1';
process.env.LOG_DIR = LOG_DIR;
process.env.LOG_PERSIST_MODE = 'summary';

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

function latestPersistedRecord() {
    const files = fs.readdirSync(LOG_DIR).filter(name => name.endsWith('.jsonl')).sort();
    assert(files.length > 0, '应生成 JSONL 文件');
    const file = path.join(LOG_DIR, files[files.length - 1]);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert(lines.length > 0, 'JSONL 不应为空');
    return JSON.parse(lines[lines.length - 1]);
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

console.log('\n📦 [1] summary 落盘模式回归\n');

await runTest('Chat Completions summary 模式只保留 question / answer', async () => {
    await withMockCursor(['Hello', ' world'], async () => {
        const req = {
            method: 'POST',
            path: '/v1/chat/completions',
            body: {
                model: 'gpt-4.1',
                stream: true,
                messages: [{ role: 'user', content: 'Please say hello in English.' }],
            },
        };
        const res = new MockResponse();
        await handleOpenAIChatCompletions(req, res);

        const summary = latestSummary();
        assert(summary, '应生成 summary');
        assertEqual(summary.status, 'success');

        const persisted = latestPersistedRecord();
        assertEqual(persisted.summary.path, '/v1/chat/completions');
        assert(persisted.payload.question.includes('Please say hello'), '应保留用户问题摘要');
        assert(persisted.payload.answer.includes('Hello world'), '应保留模型回答摘要');
        assertEqual(persisted.payload.answerType, 'text');
        assertEqual(persisted.payload.messages, undefined, 'summary 模式不应保留 messages');
        assertEqual(persisted.payload.finalResponse, undefined, 'summary 模式不应保留 finalResponse');
        assertEqual(persisted.payload.rawResponse, undefined, 'summary 模式不应保留 rawResponse');
    });
});

await runTest('Responses summary 模式也能提取 question / answer', async () => {
    await withMockCursor(['Hello', ' world'], async () => {
        const req = {
            method: 'POST',
            path: '/v1/responses',
            body: {
                model: 'gpt-4.1',
                stream: false,
                input: 'Please answer with a short hello.',
            },
        };
        const res = new MockResponse();
        await handleOpenAIResponses(req, res);

        const persisted = latestPersistedRecord();
        assertEqual(persisted.summary.path, '/v1/responses');
        assert(persisted.payload.question.includes('short hello'), 'Responses summary 模式应保留问题摘要');
        assert(persisted.payload.answer.includes('Hello world'), 'Responses summary 模式应保留回答摘要');
        assertEqual(persisted.payload.answerType, 'text');
        assertEqual(persisted.payload.originalRequest, undefined, 'summary 模式不应保留 originalRequest');
        assertEqual(persisted.payload.cursorMessages, undefined, 'summary 模式不应保留 cursorMessages');
    });
});

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
