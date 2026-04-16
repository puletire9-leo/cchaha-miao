import { shouldAutoContinueTruncatedToolResponse } from '../dist/handler.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  OK ${name}`);
        passed++;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  FAIL ${name}`);
        console.error(`      ${message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
}

console.log('\nhandler continuation detection\n');

test('short-argument Read tool can be recovered without continuation', () => {
    const text = [
        'I will read the config first.',
        '',
        '```json action',
        '{',
        '  "tool": "Read",',
        '  "parameters": {',
        '    "file_path": "/app/config.yaml"',
        '  }',
    ].join('\n');

    assertEqual(
        shouldAutoContinueTruncatedToolResponse(text, true),
        false,
        'Read-like short tool calls should not force continuation',
    );
});

test('large Write payload still needs continuation when the action block is unclosed', () => {
    const longContent = 'A'.repeat(4000);
    const text = [
        '```json action',
        '{',
        '  "tool": "Write",',
        '  "parameters": {',
        '    "file_path": "/tmp/large.txt",',
        `    "content": "${longContent}`,
    ].join('\n');

    assertEqual(
        shouldAutoContinueTruncatedToolResponse(text, true),
        true,
        'Large Write payloads should continue until parameters are complete',
    );
});

test('short non-action code block truncation should not continue', () => {
    const text = '```ts\nexport const answer = {';

    assertEqual(
        shouldAutoContinueTruncatedToolResponse(text, true),
        false,
        'Very short non-action code blocks should not trigger continuation',
    );
});

test('an unclosed json action block still continues even when very short', () => {
    const text = '```json action\n{\n  "tool": "Write",';

    assertEqual(
        shouldAutoContinueTruncatedToolResponse(text, true),
        true,
        'Unclosed json action blocks should always continue',
    );
});

test('a closed large Write that ends on a dangling table row should continue', () => {
    const content = 'A'.repeat(1800) + '\n' + [
        '# Summary',
        '',
        '## API',
        '',
        '| Path | Method | Notes |',
        '|------|--------|-------|',
        '| /v1/messages | POST | Anthropic Messages API |',
        '| /v1/models | GET | Model list |',
        '|',
    ].join('\n');

    const text = [
        '```json action',
        '{',
        '  "tool": "Write",',
        '  "parameters": {',
        '    "file_path": "/tmp/summary.md",',
        `    "content": ${JSON.stringify(content)}`,
        '  }',
        '}',
        '```',
    ].join('\n');

    assertEqual(
        shouldAutoContinueTruncatedToolResponse(text, true),
        true,
        'Large closed Write payloads that clearly stop mid-structure should continue',
    );
});

test('a closed large Write with a clean ending should not continue', () => {
    const content = [
        '# Summary',
        '',
        '## API',
        '',
        '| Path | Method | Notes |',
        '|------|--------|-------|',
        '| /v1/messages | POST | Anthropic Messages API |',
        '| /v1/models | GET | Model list |',
        '',
        '## References',
        '',
        '- README.md',
        '- CHANGELOG.md',
        '',
        'Completed.',
    ].join('\n') + '\n' + 'A'.repeat(1800) + '\nDone.\n';

    const text = [
        '```json action',
        '{',
        '  "tool": "Write",',
        '  "parameters": {',
        '    "file_path": "/tmp/summary.md",',
        `    "content": ${JSON.stringify(content)}`,
        '  }',
        '}',
        '```',
    ].join('\n');

    assertEqual(
        shouldAutoContinueTruncatedToolResponse(text, true),
        false,
        'Large closed Write payloads with a clean ending should not be misclassified',
    );
});

console.log(`\nresult: ${passed} passed / ${failed} failed / ${passed + failed} total\n`);

if (failed > 0) process.exit(1);
