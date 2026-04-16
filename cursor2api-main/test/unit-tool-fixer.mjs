/**
 * test/unit-tool-fixer.mjs
 *
 * 单元测试：tool-fixer 的各功能
 * 运行方式：node test/unit-tool-fixer.mjs
 */

// ─── 内联实现（与 src/tool-fixer.ts 保持同步，避免依赖 dist）──────────────

const SMART_DOUBLE_QUOTES = new Set([
    '\u00ab', '\u201c', '\u201d', '\u275e',
    '\u201f', '\u201e', '\u275d', '\u00bb',
]);
const SMART_SINGLE_QUOTES = new Set([
    '\u2018', '\u2019', '\u201a', '\u201b',
]);

function normalizeToolArguments(args) {
    if (!args || typeof args !== 'object') return args;
    // Removed legacy file_path to path conversion
    return args;
}

function replaceSmartQuotes(text) {
    const chars = [...text];
    return chars.map(ch => {
        if (SMART_DOUBLE_QUOTES.has(ch)) return '"';
        if (SMART_SINGLE_QUOTES.has(ch)) return "'";
        return ch;
    }).join('');
}

function fixToolCallArguments(toolName, args) {
    args = normalizeToolArguments(args);
    // repairExactMatchToolArguments is skipped in unit test (needs file system)
    return args;
}

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

// ════════════════════════════════════════════════════════════════════
// 1. normalizeToolArguments — 字段名映射
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [1] normalizeToolArguments — 字段名映射\n');

test('file_path不再隐式转为path', () => {
    const args = { file_path: 'src/index.ts', content: 'hello' };
    const result = normalizeToolArguments(args);
    assertEqual(result.file_path, 'src/index.ts', '应保留原始 file_path');
    assert(!('path' in result), '不应自动生成 path');
    assertEqual(result.content, 'hello');
});

test('同时存在时保持不变', () => {
    const args = { file_path: 'old.ts', path: 'new.ts' };
    const result = normalizeToolArguments(args);
    assertEqual(result.path, 'new.ts');
    assert('file_path' in result);
});

test('无 file_path 时不影响', () => {
    const args = { path: 'foo.ts', content: 'bar' };
    const result = normalizeToolArguments(args);
    assertEqual(result.path, 'foo.ts');
    assertEqual(result.content, 'bar');
});

test('null/undefined 输入安全', () => {
    assertEqual(normalizeToolArguments(null), null);
    assertEqual(normalizeToolArguments(undefined), undefined);
});

test('空对象', () => {
    const result = normalizeToolArguments({});
    assertEqual(result, {});
});

// ════════════════════════════════════════════════════════════════════
// 2. replaceSmartQuotes — 智能引号替换
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [2] replaceSmartQuotes — 智能引号替换\n');

test('中文双引号 → 普通双引号', () => {
    const input = '\u201c你好\u201d';
    assertEqual(replaceSmartQuotes(input), '"你好"');
});

test('中文单引号 → 普通单引号', () => {
    const input = '\u2018hello\u2019';
    assertEqual(replaceSmartQuotes(input), "'hello'");
});

test('混合引号替换', () => {
    const input = '\u201cHello\u201d and \u2018World\u2019';
    assertEqual(replaceSmartQuotes(input), '"Hello" and \'World\'');
});

test('无智能引号时原样返回', () => {
    const input = '"normal" and \'single\'';
    assertEqual(replaceSmartQuotes(input), input);
});

test('空字符串', () => {
    assertEqual(replaceSmartQuotes(''), '');
});

test('法文引号 « »', () => {
    const input = '\u00abBonjour\u00bb';
    assertEqual(replaceSmartQuotes(input), '"Bonjour"');
});

test('代码中的智能引号修复', () => {
    const input = 'const name = \u201cClaude\u201d;';
    assertEqual(replaceSmartQuotes(input), 'const name = "Claude";');
});

// ════════════════════════════════════════════════════════════════════
// 3. fixToolCallArguments — 综合修复
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [3] fixToolCallArguments — 综合修复\n');

test('Read 工具: file_path 保持 file_path', () => {
    const args = { file_path: 'src/main.ts' };
    const result = fixToolCallArguments('Read', args);
    assertEqual(result.file_path, 'src/main.ts');
    assert(!('path' in result));
});

test('Write 工具: file_path + content 保持不被截断', () => {
    const args = { file_path: 'test.ts', content: 'console.log("hello")' };
    const result = fixToolCallArguments('Write', args);
    assertEqual(result.file_path, 'test.ts');
    assertEqual(result.content, 'console.log("hello")');
});

test('Bash 工具: 无映射需要', () => {
    const args = { command: 'ls -la' };
    const result = fixToolCallArguments('Bash', args);
    assertEqual(result.command, 'ls -la');
});

test('非对象参数安全处理', () => {
    assertEqual(fixToolCallArguments('Read', null), null);
    assertEqual(fixToolCallArguments('Read', undefined), undefined);
});

// ════════════════════════════════════════════════════════════════════
// 4. parseToolCalls with fixToolCallArguments — 集成测试
// ════════════════════════════════════════════════════════════════════
console.log('\n📦 [4] parseToolCalls + fixToolCallArguments 集成\n');

function tolerantParse(jsonStr) {
    try { return JSON.parse(jsonStr); } catch { /* pass */ }
    let inString = false, escaped = false, fixed = '';
    const bracketStack = [];
    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        if (char === '\\' && !escaped) { escaped = true; fixed += char; }
        else if (char === '"' && !escaped) { inString = !inString; fixed += char; escaped = false; }
        else { if (inString) { if (char === '\n') fixed += '\\n'; else if (char === '\r') fixed += '\\r'; else if (char === '\t') fixed += '\\t'; else fixed += char; } else { if (char === '{' || char === '[') bracketStack.push(char === '{' ? '}' : ']'); else if (char === '}' || char === ']') { if (bracketStack.length > 0) bracketStack.pop(); } fixed += char; } escaped = false; }
    }
    if (inString) fixed += '"';
    while (bracketStack.length > 0) fixed += bracketStack.pop();
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch (_e2) {
        const lastBrace = fixed.lastIndexOf('}');
        if (lastBrace > 0) { try { return JSON.parse(fixed.substring(0, lastBrace + 1)); } catch { } }
        throw _e2;
    }
}

function parseToolCallsWithFix(responseText) {
    const toolCalls = [];
    let cleanText = responseText;
    const fullBlockRegex = /```json(?:\s+action)?\s*([\s\S]*?)\s*```/g;
    let match;
    while ((match = fullBlockRegex.exec(responseText)) !== null) {
        let isToolCall = false;
        try {
            const parsed = tolerantParse(match[1]);
            if (parsed.tool || parsed.name) {
                const name = parsed.tool || parsed.name;
                let args = parsed.parameters || parsed.arguments || parsed.input || {};
                args = fixToolCallArguments(name, args);
                toolCalls.push({ name, arguments: args });
                isToolCall = true;
            }
        } catch (e) { /* skip */ }
        if (isToolCall) cleanText = cleanText.replace(match[0], '');
    }
    return { toolCalls, cleanText: cleanText.trim() };
}

test('解析含 file_path 的工具调用 → 保持为 file_path', () => {
    const text = `I'll read the file now.

\`\`\`json action
{
  "tool": "Read",
  "parameters": {
    "file_path": "src/index.ts"
  }
}
\`\`\``;
    const { toolCalls } = parseToolCallsWithFix(text);
    assertEqual(toolCalls.length, 1);
    assertEqual(toolCalls[0].name, 'Read');
    assertEqual(toolCalls[0].arguments.file_path, 'src/index.ts');
    assert(!('path' in toolCalls[0].arguments), '不应生成 path');
});

test('多个工具调用不再强转', () => {
    const text = `\`\`\`json action
{"tool":"Read","parameters":{"file_path":"a.ts"}}
\`\`\`

\`\`\`json action
{"tool":"Write","parameters":{"file_path":"b.ts","content":"hello"}}
\`\`\``;
    const { toolCalls } = parseToolCallsWithFix(text);
    assertEqual(toolCalls.length, 2);
    assertEqual(toolCalls[0].arguments.file_path, 'a.ts');
    assertEqual(toolCalls[1].arguments.file_path, 'b.ts');
    assertEqual(toolCalls[1].arguments.content, 'hello');
});

test('无需修复的工具调用保持不变', () => {
    const text = `\`\`\`json action
{"tool":"Bash","parameters":{"command":"npm run build"}}
\`\`\``;
    const { toolCalls } = parseToolCallsWithFix(text);
    assertEqual(toolCalls.length, 1);
    assertEqual(toolCalls[0].arguments.command, 'npm run build');
});

// ════════════════════════════════════════════════════════════════════
// 汇总
// ════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
