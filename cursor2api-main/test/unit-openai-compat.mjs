/**
 * test/unit-openai-compat.mjs
 *
 * 单元测试：OpenAI 处理器兼容性功能
 * - responsesToChatCompletions 转换
 * - Cursor 扁平格式工具兼容
 * - 消息角色合并
 *
 * 运行方式：node test/unit-openai-compat.mjs
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

function stringifyUnknownContent(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function extractOpenAIContentBlocks(msg) {
    if (msg.content === null || msg.content === undefined) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        const blocks = [];
        for (const p of msg.content) {
            if ((p.type === 'text' || p.type === 'input_text') && p.text) {
                blocks.push({ type: 'text', text: p.text });
            } else if (p.type === 'image_url' && p.image_url?.url) {
                blocks.push({
                    type: 'image',
                    source: { type: 'url', media_type: 'image/jpeg', data: p.image_url.url },
                });
            } else if (p.type === 'input_image' && p.image_url?.url) {
                blocks.push({
                    type: 'image',
                    source: { type: 'url', media_type: 'image/jpeg', data: p.image_url.url },
                });
            }
        }
        return blocks.length > 0 ? blocks : '';
    }
    return stringifyUnknownContent(msg.content);
}

function extractOpenAIContent(msg) {
    const blocks = extractOpenAIContentBlocks(msg);
    if (typeof blocks === 'string') return blocks;
    return blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// ─── 内联 mergeConsecutiveRoles（与 src/openai-handler.ts 保持同步）────
function toBlocks(content) {
    if (typeof content === 'string') {
        return content ? [{ type: 'text', text: content }] : [];
    }
    return content || [];
}

function mergeConsecutiveRoles(messages) {
    if (messages.length <= 1) return messages;
    const merged = [];
    for (const msg of messages) {
        const last = merged[merged.length - 1];
        if (last && last.role === msg.role) {
            const lastBlocks = toBlocks(last.content);
            const newBlocks = toBlocks(msg.content);
            last.content = [...lastBlocks, ...newBlocks];
        } else {
            merged.push({ ...msg });
        }
    }
    return merged;
}

// ─── 内联 responsesToChatCompletions（与 src/openai-handler.ts 保持同步）
function responsesToChatCompletions(body) {
    const messages = [];

    if (body.instructions && typeof body.instructions === 'string') {
        messages.push({ role: 'system', content: body.instructions });
    }

    const input = body.input;
    if (typeof input === 'string') {
        messages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
        for (const item of input) {
            // function_call_output has type but no role — check first
            if (item.type === 'function_call_output') {
                messages.push({
                    role: 'tool',
                    content: stringifyUnknownContent(item.output),
                    tool_call_id: item.call_id || '',
                });
                continue;
            }
            const role = item.role || 'user';
            if (role === 'system' || role === 'developer') {
                const text = extractOpenAIContent({
                    role: 'system',
                    content: item.content ?? null,
                });
                messages.push({ role: 'system', content: text });
            } else if (role === 'user') {
                const rawContent = item.content ?? null;
                const normalizedContent = typeof rawContent === 'string'
                    ? rawContent
                    : Array.isArray(rawContent) && rawContent.every(b => b.type === 'input_text')
                        ? rawContent.map(b => b.text || '').join('\n')
                        : rawContent;
                messages.push({
                    role: 'user',
                    content: normalizedContent,
                });
            } else if (role === 'assistant') {
                const blocks = Array.isArray(item.content) ? item.content : [];
                const text = blocks.filter(b => b.type === 'output_text').map(b => b.text).join('\n');
                const toolCallBlocks = blocks.filter(b => b.type === 'function_call');
                const toolCalls = toolCallBlocks.map(b => ({
                    id: b.call_id || `call_${Math.random().toString(36).slice(2)}`,
                    type: 'function',
                    function: {
                        name: b.name || '',
                        arguments: b.arguments || '{}',
                    },
                }));
                messages.push({
                    role: 'assistant',
                    content: text || null,
                    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                });
            }
        }
    }

    const tools = Array.isArray(body.tools)
        ? body.tools.map(t => ({
            type: 'function',
            function: {
                name: t.name || '',
                description: t.description,
                parameters: t.parameters,
            },
        }))
        : undefined;

    return {
        model: body.model || 'gpt-4',
        messages,
        stream: body.stream ?? true,
        temperature: body.temperature,
        max_tokens: body.max_output_tokens || 8192,
        tools,
    };
}

// ════════════════════════════════════════════════════════════════════
// 1. responsesToChatCompletions — 基本转换
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [1] responsesToChatCompletions — 基本转换\n');

test('简单字符串 input → user 消息', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: 'Hello, how are you?',
    });
    assertEqual(result.model, 'gpt-4');
    assertEqual(result.messages.length, 1);
    assertEqual(result.messages[0].role, 'user');
    assertEqual(result.messages[0].content, 'Hello, how are you?');
});

test('带 instructions → system 消息', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        instructions: 'You are a helpful assistant.',
        input: 'Hello',
    });
    assertEqual(result.messages.length, 2);
    assertEqual(result.messages[0].role, 'system');
    assertEqual(result.messages[0].content, 'You are a helpful assistant.');
    assertEqual(result.messages[1].role, 'user');
});

test('多轮对话 input 数组', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: [
            { role: 'user', content: 'What is 2+2?' },
            { role: 'assistant', content: [{ type: 'output_text', text: '4' }] },
            { role: 'user', content: 'And 3+3?' },
        ],
    });
    assertEqual(result.messages.length, 3);
    assertEqual(result.messages[0].role, 'user');
    assertEqual(result.messages[1].role, 'assistant');
    assertEqual(result.messages[1].content, '4');
    assertEqual(result.messages[2].role, 'user');
});

test('developer 角色 → system', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: [
            { role: 'developer', content: 'You are a coding assistant.' },
            { role: 'user', content: 'Write hello world' },
        ],
    });
    assertEqual(result.messages[0].role, 'system');
    assertEqual(result.messages[0].content, 'You are a coding assistant.');
});

test('function_call_output → tool 消息', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: [
            { role: 'user', content: 'List files' },
            {
                role: 'assistant',
                content: [{
                    type: 'function_call',
                    call_id: 'call_123',
                    name: 'list_dir',
                    arguments: '{"path":"."}'
                }]
            },
            {
                type: 'function_call_output',
                call_id: 'call_123',
                output: 'file1.ts\nfile2.ts'
            },
        ],
    });
    assertEqual(result.messages.length, 3);
    assertEqual(result.messages[2].role, 'tool');
    assertEqual(result.messages[2].content, 'file1.ts\nfile2.ts');
    assertEqual(result.messages[2].tool_call_id, 'call_123');
});

test('function_call_output 对象 → JSON 字符串', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: [
            { role: 'user', content: 'Summarize tool output' },
            {
                type: 'function_call_output',
                call_id: 'call_obj',
                output: { files: ['a.ts', 'b.ts'], count: 2 }
            },
        ],
    });
    assertEqual(result.messages.length, 2);
    assertEqual(result.messages[1].role, 'tool');
    assertEqual(result.messages[1].content, '{"files":["a.ts","b.ts"],"count":2}');
    assertEqual(result.messages[1].tool_call_id, 'call_obj');
});

test('助手消息带 function_call → tool_calls', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: [
            { role: 'user', content: 'Read file' },
            {
                role: 'assistant',
                content: [{
                    type: 'function_call',
                    call_id: 'call_abc',
                    name: 'read_file',
                    arguments: '{"path":"index.ts"}'
                }]
            },
        ],
    });
    assertEqual(result.messages[1].role, 'assistant');
    assert(result.messages[1].tool_calls, 'should have tool_calls');
    assertEqual(result.messages[1].tool_calls.length, 1);
    assertEqual(result.messages[1].tool_calls[0].function.name, 'read_file');
    assertEqual(result.messages[1].tool_calls[0].function.arguments, '{"path":"index.ts"}');
});

test('工具定义转换', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: 'hello',
        tools: [
            {
                type: 'function',
                name: 'read_file',
                description: 'Read a file',
                parameters: { type: 'object', properties: { path: { type: 'string' } } },
            }
        ],
    });
    assert(result.tools, 'should have tools');
    assertEqual(result.tools.length, 1);
    assertEqual(result.tools[0].function.name, 'read_file');
});

test('input_text content 数组', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: [
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Part 1' },
                    { type: 'input_text', text: 'Part 2' },
                ]
            },
        ],
    });
    assertEqual(result.messages[0].content, 'Part 1\nPart 2');
});

test('Responses user input_image 不应丢失', () => {
    const result = responsesToChatCompletions({
        model: 'gpt-4',
        input: [
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: '请描述这张图' },
                    { type: 'input_image', image_url: { url: 'https://example.com/image.jpg' } },
                ]
            },
        ],
    });
    assertEqual(result.messages.length, 1);
    assert(Array.isArray(result.messages[0].content), 'content should remain multimodal blocks');
    assertEqual(result.messages[0].content[0], { type: 'input_text', text: '请描述这张图' });
    assertEqual(result.messages[0].content[1], { type: 'input_image', image_url: { url: 'https://example.com/image.jpg' } });
});

test('stream 默认为 true', () => {
    const result = responsesToChatCompletions({ model: 'gpt-4', input: 'hi' });
    assertEqual(result.stream, true);
});

test('stream 显式设为 false', () => {
    const result = responsesToChatCompletions({ model: 'gpt-4', input: 'hi', stream: false });
    assertEqual(result.stream, false);
});

test('max_output_tokens 转换', () => {
    const result = responsesToChatCompletions({ model: 'gpt-4', input: 'hi', max_output_tokens: 4096 });
    assertEqual(result.max_tokens, 4096);
});

// ════════════════════════════════════════════════════════════════════
// 2. mergeConsecutiveRoles — 消息合并
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [2] mergeConsecutiveRoles — 消息合并\n');

test('交替角色不合并', () => {
    const msgs = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Bye' },
    ];
    const result = mergeConsecutiveRoles(msgs);
    assertEqual(result.length, 3);
});

test('连续 user 消息合并', () => {
    const msgs = [
        { role: 'user', content: 'Message 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response' },
    ];
    const result = mergeConsecutiveRoles(msgs);
    assertEqual(result.length, 2);
    assertEqual(result[0].role, 'user');
    // 合并后应为 block 数组
    assert(Array.isArray(result[0].content), 'merged content should be array');
    assertEqual(result[0].content.length, 2);
    assertEqual(result[0].content[0].text, 'Message 1');
    assertEqual(result[0].content[1].text, 'Message 2');
});

test('连续 assistant 消息合并', () => {
    const msgs = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Part 1' },
        { role: 'assistant', content: 'Part 2' },
    ];
    const result = mergeConsecutiveRoles(msgs);
    assertEqual(result.length, 2);
    assertEqual(result[1].role, 'assistant');
    assert(Array.isArray(result[1].content));
    assertEqual(result[1].content.length, 2);
});

test('tool result + text user 消息合并', () => {
    const msgs = [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: 'output' }] },
        { role: 'user', content: 'Follow up question' },
    ];
    const result = mergeConsecutiveRoles(msgs);
    assertEqual(result.length, 1);
    assert(Array.isArray(result[0].content));
    assertEqual(result[0].content.length, 2); // tool_result + text
});

test('空消息列表', () => {
    assertEqual(mergeConsecutiveRoles([]).length, 0);
});

test('单条消息不合并', () => {
    const result = mergeConsecutiveRoles([{ role: 'user', content: 'solo' }]);
    assertEqual(result.length, 1);
});

test('三条连续 user 全部合并', () => {
    const msgs = [
        { role: 'user', content: 'A' },
        { role: 'user', content: 'B' },
        { role: 'user', content: 'C' },
    ];
    const result = mergeConsecutiveRoles(msgs);
    assertEqual(result.length, 1);
    assert(Array.isArray(result[0].content));
    assertEqual(result[0].content.length, 3);
});

// ════════════════════════════════════════════════════════════════════
// 3. Cursor 扁平格式工具兼容
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [3] Cursor 扁平格式工具兼容\n');

function convertTools(tools) {
    return tools.map(t => {
        if ('function' in t && t.function) {
            return {
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters || { type: 'object', properties: {} },
            };
        }
        return {
            name: t.name || '',
            description: t.description,
            input_schema: t.input_schema || { type: 'object', properties: {} },
        };
    });
}

test('标准 OpenAI 格式工具', () => {
    const tools = convertTools([{
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read file contents',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
    }]);
    assertEqual(tools[0].name, 'read_file');
    assertEqual(tools[0].description, 'Read file contents');
    assert(tools[0].input_schema.properties.path);
});

test('Cursor 扁平格式工具', () => {
    const tools = convertTools([{
        name: 'write_file',
        description: 'Write file',
        input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
    }]);
    assertEqual(tools[0].name, 'write_file');
    assertEqual(tools[0].description, 'Write file');
    assert(tools[0].input_schema.properties.path);
    assert(tools[0].input_schema.properties.content);
});

test('混合格式工具列表', () => {
    const tools = convertTools([
        {
            type: 'function',
            function: { name: 'tool_a', description: 'A', parameters: {} },
        },
        {
            name: 'tool_b',
            description: 'B',
            input_schema: {},
        },
    ]);
    assertEqual(tools.length, 2);
    assertEqual(tools[0].name, 'tool_a');
    assertEqual(tools[1].name, 'tool_b');
});

test('缺少 input_schema 的扁平格式', () => {
    const tools = convertTools([{ name: 'simple_tool' }]);
    assertEqual(tools[0].name, 'simple_tool');
    assert(tools[0].input_schema, 'should have default input_schema');
    assertEqual(tools[0].input_schema.type, 'object');
});

// ════════════════════════════════════════════════════════════════════
// 4. 增量流式工具调用验证
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [4] 增量流式工具调用验证\n');

test('128 字节分块：short arguments', () => {
    const args = '{"path":"src/index.ts"}';
    const CHUNK_SIZE = 128;
    const chunks = [];
    for (let j = 0; j < args.length; j += CHUNK_SIZE) {
        chunks.push(args.slice(j, j + CHUNK_SIZE));
    }
    // 短参数应一帧发完
    assertEqual(chunks.length, 1);
    assertEqual(chunks[0], args);
});

test('128 字节分块：long arguments', () => {
    const longContent = 'A'.repeat(400);
    const args = JSON.stringify({ path: 'test.ts', content: longContent });
    const CHUNK_SIZE = 128;
    const chunks = [];
    for (let j = 0; j < args.length; j += CHUNK_SIZE) {
        chunks.push(args.slice(j, j + CHUNK_SIZE));
    }
    // 拼接后应等于原始数据
    assertEqual(chunks.join(''), args);
    // 应有多帧
    assert(chunks.length > 1, `Expected multiple chunks, got ${chunks.length}`);
    // 每帧最多 128 字节
    for (const c of chunks) {
        assert(c.length <= CHUNK_SIZE, `Chunk too long: ${c.length}`);
    }
});

test('空 arguments 零帧', () => {
    const args = '';
    const CHUNK_SIZE = 128;
    const chunks = [];
    for (let j = 0; j < args.length; j += CHUNK_SIZE) {
        chunks.push(args.slice(j, j + CHUNK_SIZE));
    }
    assertEqual(chunks.length, 0);
});

// ════════════════════════════════════════════════════════════════════
// 汇总
// ════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
