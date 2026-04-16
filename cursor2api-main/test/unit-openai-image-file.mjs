/**
 * test/unit-openai-image-file.mjs
 *
 * 单元测试：image_file 输入应显式报错，而不是静默降级
 * 运行方式：node test/unit-openai-image-file.mjs
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

class OpenAIRequestError extends Error {
    constructor(message, status = 400, type = 'invalid_request_error', code = 'invalid_request') {
        super(message);
        this.name = 'OpenAIRequestError';
        this.status = status;
        this.type = type;
        this.code = code;
    }
}

function unsupportedImageFileError(fileId) {
    const suffix = fileId ? ` (file_id: ${fileId})` : '';
    return new OpenAIRequestError(
        `Unsupported content part: image_file${suffix}. This proxy does not support OpenAI Files API image references. Please send the image as image_url, input_image, data URI, or a local file path instead.`,
        400,
        'invalid_request_error',
        'unsupported_content_part'
    );
}

function extractOpenAIContentBlocks(msg) {
    if (msg.content === null || msg.content === undefined) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        const blocks = [];
        for (const p of msg.content) {
            if (p.type === 'text' || p.type === 'input_text') {
                if (p.text) blocks.push({ type: 'text', text: p.text });
            } else if (p.type === 'image_file' && p.image_file) {
                throw unsupportedImageFileError(p.image_file.file_id);
            }
        }
        return blocks.length > 0 ? blocks : '';
    }
    return String(msg.content);
}

console.log('\n📦 [1] image_file 显式报错\n');

test('image_file 应抛出 OpenAIRequestError', () => {
    let thrown;
    try {
        extractOpenAIContentBlocks({
            role: 'user',
            content: [
                { type: 'input_text', text: '请描述图片' },
                { type: 'image_file', image_file: { file_id: 'file_123' } },
            ],
        });
    } catch (e) {
        thrown = e;
    }

    assert(thrown instanceof OpenAIRequestError, 'should throw OpenAIRequestError');
    assert(thrown.message.includes('image_file'), 'message should mention image_file');
    assert(thrown.message.includes('file_123'), 'message should include file_id');
    assert(thrown.status === 400, 'status should be 400');
    assert(thrown.type === 'invalid_request_error', 'type should be invalid_request_error');
    assert(thrown.code === 'unsupported_content_part', 'code should be unsupported_content_part');
});

test('普通文本块仍可正常通过', () => {
    const blocks = extractOpenAIContentBlocks({
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
    });
    assert(Array.isArray(blocks), 'blocks should be array');
    assert(blocks[0].text === 'hello', 'text block should remain intact');
});

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
