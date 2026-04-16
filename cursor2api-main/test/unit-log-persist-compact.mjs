/**
 * test/unit-log-persist-compact.mjs
 *
 * 回归测试：compact 落盘模式应保留摘要信息，同时显著压缩 JSONL payload。
 * 运行方式：npm run build && node test/unit-log-persist-compact.mjs
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = '/tmp/cursor2api-log-compact';
process.env.LOG_FILE_ENABLED = '1';
process.env.LOG_DIR = LOG_DIR;
process.env.LOG_PERSIST_MODE = 'compact';

const { createRequestLogger, clearAllLogs, getRequestPayload } = await import('../dist/logger.js');

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

function resetLogs() {
    clearAllLogs();
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
}

function latestPersistedRecord() {
    const files = fs.readdirSync(LOG_DIR).filter(name => name.endsWith('.jsonl')).sort();
    assert(files.length > 0, '应生成 JSONL 文件');
    const lastFile = path.join(LOG_DIR, files[files.length - 1]);
    const lines = fs.readFileSync(lastFile, 'utf8').split('\n').filter(Boolean);
    assert(lines.length > 0, 'JSONL 文件不应为空');
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

console.log('\n📦 [1] compact 落盘模式回归\n');

await runTest('磁盘 payload 应截断长文本并去掉重复 rawResponse', async () => {
    const hugePrompt = 'PROMPT-'.repeat(1200);
    const hugeResponse = 'RESPONSE-'.repeat(1600);
    const hugeCursor = 'CURSOR-'.repeat(900);
    const hugeToolDesc = 'DESC-'.repeat(500);

    const logger = createRequestLogger({
        method: 'POST',
        path: '/v1/chat/completions',
        model: 'gpt-4.1',
        stream: true,
        hasTools: true,
        toolCount: 1,
        messageCount: 1,
        apiFormat: 'openai',
    });

    logger.recordOriginalRequest({
        model: 'gpt-4.1',
        stream: true,
        temperature: 0.2,
        messages: [{ role: 'user', content: hugePrompt }],
        tools: [{
            type: 'function',
            function: {
                name: 'write_file',
                description: hugeToolDesc,
            },
        }],
    });
    logger.recordCursorRequest({
        model: 'anthropic/claude-sonnet-4.6',
        messages: [{
            role: 'user',
            parts: [{ type: 'text', text: hugeCursor }],
        }],
    });
    logger.recordToolCalls([{
        name: 'write_file',
        arguments: {
            path: '/tmp/demo.txt',
            content: 'X'.repeat(5000),
        },
    }]);
    logger.recordRawResponse(hugeResponse);
    logger.recordFinalResponse(hugeResponse);
    logger.complete(hugeResponse.length, 'stop');

    const persisted = latestPersistedRecord();
    const diskPayload = persisted.payload;
    const memoryPayload = getRequestPayload(persisted.summary.requestId);

    assert(memoryPayload, '内存 payload 应存在');
    assert(memoryPayload.rawResponse.length > diskPayload.finalResponse.length, '内存 payload 应保留完整文本');
    assertEqual(persisted.summary.status, 'success');

    assert(diskPayload.finalResponse.length < hugeResponse.length, '落盘 finalResponse 应被截断');
    assert(diskPayload.finalResponse.includes('...[截断 '), '落盘 finalResponse 应标记截断');
    assertEqual(diskPayload.rawResponse, undefined, 'rawResponse 与 finalResponse 相同，应省略落盘 rawResponse');

    assert(diskPayload.messages[0].contentPreview.length < hugePrompt.length, '落盘消息预览应被截断');
    assert(diskPayload.messages[0].contentPreview.includes('...[截断 '), '落盘消息预览应标记截断');

    assert(diskPayload.cursorMessages[0].contentPreview.length < hugeCursor.length, '落盘 Cursor 消息应被截断');
    assert(diskPayload.tools[0].description.length < hugeToolDesc.length, '落盘工具描述应被截断');
    assert(diskPayload.originalRequest.messageCount === 1, '落盘 originalRequest 应转为精简 meta');
    assertEqual(Array.isArray(diskPayload.originalRequest.messages), false, '落盘 originalRequest 不应保留完整 messages 数组');

    const compactToolCalls = JSON.stringify(diskPayload.toolCalls);
    assert(compactToolCalls.length < JSON.stringify(memoryPayload.toolCalls).length, '落盘 toolCalls 应被递归压缩');
  });

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
