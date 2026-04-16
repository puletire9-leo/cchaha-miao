/**
 * 端到端测试：向真实 Cursor2API 服务发送请求
 * 
 * 测试场景：
 * 1. 简单请求能正常返回
 * 2. 带工具的多轮长对话触发压缩
 * 3. 验证 stop_reason 正确
 */

const API_URL = 'http://localhost:3010/v1/messages';

interface TestResult {
    name: string;
    passed: boolean;
    detail: string;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, detail = '') {
    results.push({ name, passed: condition, detail });
    console.log(condition ? `  ✅ ${name}` : `  ❌ ${name}: ${detail}`);
}

// 构造一个模拟 Claude Code 的长对话请求（带很多轮工具交互历史）
function buildLongToolRequest(turnCount: number) {
    const messages: any[] = [];
    
    // 模拟多轮工具交互历史
    for (let i = 0; i < turnCount; i++) {
        if (i === 0) {
            // 第一轮：用户发起请求
            messages.push({
                role: 'user',
                content: 'Help me analyze the project structure. Read the main entry file first.'
            });
        } else {
            // 工具结果
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: `tool_${i}`,
                        content: `File content of module${i}.ts:\n` + 
                            `import { something } from './utils';\n\n` +
                            `export class Module${i} {\n` +
                            Array.from({length: 30}, (_, j) => `    method${j}() { return ${j}; }`).join('\n') +
                            `\n}\n`
                    }
                ]
            });
        }

        // 助手的工具调用
        messages.push({
            role: 'assistant',
            content: [
                { type: 'text', text: `Let me check module${i + 1}.` },
                {
                    type: 'tool_use',
                    id: `tool_${i + 1}`,
                    name: 'Read',
                    input: { file_path: `src/module${i + 1}.ts` }
                }
            ]
        });
    }

    // 最后一轮工具结果
    messages.push({
        role: 'user',
        content: [
            {
                type: 'tool_result',
                tool_use_id: `tool_${turnCount}`,
                content: 'File not found: src/module' + turnCount + '.ts'
            }
        ]
    });

    return {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        stream: false,
        system: 'You are a helpful coding assistant.',
        tools: [
            {
                name: 'Read',
                description: 'Read a file from disk',
                input_schema: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string', description: 'Path to the file' }
                    },
                    required: ['file_path']
                }
            },
            {
                name: 'Bash',
                description: 'Execute a shell command',
                input_schema: {
                    type: 'object',
                    properties: {
                        command: { type: 'string', description: 'The command to execute' }
                    },
                    required: ['command']
                }
            }
        ],
        messages
    };
}

async function runTests() {
    console.log('\n=== 测试 1：基本请求 ===');
    try {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                stream: false,
                messages: [{ role: 'user', content: 'Say "hello" in one word.' }]
            })
        });
        assert('服务器响应', resp.ok, `status=${resp.status}`);
        const data = await resp.json();
        assert('返回 message 类型', data.type === 'message', `type=${data.type}`);
        assert('stop_reason 是 end_turn', data.stop_reason === 'end_turn', `stop_reason=${data.stop_reason}`);
        assert('有 content', data.content?.length > 0, `content=${JSON.stringify(data.content)}`);
        console.log(`  📝 响应: ${data.content?.[0]?.text?.substring(0, 100)}`);
    } catch (e: any) {
        assert('基本请求', false, e.message);
    }

    console.log('\n=== 测试 2：长对话工具请求（触发压缩）===');
    try {
        const longReq = buildLongToolRequest(18); // 18 轮 → 37 条消息
        console.log(`  📊 发送 ${longReq.messages.length} 条消息...`);
        
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
            body: JSON.stringify(longReq)
        });
        assert('长对话服务器响应', resp.ok, `status=${resp.status}`);
        const data = await resp.json();
        assert('长对话返回 message', data.type === 'message', `type=${data.type}`);
        assert('长对话有 content', data.content?.length > 0);
        
        // 检查 stop_reason
        const validStops = ['end_turn', 'tool_use', 'max_tokens'];
        assert('stop_reason 合法', validStops.includes(data.stop_reason), `stop_reason=${data.stop_reason}`);
        
        console.log(`  📝 stop_reason: ${data.stop_reason}`);
        console.log(`  📝 content blocks: ${data.content?.length}`);
        if (data.content?.[0]?.text) {
            console.log(`  📝 响应片段: ${data.content[0].text.substring(0, 150)}...`);
        }
    } catch (e: any) {
        assert('长对话请求', false, e.message);
    }

    console.log('\n=== 测试 3：流式请求 ===');
    try {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                stream: true,
                messages: [{ role: 'user', content: 'Say "world" in one word.' }]
            })
        });
        assert('流式响应 200', resp.ok, `status=${resp.status}`);
        assert('Content-Type 是 SSE', resp.headers.get('content-type')?.includes('text/event-stream') ?? false);
        
        const body = await resp.text();
        const events = body.split('\n').filter(l => l.startsWith('event:'));
        assert('有 SSE 事件', events.length > 0, `events=${events.length}`);
        assert('包含 message_start', body.includes('message_start'));
        assert('包含 message_stop', body.includes('message_stop'));
        
        // 检查 stop_reason
        const deltaMatch = body.match(/"stop_reason"\s*:\s*"([^"]+)"/);
        if (deltaMatch) {
            assert('流式 stop_reason 合法', ['end_turn', 'tool_use', 'max_tokens'].includes(deltaMatch[1]), `stop_reason=${deltaMatch[1]}`);
        }
        console.log(`  📝 SSE 事件数: ${events.length}`);
    } catch (e: any) {
        assert('流式请求', false, e.message);
    }

    // 总结
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`\n=== 端到端结果: ${passed} 通过, ${failed} 失败 ===\n`);
}

runTests().catch(console.error);
