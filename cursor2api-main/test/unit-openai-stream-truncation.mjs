import { autoContinueCursorToolResponseStream } from '../dist/handler.js';
import { parseToolCalls } from '../dist/converter.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
        throw new Error(message || `Expected ${b}, got ${a}`);
    }
}

function buildCursorReq() {
    return {
        model: 'claude-sonnet-4-5',
        id: 'req_test',
        trigger: 'user',
        messages: [
            {
                id: 'msg_user',
                role: 'user',
                parts: [{ type: 'text', text: 'Write a long file.' }],
            },
        ],
    };
}

function createSseResponse(deltas) {
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

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`  OK ${name}`);
        passed++;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  FAIL ${name}`);
        console.error(`      ${message}`);
        failed++;
    }
}

console.log('\nOpenAI stream truncation regression\n');

await runTest('long Write triggers continuation and restores multi-frame tool_calls', async () => {
    const originalFetch = global.fetch;
    const fetchCalls = [];

    try {
        global.fetch = async (url, init) => {
            fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
            return createSseResponse([
                'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                '"\n  }\n}\n```',
            ]);
        };

        const initialResponse = [
            'Preparing file write.',
            '',
            '```json action',
            '{',
            '  "tool": "Write",',
            '  "parameters": {',
            '    "file_path": "/tmp/long.txt",',
            '    "content": "AAAA' + 'A'.repeat(1800),
        ].join('\n');

        const fullResponse = await autoContinueCursorToolResponseStream(buildCursorReq(), initialResponse, true);
        const parsed = parseToolCalls(fullResponse);

        assertEqual(fetchCalls.length, 1, 'long Write truncation should trigger one continuation request');
        assertEqual(parsed.toolCalls.length, 1, 'continuation should restore one tool call');
        assertEqual(parsed.toolCalls[0].name, 'Write');
        assert(typeof fetchCalls[0].body?.messages?.at(-1)?.parts?.[0]?.text === 'string', 'continuation request should include a user guidance message');
        assert(fetchCalls[0].body.messages.at(-1).parts[0].text.includes('Continue EXACTLY from where you stopped'), 'continuation prompt should be injected');

        const content = String(parsed.toolCalls[0].arguments.content || '');
        assert(content.startsWith('AAAA'), 'should preserve original prefix before truncation');
        assert(content.includes('BBBB'), 'should append continuation content');

        const argsStr = JSON.stringify(parsed.toolCalls[0].arguments);
        const CHUNK_SIZE = 128;
        const chunks = [];
        for (let j = 0; j < argsStr.length; j += CHUNK_SIZE) {
            chunks.push(argsStr.slice(j, j + CHUNK_SIZE));
        }
        assert(chunks.length > 1, 'long Write arguments should split into multiple tool_call frames in OpenAI stream mode');
        assertEqual(chunks.join(''), argsStr, 'rejoined chunks should equal original arguments');
    } finally {
        global.fetch = originalFetch;
    }
});

await runTest('short Read does not trigger continuation in OpenAI stream mode', async () => {
    const originalFetch = global.fetch;
    let fetchCount = 0;

    try {
        global.fetch = async () => {
            fetchCount++;
            throw new Error('short-argument tools should not trigger continuation');
        };

        const initialResponse = [
            '```json action',
            '{',
            '  "tool": "Read",',
            '  "parameters": {',
            '    "file_path": "/tmp/config.yaml"',
            '  }',
        ].join('\n');

        const fullResponse = await autoContinueCursorToolResponseStream(buildCursorReq(), initialResponse, true);
        const parsed = parseToolCalls(fullResponse);

        assertEqual(fetchCount, 0, 'short Read should not enter continuation');
        assertEqual(parsed.toolCalls.length, 1, 'short-argument tools should still be recovered directly');
        assertEqual(parsed.toolCalls[0].name, 'Read');
    } finally {
        global.fetch = originalFetch;
    }
});

console.log(`\nresult: ${passed} passed / ${failed} failed / ${passed + failed} total\n`);

if (failed > 0) process.exit(1);
