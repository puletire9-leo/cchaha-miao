/**
 * test/e2e-prompt-ab.mjs
 *
 * behaviorRules 提示词 A/B 对比测试
 *
 * 目标：量化衡量不同 behaviorRules 变体对模型行为的影响
 * 
 * 测量维度：
 *   1. tool_call_count    — 每轮产生的工具调用数量
 *   2. narration_ratio    — 文本叙述 vs 工具调用的比例（越低越好）
 *   3. format_correct     — ```json action 格式是否正确
 *   4. parallel_rate      — 独立工具是否被并行调用
 *   5. empty_response     — 是否出现空响应（无工具也无文本）
 *   6. first_turn_action  — 第一轮是否直接行动（vs 纯文字描述计划）
 *
 * 用法：
 *   node test/e2e-prompt-ab.mjs                    # 使用当前线上版本
 *   VARIANT=baseline node test/e2e-prompt-ab.mjs   # 标记为 baseline
 *   VARIANT=candidate_a node test/e2e-prompt-ab.mjs # 标记为 candidate_a
 *
 *   # 对比结果：
 *   node test/e2e-prompt-ab.mjs --compare
 */

const BASE_URL = `http://localhost:${process.env.PORT || 3010}`;
const MODEL = 'claude-sonnet-4-5-20251120';
const MAX_TURNS = 8;
const VARIANT = process.env.VARIANT || 'current';
const COMPARE_MODE = process.argv.includes('--compare');

// ─── 颜色 ─────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', blue: '\x1b[34m', magenta: '\x1b[35m', gray: '\x1b[90m',
    white: '\x1b[37m',
};
const ok   = s => `${C.green}✅ ${s}${C.reset}`;
const fail = s => `${C.red}❌ ${s}${C.reset}`;
const warn = s => `${C.yellow}⚠  ${s}${C.reset}`;
const hdr  = s => `\n${C.bold}${C.cyan}━━━ ${s} ━━━${C.reset}`;
const info = s => `  ${C.gray}${s}${C.reset}`;

// ─── 工具集（精简版，覆盖关键场景） ──────────────────────────────────
const TOOLS = [
    {
        name: 'Read',
        description: 'Reads a file from the local filesystem.',
        input_schema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Absolute path to the file' },
            },
            required: ['file_path'],
        },
    },
    {
        name: 'Write',
        description: 'Write a file to the local filesystem.',
        input_schema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Absolute path to the file' },
                content:   { type: 'string', description: 'Content to write' },
            },
            required: ['file_path', 'content'],
        },
    },
    {
        name: 'Bash',
        description: 'Executes a bash command in a persistent shell session.',
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The command to execute' },
            },
            required: ['command'],
        },
    },
    {
        name: 'Grep',
        description: 'Fast content search tool.',
        input_schema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Regex pattern to search for' },
                path:    { type: 'string', description: 'Path to search' },
            },
            required: ['pattern'],
        },
    },
    {
        name: 'LS',
        description: 'Lists files and directories.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path' },
            },
            required: ['path'],
        },
    },
    {
        name: 'attempt_completion',
        description: 'Present the final result to the user.',
        input_schema: {
            type: 'object',
            properties: {
                result: { type: 'string', description: 'Result summary' },
            },
            required: ['result'],
        },
    },
    {
        name: 'ask_followup_question',
        description: 'Ask the user a follow-up question.',
        input_schema: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'The question to ask' },
            },
            required: ['question'],
        },
    },
];

// ─── 虚拟工具执行 ────────────────────────────────────────────────────
const MOCK_FS = {
    '/project/package.json': '{"name":"my-app","version":"1.0.0","dependencies":{"express":"^4.18.0"}}',
    '/project/src/index.ts': 'import express from "express";\nconst app = express();\napp.listen(3000);',
    '/project/src/utils.ts': 'export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }',
    '/project/src/config.ts': 'export const config = { port: 3000, host: "localhost", debug: false };',
    '/project/README.md': '# My App\nA simple Express application.\n## Setup\nnpm install && npm start',
};

function mockExecute(name, input) {
    switch (name) {
        case 'Read': return MOCK_FS[input.file_path] || `Error: File not found: ${input.file_path}`;
        case 'Write': return `Wrote ${(input.content || '').length} chars to ${input.file_path}`;
        case 'Bash': return `$ ${input.command}\n(executed successfully)`;
        case 'Grep': return `/project/src/index.ts:1:import express`;
        case 'LS': return Object.keys(MOCK_FS).join('\n');
        case 'attempt_completion': return `__DONE__:${input.result}`;
        case 'ask_followup_question': return `__ASK__:${input.question}`;
        default: return `Tool ${name} executed`;
    }
}

// ─── 单轮请求发送器（用于第一轮分析） ──────────────────────────────────
async function sendSingleTurn(userMessage, { tools = TOOLS, systemPrompt = '', toolChoice } = {}) {
    const body = {
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt || 'You are an AI coding assistant. Working directory: /project.',
        tools,
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        messages: [{ role: 'user', content: userMessage }],
    };

    const t0 = Date.now();
    const resp = await fetch(`${BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'dummy' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
    }

    const data = await resp.json();
    const latencyMs = Date.now() - t0;

    return { data, latencyMs };
}

// ─── 多轮 Agentic 循环（用于完整任务分析） ─────────────────────────────
async function runMultiTurn(userMessage, { tools = TOOLS, systemPrompt = '', toolChoice, maxTurns = MAX_TURNS } = {}) {
    const messages = [{ role: 'user', content: userMessage }];
    const system = systemPrompt || 'You are an AI coding assistant. Working directory: /project.';

    let totalToolCalls = 0;
    let totalTextChars = 0;
    let turns = 0;
    let firstTurnHasToolCall = false;
    const toolCallLog = [];

    while (turns < maxTurns) {
        turns++;
        const resp = await fetch(`${BASE_URL}/v1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'dummy' },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 4096,
                system,
                tools,
                ...(toolChoice ? { tool_choice: toolChoice } : {}),
                messages,
            }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const textBlocks = data.content?.filter(b => b.type === 'text') || [];
        const toolUseBlocks = data.content?.filter(b => b.type === 'tool_use') || [];

        totalTextChars += textBlocks.reduce((s, b) => s + (b.text?.length || 0), 0);
        totalToolCalls += toolUseBlocks.length;

        if (turns === 1 && toolUseBlocks.length > 0) firstTurnHasToolCall = true;

        for (const tb of toolUseBlocks) {
            toolCallLog.push({ turn: turns, tool: tb.name, input: tb.input });
        }

        if (data.stop_reason === 'end_turn' || toolUseBlocks.length === 0) break;

        messages.push({ role: 'assistant', content: data.content });

        const toolResults = toolUseBlocks.map(tb => ({
            type: 'tool_result',
            tool_use_id: tb.id,
            content: mockExecute(tb.name, tb.input),
        }));
        messages.push({ role: 'user', content: toolResults });

        // Check for completion signal
        if (toolResults.some(r => r.content.startsWith('__DONE__'))) break;
    }

    return { totalToolCalls, totalTextChars, turns, firstTurnHasToolCall, toolCallLog };
}

// ─── 指标分析器 ──────────────────────────────────────────────────────
function analyzeResponse(data) {
    const content = data.content || [];
    const textBlocks = content.filter(b => b.type === 'text');
    const toolUseBlocks = content.filter(b => b.type === 'tool_use');

    const textLength = textBlocks.reduce((s, b) => s + (b.text?.length || 0), 0);
    const toolCallCount = toolUseBlocks.length;
    const hasToolCalls = toolCallCount > 0;
    const toolNames = toolUseBlocks.map(b => b.name);

    // 叙述占比：文本字符数 / (文本字符数 + 工具调用数 * 预估等效字符)
    // 工具调用等效约 100 字符
    const narrationRatio = textLength / Math.max(textLength + toolCallCount * 100, 1);

    // 格式检查：检查是否所有工具调用都有正确的 id 和 name
    const formatCorrect = toolUseBlocks.every(b => b.id && b.name && b.input !== undefined);

    return {
        textLength,
        toolCallCount,
        hasToolCalls,
        toolNames,
        narrationRatio: Math.round(narrationRatio * 100) / 100,
        formatCorrect,
        stopReason: data.stop_reason,
    };
}

// ─── 测试场景定义 ───────────────────────────────────────────────────
const TEST_SCENARIOS = [
    {
        id: 'single_tool',
        name: '单工具调用',
        description: '请求读取一个文件，期望：1个工具调用，最少叙述',
        prompt: 'Read the file /project/package.json',
        expected: { minTools: 1, maxNarration: 0.7 },
        mode: 'single',
    },
    {
        id: 'parallel_tools',
        name: '并行工具调用',
        description: '请求同时读取两个文件，期望：2个工具调用在同一轮',
        prompt: 'Read both /project/src/index.ts and /project/src/utils.ts at the same time.',
        expected: { minTools: 2, maxNarration: 0.6 },
        mode: 'single',
    },
    {
        id: 'action_vs_plan',
        name: '行动 vs 计划描述',
        description: '期望模型直接行动，而不是先描述计划',
        prompt: 'Check what dependencies this project uses.',
        expected: { firstTurnAction: true },
        mode: 'single',
    },
    {
        id: 'minimal_narration',
        name: '最少叙述',
        description: '简单任务期望极少解释文字',
        prompt: 'List all files in /project',
        expected: { maxNarration: 0.6, minTools: 1 },
        mode: 'single',
    },
    {
        id: 'multi_step_task',
        name: '多步任务完成度',
        description: '复杂任务，期望多轮调用，最终完成',
        prompt: 'Read /project/src/index.ts, then read /project/src/config.ts, and tell me what port the server listens on.',
        expected: { minTotalTools: 2 },
        mode: 'multi',
    },
    {
        id: 'no_echo_ready',
        name: '避免无意义命令',
        description: '模型不应输出 echo ready 等无意义命令',
        prompt: 'What is 2 + 2? Just answer directly.',
        expected: { noMeaninglessTools: true },
        mode: 'single',
    },
    {
        id: 'completion_signal',
        name: '完成信号使用',
        description: '任务完成后应使用 attempt_completion',
        prompt: 'Read /project/README.md and summarize it. Then call attempt_completion with your summary.',
        expected: { usesCompletion: true },
        mode: 'multi',
        toolChoice: { type: 'any' },
    },
    {
        id: 'format_precision',
        name: '格式精确度',
        description: '所有工具调用都应该有正确的格式',
        prompt: 'Read /project/package.json and then search for "express" in /project/src',
        expected: { formatCorrect: true },
        mode: 'multi',
    },
];

// ─── 对比模式 ─────────────────────────────────────────────────────────
if (COMPARE_MODE) {
    const fs = await import('fs');
    const resultFiles = fs.readdirSync('test')
        .filter(f => f.startsWith('prompt-ab-results-') && f.endsWith('.json'))
        .sort();

    if (resultFiles.length < 2) {
        console.log(`\n${fail('需要至少 2 个结果文件才能对比')}。已找到: ${resultFiles.length}`);
        console.log(info('运行测试: VARIANT=baseline node test/e2e-prompt-ab.mjs'));
        console.log(info('修改提示词后: VARIANT=candidate_a node test/e2e-prompt-ab.mjs'));
        process.exit(1);
    }

    const results = resultFiles.map(f => {
        const data = JSON.parse(fs.readFileSync(`test/${f}`, 'utf-8'));
        return { file: f, ...data };
    });

    console.log(`\n${C.bold}${C.magenta}══ behaviorRules A/B 对比报告 ══${C.reset}\n`);
    console.log(`已加载 ${results.length} 个结果文件:\n`);
    results.forEach(r => console.log(`  ${C.cyan}${r.variant}${C.reset} (${r.file}) — ${r.timestamp}`));

    // 对比表格
    console.log(`\n${'─'.repeat(100)}`);
    const header = `${'场景'.padEnd(20)}` + results.map(r => `${r.variant.padEnd(16)}`).join('');
    console.log(`${C.bold}${header}${C.reset}`);
    console.log(`${'─'.repeat(100)}`);

    const scenarioIds = [...new Set(results.flatMap(r => r.scenarios.map(s => s.id)))];

    for (const sid of scenarioIds) {
        const row = [sid.padEnd(20)];
        for (const r of results) {
            const s = r.scenarios.find(x => x.id === sid);
            if (!s) { row.push('N/A'.padEnd(16)); continue; }
            const metrics = s.metrics;
            if (metrics) {
                const emoji = s.passed ? '✅' : '❌';
                const brief = `${emoji} T:${metrics.toolCallCount || metrics.totalToolCalls || 0} N:${Math.round((metrics.narrationRatio || 0) * 100)}%`;
                row.push(brief.padEnd(16));
            } else {
                row.push('ERR'.padEnd(16));
            }
        }
        console.log(row.join(''));
    }
    console.log(`${'─'.repeat(100)}`);

    // 汇总分数
    console.log(`\n${C.bold}汇总:${C.reset}`);
    for (const r of results) {
        const passCount = r.scenarios.filter(s => s.passed).length;
        const totalTools = r.scenarios.reduce((s, x) => s + (x.metrics?.toolCallCount || x.metrics?.totalToolCalls || 0), 0);
        const avgNarration = r.scenarios.reduce((s, x) => s + (x.metrics?.narrationRatio || 0), 0) / r.scenarios.length;
        console.log(`  ${C.cyan}${r.variant}${C.reset}: ${passCount}/${r.scenarios.length} 通过, 总工具调用: ${totalTools}, 平均叙述占比: ${Math.round(avgNarration * 100)}%`);
    }

    process.exit(0);
}

// ─── 主测试流程 ──────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.magenta}  behaviorRules A/B 测试${C.reset}`);
console.log(info(`VARIANT=${VARIANT}  BASE_URL=${BASE_URL}  MODEL=${MODEL}`));

// 检测服务器
try {
    const r = await fetch(`${BASE_URL}/v1/models`, { headers: { 'x-api-key': 'dummy' } });
    if (!r.ok) throw new Error();
    console.log(`\n${ok('服务器在线')}`);
} catch {
    console.log(`\n${fail('服务器未运行')}`);
    process.exit(1);
}

const scenarioResults = [];
let passed = 0, failedCount = 0;

for (const scenario of TEST_SCENARIOS) {
    console.log(hdr(`${scenario.id}: ${scenario.name}`));
    console.log(info(scenario.description));

    const t0 = Date.now();
    try {
        let metrics;
        let testPassed = true;
        const failReasons = [];

        if (scenario.mode === 'single') {
            // 单轮分析
            const { data, latencyMs } = await sendSingleTurn(scenario.prompt, {
                toolChoice: scenario.toolChoice,
            });
            metrics = { ...analyzeResponse(data), latencyMs };

            // 检查期望
            if (scenario.expected.minTools && metrics.toolCallCount < scenario.expected.minTools) {
                testPassed = false;
                failReasons.push(`工具调用数 ${metrics.toolCallCount} < 期望最低 ${scenario.expected.minTools}`);
            }
            if (scenario.expected.maxNarration && metrics.narrationRatio > scenario.expected.maxNarration) {
                testPassed = false;
                failReasons.push(`叙述占比 ${metrics.narrationRatio} > 上限 ${scenario.expected.maxNarration}`);
            }
            if (scenario.expected.firstTurnAction && !metrics.hasToolCalls) {
                testPassed = false;
                failReasons.push('第一轮未执行工具调用（只是描述计划）');
            }
            if (scenario.expected.noMeaninglessTools && metrics.toolNames?.some(n => n === 'Bash')) {
                // Check if Bash was called with meaningless command
                const bashCalls = data.content?.filter(b => b.type === 'tool_use' && b.name === 'Bash') || [];
                for (const bc of bashCalls) {
                    const cmd = bc.input?.command || '';
                    if (/^(echo|printf|cat\s*$)/i.test(cmd.trim())) {
                        testPassed = false;
                        failReasons.push(`无意义命令: ${cmd}`);
                    }
                }
            }

            // 输出详情
            console.log(info(`  工具调用: ${metrics.toolCallCount} [${metrics.toolNames?.join(', ') || 'none'}]`));
            console.log(info(`  文本长度: ${metrics.textLength} chars`));
            console.log(info(`  叙述占比: ${Math.round(metrics.narrationRatio * 100)}%`));
            console.log(info(`  格式正确: ${metrics.formatCorrect ? '✅' : '❌'}`));
            console.log(info(`  延迟: ${metrics.latencyMs}ms`));

        } else {
            // 多轮分析
            const result = await runMultiTurn(scenario.prompt, {
                toolChoice: scenario.toolChoice,
            });
            metrics = {
                totalToolCalls: result.totalToolCalls,
                totalTextChars: result.totalTextChars,
                turns: result.turns,
                firstTurnHasToolCall: result.firstTurnHasToolCall,
                narrationRatio: result.totalTextChars / Math.max(result.totalTextChars + result.totalToolCalls * 100, 1),
                toolLog: result.toolCallLog.map(t => `${t.turn}:${t.tool}`).join(' → '),
            };

            // 检查期望
            if (scenario.expected.minTotalTools && result.totalToolCalls < scenario.expected.minTotalTools) {
                testPassed = false;
                failReasons.push(`总工具调用 ${result.totalToolCalls} < 期望 ${scenario.expected.minTotalTools}`);
            }
            if (scenario.expected.usesCompletion) {
                const usedCompletion = result.toolCallLog.some(t => t.tool === 'attempt_completion');
                if (!usedCompletion) {
                    // Only warn, don't fail
                    failReasons.push('未使用 attempt_completion（警告）');
                }
            }

            console.log(info(`  总工具调用: ${result.totalToolCalls}`));
            console.log(info(`  总轮数: ${result.turns}`));
            console.log(info(`  文本长度: ${result.totalTextChars} chars`));
            console.log(info(`  第一轮行动: ${result.firstTurnHasToolCall ? '✅' : '❌'}`));
            console.log(info(`  叙述占比: ${Math.round(metrics.narrationRatio * 100)}%`));
            console.log(info(`  调用链: ${metrics.toolLog}`));
        }

        const ms = ((Date.now() - t0) / 1000).toFixed(1);
        if (testPassed) {
            console.log(`  ${ok('通过')} (${ms}s)`);
            passed++;
        } else {
            console.log(`  ${warn('部分未达标')} (${ms}s)`);
            failReasons.forEach(r => console.log(`    ${C.yellow}→ ${r}${C.reset}`));
            failedCount++;
        }

        scenarioResults.push({
            id: scenario.id,
            name: scenario.name,
            passed: testPassed,
            failReasons,
            metrics,
        });

    } catch (err) {
        const ms = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  ${fail('错误')} (${ms}s): ${err.message}`);
        failedCount++;
        scenarioResults.push({
            id: scenario.id,
            name: scenario.name,
            passed: false,
            failReasons: [err.message],
            metrics: null,
        });
    }
}

// ─── 汇总 ────────────────────────────────────────────────────────────
const total = passed + failedCount;
console.log(`\n${'═'.repeat(62)}`);
console.log(`${C.bold}  [${VARIANT}] 结果: ${C.green}${passed} 通过${C.reset}${C.bold} / ${failedCount > 0 ? C.yellow : ''}${failedCount} 未达标${C.reset}${C.bold} / ${total} 场景${C.reset}`);
console.log('═'.repeat(62));

// 关键指标汇总
const singleScenarios = scenarioResults.filter(s => s.metrics?.toolCallCount !== undefined);
const multiScenarios = scenarioResults.filter(s => s.metrics?.totalToolCalls !== undefined);

if (singleScenarios.length > 0) {
    const avgTools = singleScenarios.reduce((s, x) => s + (x.metrics?.toolCallCount || 0), 0) / singleScenarios.length;
    const avgNarration = singleScenarios.reduce((s, x) => s + (x.metrics?.narrationRatio || 0), 0) / singleScenarios.length;
    const avgLatency = singleScenarios.reduce((s, x) => s + (x.metrics?.latencyMs || 0), 0) / singleScenarios.length;
    console.log(`\n${C.bold}单轮指标:${C.reset}`);
    console.log(`  平均工具调用/轮: ${avgTools.toFixed(1)}`);
    console.log(`  平均叙述占比: ${Math.round(avgNarration * 100)}%`);
    console.log(`  平均延迟: ${Math.round(avgLatency)}ms`);
}

if (multiScenarios.length > 0) {
    const avgTotalTools = multiScenarios.reduce((s, x) => s + (x.metrics?.totalToolCalls || 0), 0) / multiScenarios.length;
    const avgTurns = multiScenarios.reduce((s, x) => s + (x.metrics?.turns || 0), 0) / multiScenarios.length;
    console.log(`\n${C.bold}多轮指标:${C.reset}`);
    console.log(`  平均总工具调用: ${avgTotalTools.toFixed(1)}`);
    console.log(`  平均轮数: ${avgTurns.toFixed(1)}`);
}

// 保存结果
const resultData = {
    variant: VARIANT,
    timestamp: new Date().toISOString(),
    model: MODEL,
    scenarios: scenarioResults,
    summary: {
        passed,
        failed: failedCount,
        total,
    },
};

const fs = await import('fs');
const resultFile = `test/prompt-ab-results-${VARIANT}.json`;
fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2));
console.log(`\n${info(`结果已保存: ${resultFile}`)}`);
console.log(info(`对比命令: node test/e2e-prompt-ab.mjs --compare`));
console.log();
