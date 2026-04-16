/**
 * test/unit-openai-stream-usage.mjs
 *
 * 回归测试：/v1/chat/completions 流式最后一帧应携带 usage
 * 运行方式：npm run build && node test/unit-openai-stream-usage.mjs
 */

import { handleOpenAIChatCompletions } from '../dist/openai-handler.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    Promise.resolve()
        .then(fn)
        .then(() => {
            console.log(`  ✅  ${name}`);
            passed++;
        })
        .catch((e) => {
            console.error(`  ❌  ${name}`);
            console.error(`      ${e.message}`);
            failed++;
        });
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    const as = JSON.stringify(a), bs = JSON.stringify(b);
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
}

function extractDataChunks(sseText) {
    return sseText
        .split('\n\n')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => part.startsWith('data: '))
        .map(part => part.slice(6))
        .filter(part => part !== '[DONE]')
        .map(part => JSON.parse(part));
}

console.log('\n📦 [1] OpenAI Chat Completions 流式 usage 回归\n');

const pending = [];

pending.push((async () => {
    const originalFetch = global.fetch;

    try {
        global.fetch = async () => createCursorSseResponse(['Hello', ' world from Cursor']);

        const req = {
            method: 'POST',
            path: '/v1/chat/completions',
            body: {
                model: 'gpt-4.1',
                stream: true,
                messages: [
                    { role: 'user', content: 'Write a short greeting in English.' },
                ],
            },
        };
        const res = new MockResponse();

        await handleOpenAIChatCompletions(req, res);

        assertEqual(res.statusCode, 200, 'statusCode 应为 200');
        assert(res.ended, '响应应结束');

        const chunks = extractDataChunks(res.body);
        assert(chunks.length >= 2, '至少应包含 role chunk 和完成 chunk');

        const lastChunk = chunks[chunks.length - 1];
        assertEqual(lastChunk.object, 'chat.completion.chunk');
        assert(lastChunk.usage, '最后一帧应包含 usage');
        assert(typeof lastChunk.usage.prompt_tokens === 'number' && lastChunk.usage.prompt_tokens > 0, 'prompt_tokens 应为正数');
        assert(typeof lastChunk.usage.completion_tokens === 'number' && lastChunk.usage.completion_tokens > 0, 'completion_tokens 应为正数');
        assertEqual(
            lastChunk.usage.total_tokens,
            lastChunk.usage.prompt_tokens + lastChunk.usage.completion_tokens,
            'total_tokens 应等于 prompt_tokens + completion_tokens'
        );
        assertEqual(lastChunk.choices[0].finish_reason, 'stop', '最后一帧 finish_reason 应为 stop');

        const contentChunks = chunks.filter(chunk => chunk.choices?.[0]?.delta?.content);
        assert(contentChunks.length > 0, '应输出至少一个 content chunk');
    } finally {
        global.fetch = originalFetch;
    }
})().then(() => {
    console.log('  ✅  流式最后一帧携带 usage');
    passed++;
}).catch((e) => {
    console.error('  ❌  流式最后一帧携带 usage');
    console.error(`      ${e.message}`);
    failed++;
}));

await Promise.all(pending);

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
