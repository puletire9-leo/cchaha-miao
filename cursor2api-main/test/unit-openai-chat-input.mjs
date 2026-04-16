/**
 * test/unit-openai-chat-input.mjs
 *
 * 单元测试：/v1/chat/completions 输入内容块兼容性
 * 运行方式：node test/unit-openai-chat-input.mjs
 */

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
    return String(msg.content);
}

function extractOpenAIContent(msg) {
    const blocks = extractOpenAIContentBlocks(msg);
    if (typeof blocks === 'string') return blocks;
    return blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function convertToAnthropicRequest(body) {
    const rawMessages = [];
    let systemPrompt;

    for (const msg of body.messages) {
        switch (msg.role) {
            case 'system':
                systemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') + extractOpenAIContent(msg);
                break;
            case 'user': {
                const contentBlocks = extractOpenAIContentBlocks(msg);
                rawMessages.push({
                    role: 'user',
                    content: Array.isArray(contentBlocks) ? contentBlocks : (contentBlocks || ''),
                });
                break;
            }
        }
    }

    return {
        system: systemPrompt,
        messages: rawMessages,
    };
}

console.log('\n📦 [1] chat.completions input_text 兼容\n');

test('user input_text 不应丢失', () => {
    const req = convertToAnthropicRequest({
        model: 'gpt-4.1',
        messages: [{
            role: 'user',
            content: [
                { type: 'input_text', text: '请描述这张图' },
                { type: 'input_image', image_url: { url: 'https://example.com/a.jpg' } },
            ],
        }],
    });

    assertEqual(req.messages.length, 1);
    assert(Array.isArray(req.messages[0].content), 'content should be block array');
    assertEqual(req.messages[0].content[0], { type: 'text', text: '请描述这张图' });
    assertEqual(req.messages[0].content[1].type, 'image');
});

test('system input_text 应拼接进 system prompt', () => {
    const req = convertToAnthropicRequest({
        model: 'gpt-4.1',
        messages: [{
            role: 'system',
            content: [
                { type: 'input_text', text: '你是一个严谨的助手。' },
                { type: 'input_text', text: '请直接回答。' },
            ],
        }, {
            role: 'user',
            content: 'hi',
        }],
    });

    assertEqual(req.system, '你是一个严谨的助手。\n请直接回答。');
});

test('传统 text 块仍然兼容', () => {
    const req = convertToAnthropicRequest({
        model: 'gpt-4.1',
        messages: [{
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
        }],
    });

    assertEqual(req.messages[0].content[0], { type: 'text', text: 'hello' });
});

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
