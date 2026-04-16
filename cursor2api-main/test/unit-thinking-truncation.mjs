/**
 * unit-thinking-truncation.mjs
 *
 * 测试 thinking 截断场景下的修复逻辑：
 * 1. splitLeadingThinkingBlocks 未闭合时返回部分 thinkingContent（而非空字符串）
 * 2. closeUnclosedThinking 在 assistantContext 中补全缺失的 </thinking> 标签
 */

import { splitLeadingThinkingBlocks } from '../dist/streaming-text.js';
// closeUnclosedThinking 是 handler 内部函数，不直接导出；改为内联一份相同实现做白盒测试
function closeUnclosedThinking(text) {
    const opens = (text.match(/<thinking>/g) || []).length;
    const closes = (text.match(/<\/thinking>/g) || []).length;
    if (opens > closes) return text + '</thinking>\n';
    return text;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ ${name}`);
        console.error(`      ${message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertContains(actual, substring, message) {
    if (!actual.includes(substring)) {
        throw new Error(message || `Expected string to contain ${JSON.stringify(substring)}, got ${JSON.stringify(actual)}`);
    }
}

// ==================== splitLeadingThinkingBlocks 测试 ====================

console.log('\n📦 splitLeadingThinkingBlocks — thinking 截断处理\n');

test('完整 thinking 块：complete=true，正确提取内容', () => {
    const text = '<thinking>\n我在思考这道题\n</thinking>\n这是正文';
    const result = splitLeadingThinkingBlocks(text);
    assertEqual(result.startedWithThinking, true, 'startedWithThinking');
    assertEqual(result.complete, true, 'complete');
    assertEqual(result.thinkingContent, '我在思考这道题', 'thinkingContent');
    assertEqual(result.remainder, '这是正文', 'remainder');
});

test('thinking 未闭合（截断）：complete=false，仍返回部分 thinkingContent', () => {
    const text = '<thinking>\n开始深入分析这个问题，考虑各种边界情况……';
    const result = splitLeadingThinkingBlocks(text);
    assertEqual(result.startedWithThinking, true, 'startedWithThinking');
    assertEqual(result.complete, false, 'complete 应为 false');
    // ★ 修复前：thinkingContent 为 ''；修复后应包含实际 thinking 内容
    assertContains(
        result.thinkingContent,
        '开始深入分析这个问题',
        'thinkingContent 应包含截断前的 thinking 内容，而不是空字符串',
    );
    assertEqual(result.remainder, '', 'remainder 应为空，不泄漏到正文');
});

test('thinking 未闭合：thinkingContent 不含 <thinking> 开标签本身', () => {
    const text = '<thinking>\n分析中……';
    const result = splitLeadingThinkingBlocks(text);
    if (result.thinkingContent.includes('<thinking>')) {
        throw new Error('thinkingContent 不应包含 <thinking> 开标签');
    }
});

test('空 thinking 块未闭合（<thinking> 后无内容）：thinkingContent 为空字符串', () => {
    const text = '<thinking>';
    const result = splitLeadingThinkingBlocks(text);
    assertEqual(result.startedWithThinking, true, 'startedWithThinking');
    assertEqual(result.complete, false, 'complete');
    assertEqual(result.thinkingContent, '', 'thinkingContent 应为空字符串');
});

test('多个完整 thinking 块后接未闭合块：合并所有内容', () => {
    const text = '<thinking>第一段</thinking>\n<thinking>第二段截断中……';
    const result = splitLeadingThinkingBlocks(text);
    assertEqual(result.startedWithThinking, true, 'startedWithThinking');
    assertEqual(result.complete, false, 'complete');
    assertContains(result.thinkingContent, '第一段', '应包含第一段');
    assertContains(result.thinkingContent, '第二段截断中', '应包含截断的第二段');
});

test('无 thinking 标签：startedWithThinking=false，remainder=原文', () => {
    const text = '这是普通正文内容';
    const result = splitLeadingThinkingBlocks(text);
    assertEqual(result.startedWithThinking, false, 'startedWithThinking');
    assertEqual(result.remainder, text, 'remainder 应为原文');
});

// ==================== closeUnclosedThinking 测试 ====================

console.log('\n📦 closeUnclosedThinking — 续写 assistantContext 补全标签\n');

test('无 thinking 标签：原文不变', () => {
    const text = '这是正常的 assistant 上下文';
    assertEqual(closeUnclosedThinking(text), text, '不含 thinking 标签时应原样返回');
});

test('thinking 已闭合：原文不变', () => {
    const text = '<thinking>思考内容</thinking>\n正文内容';
    assertEqual(closeUnclosedThinking(text), text, '已闭合时不应修改');
});

test('thinking 未闭合：自动追加 </thinking>', () => {
    const text = '<thinking>\n思考中，然后被截断了……';
    const result = closeUnclosedThinking(text);
    assertContains(result, '</thinking>', '应补全 </thinking> 标签');
    // 补全后 <thinking> 和 </thinking> 数量应相等
    const opens = (result.match(/<thinking>/g) || []).length;
    const closes = (result.match(/<\/thinking>/g) || []).length;
    assertEqual(opens, closes, '<thinking> 和 </thinking> 数量应相等');
});

test('assistantContext 截断后的典型场景：... + 未闭合 thinking 尾部', () => {
    // 模拟 fullResponse.slice(-2000)，截到 thinking 中间（开标签不在窗口内）
    const text = '...\n分析更多细节，考虑到边界情况……';
    // 这段没有 <thinking>，closeUnclosedThinking 应原样返回
    assertEqual(closeUnclosedThinking(text), text, '无开标签时不应修改');
});

test('assistantContext 包含完整 thinking 后接未闭合内容：补全标签', () => {
    const text = '<thinking>第一段完整</thinking>\n<thinking>第二段截断中……';
    const result = closeUnclosedThinking(text);
    const opens = (result.match(/<thinking>/g) || []).length;
    const closes = (result.match(/<\/thinking>/g) || []).length;
    assertEqual(opens, closes, '补全后开闭标签数量应相等');
});

// ==================== 汇总 ====================

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
if (failed > 0) process.exit(1);
