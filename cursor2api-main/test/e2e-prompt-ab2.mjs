/**
 * test/e2e-prompt-ab2.mjs
 *
 * 第二轮提示词 A/B 测试：
 *   ⑤ 工具结果续行提示 (extractToolResultNatural 尾部)
 *   ② thinkingSuffix (每条用户消息末尾)  
 *   ③ fewShotResponse (few-shot 示例文字)
 *
 * 每个提示词的测试设计侧重于其特定影响面：
 *   - ⑤ 续行提示 → 多轮工具循环中模型是否持续行动
 *   - ② 方向后缀 → 模型是否在每条消息后立即行动
 *   - ③ few-shot → 格式遵循度和叙述风格
 *
 * 用法：
 *   VARIANT=baseline node test/e2e-prompt-ab2.mjs
 *   VARIANT=candidate_x node test/e2e-prompt-ab2.mjs
 *   node test/e2e-prompt-ab2.mjs --compare
 */

const BASE_URL = `http://localhost:${process.env.PORT || 3010}`;
const MODEL = 'claude-sonnet-4-5-20251120';
const MAX_TURNS = 10;
const VARIANT = process.env.VARIANT || 'current';
const COMPARE_MODE = process.argv.includes('--compare');

// ─── 颜色 ───────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', blue: '\x1b[34m', magenta: '\x1b[35m', gray: '\x1b[90m',
};
const ok   = s => `${C.green}✅ ${s}${C.reset}`;
const fail = s => `${C.red}❌ ${s}${C.reset}`;
const warn = s => `${C.yellow}⚠  ${s}${C.reset}`;
const hdr  = s => `\n${C.bold}${C.cyan}━━━ ${s} ━━━${C.reset}`;
const info = s => `  ${C.gray}${s}${C.reset}`;

// ─── 基础工具集 ──────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'Read', description: 'Reads a file.', input_schema: {
            type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'],
        },
    },
    {
        name: 'Write', description: 'Writes a file.', input_schema: {
            type: 'object', properties: {
                file_path: { type: 'string' }, content: { type: 'string' },
            }, required: ['file_path', 'content'],
        },
    },
    {
        name: 'Bash', description: 'Executes a bash command.', input_schema: {
            type: 'object', properties: { command: { type: 'string' } }, required: ['command'],
        },
    },
    {
        name: 'Grep', description: 'Search for patterns in files.', input_schema: {
            type: 'object', properties: {
                pattern: { type: 'string' }, path: { type: 'string' },
            }, required: ['pattern'],
        },
    },
    {
        name: 'LS', description: 'Lists directory contents.', input_schema: {
            type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
        },
    },
    {
        name: 'attempt_completion', description: 'Present the final result.', input_schema: {
            type: 'object', properties: { result: { type: 'string' } }, required: ['result'],
        },
    },
];

// ─── 虚拟文件系统 ────────────────────────────────────────────────────
const MOCK_FS = {
    '/project/package.json': '{"name":"my-app","version":"2.0.0","dependencies":{"express":"^4.18.0","lodash":"^4.17.21"}}',
    '/project/src/index.ts': 'import express from "express";\nimport { router } from "./router";\nconst app = express();\napp.use("/api", router);\napp.listen(3000);\n',
    '/project/src/router.ts': 'import { Router } from "express";\nexport const router = Router();\nrouter.get("/health", (_, res) => res.json({ ok: true }));\nrouter.get("/users", (_, res) => res.json([]));\n// TODO: add POST /users\n',
    '/project/src/utils.ts': 'export function clamp(v: number, min: number, max: number) {\n  return Math.min(Math.max(v, min), max);\n}\n// TODO: add debounce function\n',
    '/project/tsconfig.json': '{"compilerOptions":{"target":"es2020","module":"commonjs","strict":true}}',
    '/project/README.md': '# My App\nExpress API server.\n## API\n- GET /api/health\n- GET /api/users\n',
};

function mockExec(name, input) {
    switch (name) {
        case 'Read': return MOCK_FS[input.file_path] || `Error: File not found: ${input.file_path}`;
        case 'Write': { MOCK_FS[input.file_path] = input.content; return `Wrote ${input.content.length} chars`; }
        case 'Bash': {
            if (input.command?.includes('npm test')) return 'Tests passed: 3/3';
            if (input.command?.includes('tsc')) return 'Compilation successful';
            return `$ ${input.command}\n(ok)`;
        }
        case 'Grep': {
            const results = [];
            for (const [fp, c] of Object.entries(MOCK_FS)) {
                c.split('\n').forEach((line, i) => {
                    if (line.toLowerCase().includes((input.pattern || '').toLowerCase()))
                        results.push(`${fp}:${i + 1}:${line.trim()}`);
                });
            }
            return results.join('\n') || 'No matches.';
        }
        case 'LS': return Object.keys(MOCK_FS).filter(p => p.startsWith(input.path || '/project')).join('\n');
        case 'attempt_completion': return `__DONE__:${input.result}`;
        default: return `Executed ${name}`;
    }
}

// ─── 多轮引擎 ─────────────────────────────────────────────────────
async function runMultiTurn(userMessage, opts = {}) {
    const { tools = TOOLS, systemPrompt = '', toolChoice, maxTurns = MAX_TURNS } = opts;
    const messages = [{ role: 'user', content: userMessage }];
    const system = systemPrompt || 'You are an AI coding assistant. Working directory: /project.';

    let totalToolCalls = 0, totalTextChars = 0, turns = 0;
    let firstTurnToolCount = 0, firstTurnTextLen = 0;
    const toolLog = [];
    let completed = false;
    let stopped = false; // 模型是否中途停止（end_turn but not completed）

    while (turns < maxTurns) {
        turns++;
        const resp = await fetch(`${BASE_URL}/v1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'dummy' },
            body: JSON.stringify({
                model: MODEL, max_tokens: 4096, system, tools,
                ...(toolChoice ? { tool_choice: toolChoice } : {}),
                messages,
            }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const textBlocks = data.content?.filter(b => b.type === 'text') || [];
        const toolUseBlocks = data.content?.filter(b => b.type === 'tool_use') || [];
        const turnText = textBlocks.reduce((s, b) => s + (b.text?.length || 0), 0);
        
        totalTextChars += turnText;
        totalToolCalls += toolUseBlocks.length;

        if (turns === 1) {
            firstTurnToolCount = toolUseBlocks.length;
            firstTurnTextLen = turnText;
        }

        for (const tb of toolUseBlocks) {
            toolLog.push({ turn: turns, tool: tb.name });
        }

        if (data.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
            if (!completed) stopped = true;
            break;
        }

        messages.push({ role: 'assistant', content: data.content });
        const results = toolUseBlocks.map(tb => ({
            type: 'tool_result', tool_use_id: tb.id,
            content: mockExec(tb.name, tb.input),
        }));
        messages.push({ role: 'user', content: results });

        if (results.some(r => r.content.startsWith('__DONE__'))) { completed = true; break; }
    }

    return {
        totalToolCalls, totalTextChars, turns,
        firstTurnToolCount, firstTurnTextLen,
        toolLog, completed, stopped,
        narrationRatio: totalTextChars / Math.max(totalTextChars + totalToolCalls * 100, 1),
        toolPath: toolLog.map(t => `${t.turn}:${t.tool}`).join(' → '),
    };
}

// ─── 测试场景 ─────────────────────────────────────────────────────
const SCENARIOS = [
    // ========= ⑤ 续行提示测试 =========
    {
        id: 'continuation_3step',
        group: '⑤ 续行提示',
        name: '3 步连续任务（不中断）',
        description: '模型必须连续执行 3 步，不能中途停下。测试续行指令是否有效。',
        prompt: 'Step 1: Read /project/src/router.ts. Step 2: Read /project/src/utils.ts. Step 3: After reading both, use attempt_completion to summarize all TODO items found.',
        expect: { minTools: 3, completed: true },
        toolChoice: { type: 'any' },
    },
    {
        id: 'continuation_after_error',
        group: '⑤ 续行提示',
        name: '错误后继续',
        description: '读取不存在的文件→收到错误→应继续尝试其他文件而不是停下。',
        prompt: 'Read /project/src/nonexistent.ts. If it fails, read /project/src/index.ts instead.',
        expect: { minTools: 2 },
    },
    {
        id: 'continuation_long_chain',
        group: '⑤ 续行提示',
        name: '长链任务（≥4 步）',
        description: '测试在 4+ 步工具链中模型是否持续推进。',
        prompt: 'Please do these steps in order: 1) LS /project/src 2) Read /project/src/index.ts 3) Read /project/src/router.ts 4) Grep for "TODO" in /project/src 5) attempt_completion with a summary of all findings.',
        expect: { minTools: 4, completed: true },
        toolChoice: { type: 'any' },
    },

    // ========= ② 方向后缀测试 =========
    {
        id: 'suffix_immediate_action',
        group: '② 方向后缀',
        name: '立即行动（无叙述）',
        description: '简单请求应紧随后缀指示直接行动，而不是先描述计划。',
        prompt: 'Show me the project structure.',
        expect: { firstTurnAction: true, maxFirstTurnText: 100 },
    },
    {
        id: 'suffix_ambiguous_task',
        group: '② 方向后缀',
        name: '模糊任务也行动',
        description: '即使任务稍有模糊，模型也应先行动（读文件）再讨论。',
        prompt: 'Help me understand this project.',
        expect: { firstTurnAction: true },
    },
    {
        id: 'suffix_multi_file',
        group: '② 方向后缀',
        name: '多文件并行',
        description: '方向后缀应让模型在一轮内并行调用多个工具。',
        prompt: 'Read /project/src/index.ts and /project/src/router.ts and /project/tsconfig.json.',
        expect: { firstTurnMinTools: 2 },
    },

    // ========= ③ few-shot 测试 =========
    {
        id: 'fewshot_format',
        group: '③ few-shot',
        name: '输出格式遵循度',
        description: '模型是否严格遵循 ```json action 格式（而不是其他变体）。',
        prompt: 'Read /project/package.json and tell me the project name.',
        expect: { formatCorrect: true, minTools: 1 },
    },
    {
        id: 'fewshot_style_match',
        group: '③ few-shot',
        name: '风格模仿 —— 叙述简洁度',
        description: 'few-shot 样本越简洁，模型的回复也应越简洁。',
        prompt: 'List all TypeScript files in the project.',
        expect: { maxFirstTurnText: 80 },
    },
    {
        id: 'fewshot_no_meta',
        group: '③ few-shot',
        name: '无元叙述',
        description: '模型不应输出类似 "I will use the structured format" 的自我描述。',
        prompt: 'Check if there are any TODO comments in /project/src/utils.ts.',
        expect: { noMetaText: true, minTools: 1 },
    },
];

// ─── 对比模式 ────────────────────────────────────────────────────────
if (COMPARE_MODE) {
    const fs = await import('fs');
    const files = fs.readdirSync('test')
        .filter(f => f.startsWith('prompt-ab2-results-') && f.endsWith('.json'))
        .sort();

    if (files.length < 2) {
        console.log(`\n${fail('需要至少 2 个结果文件。')}`);
        process.exit(1);
    }

    const results = files.map(f => ({ file: f, ...JSON.parse(fs.readFileSync(`test/${f}`, 'utf-8')) }));

    console.log(`\n${C.bold}${C.magenta}══ 第二轮提示词 A/B 对比 ══${C.reset}\n`);
    results.forEach(r => console.log(`  ${C.cyan}${r.variant}${C.reset} — ${r.timestamp}`));

    // 按 group 分组输出
    const groups = [...new Set(SCENARIOS.map(s => s.group))];
    for (const group of groups) {
        console.log(hdr(group));
        const groupScenarios = SCENARIOS.filter(s => s.group === group);

        console.log(`${'─'.repeat(120)}`);
        const headerParts = [`${'场景'.padEnd(28)}`];
        for (const r of results) headerParts.push(r.variant.padEnd(25));
        console.log(`${C.bold}${headerParts.join('')}${C.reset}`);
        console.log(`${'─'.repeat(120)}`);

        for (const sc of groupScenarios) {
            const row = [sc.id.padEnd(28)];
            for (const r of results) {
                const s = r.scenarios.find(x => x.id === sc.id);
                if (!s) { row.push('N/A'.padEnd(25)); continue; }
                const m = s.metrics;
                const emoji = s.passed ? '✅' : '❌';
                const brief = m
                    ? `${emoji} T:${m.totalToolCalls} N:${Math.round((m.narrationRatio || 0) * 100)}% ${m.turns}轮`
                    : '❌ ERR';
                row.push(brief.padEnd(25));
            }
            console.log(row.join(''));
        }
    }

    // 汇总
    console.log(`\n${C.bold}汇总:${C.reset}`);
    for (const r of results) {
        const pass = r.scenarios.filter(s => s.passed).length;
        const avgNarr = r.scenarios.reduce((s, x) => s + (x.metrics?.narrationRatio || 0), 0) / r.scenarios.length;
        const totalTools = r.scenarios.reduce((s, x) => s + (x.metrics?.totalToolCalls || 0), 0);
        const completions = r.scenarios.filter(s => s.metrics?.completed).length;
        console.log(`  ${C.cyan}${r.variant}${C.reset}: ${pass}/${r.scenarios.length}通过  工具:${totalTools}  叙述:${Math.round(avgNarr * 100)}%  完成:${completions}`);
    }
    process.exit(0);
}

// ─── 主测试流程 ────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.magenta}  第二轮提示词 A/B 测试${C.reset}`);
console.log(info(`VARIANT=${VARIANT}  MODEL=${MODEL}`));

try {
    const r = await fetch(`${BASE_URL}/v1/models`, { headers: { 'x-api-key': 'dummy' } });
    if (!r.ok) throw new Error();
    console.log(`\n${ok('服务器在线')}`);
} catch { console.log(`\n${fail('服务器未运行')}`); process.exit(1); }

const scenarioResults = [];
let passed = 0, failedCount = 0;
let currentGroup = '';

for (const sc of SCENARIOS) {
    if (sc.group !== currentGroup) {
        currentGroup = sc.group;
        console.log(hdr(currentGroup));
    }
    process.stdout.write(`  ${C.blue}▶${C.reset} ${C.bold}${sc.name}${C.reset}\n`);
    console.log(info(sc.description));

    const t0 = Date.now();
    try {
        const r = await runMultiTurn(sc.prompt, { toolChoice: sc.toolChoice });

        let testPassed = true;
        const failReasons = [];

        // 检查期望
        if (sc.expect.minTools && r.totalToolCalls < sc.expect.minTools) {
            testPassed = false; failReasons.push(`工具调用 ${r.totalToolCalls} < ${sc.expect.minTools}`);
        }
        if (sc.expect.completed && !r.completed) {
            testPassed = false; failReasons.push('任务未完成（未调用 attempt_completion）');
        }
        if (sc.expect.firstTurnAction && r.firstTurnToolCount === 0) {
            testPassed = false; failReasons.push('第一轮无工具调用');
        }
        if (sc.expect.maxFirstTurnText && r.firstTurnTextLen > sc.expect.maxFirstTurnText) {
            failReasons.push(`首轮文本 ${r.firstTurnTextLen} > ${sc.expect.maxFirstTurnText} (警告)`);
        }
        if (sc.expect.firstTurnMinTools && r.firstTurnToolCount < sc.expect.firstTurnMinTools) {
            testPassed = false; failReasons.push(`首轮工具 ${r.firstTurnToolCount} < ${sc.expect.firstTurnMinTools}`);
        }
        if (sc.expect.formatCorrect !== undefined && sc.expect.formatCorrect && r.totalToolCalls === 0) {
            testPassed = false; failReasons.push('无工具调用（无法验证格式）');
        }

        console.log(info(`  工具: ${r.totalToolCalls}  轮数: ${r.turns}  文本: ${r.totalTextChars}chars  叙述: ${Math.round(r.narrationRatio * 100)}%  完成: ${r.completed ? '✅' : '❌'}`));
        console.log(info(`  链: ${r.toolPath}`));

        const ms = ((Date.now() - t0) / 1000).toFixed(1);
        if (testPassed && failReasons.length === 0) {
            console.log(`  ${ok('通过')} (${ms}s)`);
            passed++;
        } else if (testPassed) {
            console.log(`  ${ok('通过')} (${ms}s) — ${failReasons.join(', ')}`);
            passed++;
        } else {
            console.log(`  ${fail('未通过')} (${ms}s)`);
            failReasons.forEach(r2 => console.log(`    ${C.yellow}→ ${r2}${C.reset}`));
            failedCount++;
        }

        scenarioResults.push({ id: sc.id, name: sc.name, group: sc.group, passed: testPassed, failReasons, metrics: r });
    } catch (err) {
        console.log(`  ${fail('错误')}: ${err.message}`);
        failedCount++;
        scenarioResults.push({ id: sc.id, name: sc.name, group: sc.group, passed: false, failReasons: [err.message], metrics: null });
    }
}

const total = passed + failedCount;
console.log(`\n${'═'.repeat(62)}`);
console.log(`${C.bold}  [${VARIANT}] 结果: ${C.green}${passed} 通过${C.reset}${C.bold} / ${failedCount > 0 ? C.red : ''}${failedCount} 未通过${C.reset}${C.bold} / ${total} 场景${C.reset}`);
console.log('═'.repeat(62));

const fs = await import('fs');
const out = { variant: VARIANT, timestamp: new Date().toISOString(), model: MODEL, scenarios: scenarioResults, summary: { passed, failed: failedCount, total } };
const outFile = `test/prompt-ab2-results-${VARIANT}.json`;
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`\n${info(`已保存: ${outFile}`)}`);
console.log(info('对比: node test/e2e-prompt-ab2.mjs --compare'));
console.log();
