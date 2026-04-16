$env:ANTHROPIC_BASE_URL = "http://localhost:9015"
$env:ANTHROPIC_AUTH_TOKEN = "liumiao"
$env:ANTHROPIC_MODEL = "bytedance-seed/dola-seed-2.0-pro:free"
$env:CLAUDE_CODE_SIMPLE = "1"
bun --smol --env-file=.env ./src/entrypoints/cli.tsx
