/**
 * Stealth Proxy - 通过无头浏览器绕过 Vercel Bot Protection
 *
 * 架构：
 *   客户端 → cursor2api → stealth-proxy → (Chrome浏览器上下文) → cursor.com/api/chat
 *
 * 原理：
 *   1. 启动时用 stealth 浏览器访问 cursor.com，通过 JS Challenge 获取 _vcrcs cookie
 *   2. 在同一浏览器上下文内通过 page.evaluate(fetch) 代理 API 请求
 *   3. 定时刷新 challenge（_vcrcs 有效期 3600s，每 50 分钟刷新）
 *   4. 支持 SSE 流式响应透传
 */

const express = require('express');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3011');
const CHALLENGE_URL = process.env.CHALLENGE_URL || 'https://cursor.com/cn/docs';
const REFRESH_INTERVAL = parseInt(process.env.REFRESH_INTERVAL || '3000000'); // 50 分钟
const CHALLENGE_WAIT = parseInt(process.env.CHALLENGE_WAIT || '55000'); // challenge 最长等待时间

let browser, context, challengePage, workerPage;
let ready = false;
let startTime = Date.now();
let challengeCount = 0;
let requestCount = 0;

const pendingRequests = new Map();

// ==================== 浏览器管理 ====================

const fs = require('fs');

// 自动检测系统 Chrome 路径（优先使用，指纹更真实）
function findSystemChrome() {
    const paths = [
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        // Linux
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        // Windows
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function loadStealth() {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());
    return chromium;
}

async function initBrowser() {
    const chromium = await loadStealth();
    const chromePath = findSystemChrome();

    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    };

    if (chromePath) {
        launchOptions.executablePath = chromePath;
        console.log(`[Stealth] Using system Chrome: ${chromePath}`);
    } else {
        console.log('[Stealth] System Chrome not found, using Playwright Chromium');
    }

    console.log('[Stealth] Launching browser...');
    browser = await chromium.launch(launchOptions);

    context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        locale: 'zh-CN',
        viewport: { width: 1920, height: 1080 },
    });

    // ---- Challenge 页面：获取 _vcrcs ----
    challengePage = await context.newPage();
    console.log(`[Stealth] Passing Vercel challenge: ${CHALLENGE_URL}`);
    await challengePage.goto(CHALLENGE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });

    // 模拟人类行为，帮助通过 bot 检测
    await simulateHumanBehavior(challengePage);

    // 等待 cookie（challenge JS 会异步设置 _vcrcs）
    const ok = await waitForCookie();
    if (!ok) {
        // 重试：刷新页面 + 再次模拟行为
        console.log('[Stealth] First attempt failed, retrying challenge...');
        await challengePage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await simulateHumanBehavior(challengePage);
        const retryOk = await waitForCookie();
        if (!retryOk) {
            throw new Error('Failed to obtain _vcrcs cookie after retry');
        }
    }
    challengeCount++;

    // ---- Worker 页面：代理 API 请求 ----
    // cookie 已在 challenge 页面获取，worker 页面只需加载到 domcontentloaded 即可
    workerPage = await context.newPage();
    await workerPage.goto(CHALLENGE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });

    // 注册流式回调（Node.js 侧接收浏览器内 fetch 的数据块）
    await workerPage.exposeFunction(
        '__proxyCallback',
        (requestId, type, data) => {
            const pending = pendingRequests.get(requestId);
            if (!pending) return;

            switch (type) {
                case 'headers': {
                    const { status, contentType } = JSON.parse(data);
                    const headers = {
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                    };
                    if (contentType) headers['Content-Type'] = contentType;
                    pending.res.writeHead(status, headers);
                    break;
                }
                case 'chunk':
                    pending.res.write(data);
                    break;
                case 'end':
                    pending.res.end();
                    pending.resolve();
                    break;
                case 'error':
                    if (!pending.res.headersSent) {
                        pending.res.writeHead(502, {
                            'Content-Type': 'application/json',
                        });
                    }
                    pending.res.end(
                        JSON.stringify({ error: { message: data } }),
                    );
                    pending.resolve();
                    break;
            }
        },
    );

    ready = true;
    console.log('[Stealth] Ready! Accepting proxy requests.');
}

async function waitForCookie(maxWait) {
    maxWait = maxWait || CHALLENGE_WAIT;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        const cookies = await context.cookies();
        const vcrcs = cookies.find((c) => c.name === '_vcrcs');
        if (vcrcs) {
            console.log(
                '[Stealth] _vcrcs obtained:',
                vcrcs.value.substring(0, 40) + '...',
            );
            return true;
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    console.error('[Stealth] Failed to obtain _vcrcs within timeout');
    return false;
}

// 模拟人类行为：鼠标移动、点击、滚动，帮助通过 Vercel bot 检测
async function simulateHumanBehavior(page) {
    try {
        // 随机延迟
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

        // 模拟鼠标移动轨迹（多个随机点）
        const points = Array.from({ length: 5 }, () => ({
            x: 100 + Math.random() * 600,
            y: 100 + Math.random() * 400,
        }));
        for (const p of points) {
            await page.mouse.move(p.x, p.y, { steps: 5 + Math.floor(Math.random() * 10) });
            await new Promise(r => setTimeout(r, 100 + Math.random() * 300));
        }

        // 模拟滚动
        await page.mouse.wheel(0, 100 + Math.random() * 200);
        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
        await page.mouse.wheel(0, -(50 + Math.random() * 100));

        // 模拟点击页面空白区域
        await page.mouse.click(300 + Math.random() * 400, 300 + Math.random() * 200);
        await new Promise(r => setTimeout(r, 200 + Math.random() * 500));

        console.log('[Stealth] Human behavior simulation done');
    } catch (e) {
        // 模拟行为失败不影响主流程
        console.log('[Stealth] Human simulation skipped:', e.message);
    }
}

async function refreshChallenge() {
    console.log('[Stealth] Refreshing challenge...');
    try {
        await challengePage.goto(CHALLENGE_URL, {
            waitUntil: 'networkidle',
            timeout: 30000,
        });
        const ok = await waitForCookie();
        if (ok) {
            challengeCount++;
            console.log(
                `[Stealth] Challenge refreshed (total: ${challengeCount})`,
            );
        } else {
            console.error('[Stealth] Challenge refresh failed - cookie not obtained');
        }
    } catch (e) {
        console.error('[Stealth] Challenge refresh error:', e.message);
    }
}

async function restartBrowser() {
    console.log('[Stealth] Restarting browser...');
    ready = false;
    try {
        if (browser) await browser.close().catch(() => {});
    } catch (_) {}
    browser = null;
    context = null;
    challengePage = null;
    workerPage = null;
    await initBrowser();
}

// ==================== HTTP 服务 ====================

const app = express();
app.use(express.json({ limit: '10mb' }));

// 健康检查
app.get('/health', async (_req, res) => {
    let cookie = null;
    if (context) {
        const cookies = await context.cookies().catch(() => []);
        const vcrcs = cookies.find((c) => c.name === '_vcrcs');
        if (vcrcs) cookie = vcrcs.value.substring(0, 40) + '...';
    }
    res.json({
        status: ready ? 'ok' : 'initializing',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        challengeCount,
        requestCount,
        cookie,
    });
});

// 代理请求
app.post('/proxy/chat', async (req, res) => {
    if (!ready) {
        res.status(503).json({
            error: { message: 'Stealth proxy not ready, please wait' },
        });
        return;
    }

    const requestId = crypto.randomUUID();
    requestCount++;

    // 客户端断开时清理
    let aborted = false;
    req.on('close', () => {
        aborted = true;
    });

    const promise = new Promise((resolve) => {
        pendingRequests.set(requestId, { res, resolve });
    });

    // 在浏览器上下文内发起 fetch 并流式回传
    workerPage
        .evaluate(
            async ({ body, requestId }) => {
                try {
                    const r = await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });

                    await window.__proxyCallback(
                        requestId,
                        'headers',
                        JSON.stringify({
                            status: r.status,
                            contentType: r.headers.get('content-type'),
                        }),
                    );

                    if (!r.body) {
                        const text = await r.text();
                        if (text)
                            await window.__proxyCallback(
                                requestId,
                                'chunk',
                                text,
                            );
                        await window.__proxyCallback(requestId, 'end', '');
                        return;
                    }

                    const reader = r.body.getReader();
                    const decoder = new TextDecoder();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        if (chunk)
                            await window.__proxyCallback(
                                requestId,
                                'chunk',
                                chunk,
                            );
                    }
                    await window.__proxyCallback(requestId, 'end', '');
                } catch (e) {
                    await window.__proxyCallback(
                        requestId,
                        'error',
                        e.message || 'Browser fetch failed',
                    );
                }
            },
            { body: req.body, requestId },
        )
        .catch((err) => {
            const pending = pendingRequests.get(requestId);
            if (pending && !pending.res.headersSent) {
                pending.res.writeHead(502, {
                    'Content-Type': 'application/json',
                });
                pending.res.end(
                    JSON.stringify({
                        error: {
                            message: 'Browser evaluate failed: ' + err.message,
                        },
                    }),
                );
                pending.resolve();
            }
        });

    await promise;
    pendingRequests.delete(requestId);
});

// ==================== 启动 ====================

const MAX_INIT_RETRIES = parseInt(process.env.MAX_INIT_RETRIES || '5');

(async () => {
    // 自动重试启动：网络不稳定时多试几次
    for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
        try {
            console.log(`[Stealth] Initialization attempt ${attempt}/${MAX_INIT_RETRIES}...`);
            await initBrowser();
            break; // 成功，跳出重试循环
        } catch (e) {
            console.error(`[Stealth] Attempt ${attempt} failed:`, e.message);
            // 清理失败的浏览器实例
            if (browser) await browser.close().catch(() => {});
            browser = null; context = null; challengePage = null; workerPage = null;

            if (attempt >= MAX_INIT_RETRIES) {
                console.error(`[Stealth] All ${MAX_INIT_RETRIES} attempts failed, exiting.`);
                process.exit(1);
            }
            const delay = attempt * 5;
            console.log(`[Stealth] Retrying in ${delay}s...`);
            await new Promise(r => setTimeout(r, delay * 1000));
        }
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Stealth] Proxy listening on port ${PORT}`);
    });

    // 定时刷新 challenge
    setInterval(refreshChallenge, REFRESH_INTERVAL);

    // 浏览器崩溃恢复
    browser.on('disconnected', () => {
        console.error('[Stealth] Browser disconnected! Restarting...');
        ready = false;
        setTimeout(restartBrowser, 3000);
    });
})();

// 优雅退出
const shutdown = async () => {
    console.log('[Stealth] Shutting down...');
    ready = false;
    if (browser) await browser.close().catch(() => {});
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
