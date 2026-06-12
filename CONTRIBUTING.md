# Contributing to WebBase-III

Thanks for your interest! Whether you used dBASE III in 1986 or just discovered the dot prompt yesterday — contributions are welcome.

## Getting started

```bash
git clone https://github.com/DDecoene/WebBaseIII.git
cd WebBaseIII
npm install
npm run dev        # browser at http://localhost:5173, WS server on :3000
```

Or skip all of that and [open a Codespace](https://codespaces.new/DDecoene/WebBaseIII?quickstart=1) — it installs and starts everything automatically.

## Project layout

- `server/` — Node.js WebSocket server, SQLite bridge, program/index/report stores
- `src/interpreter/` — the W3Script lexer, parser, and executor
- `src/terminal/`, `src/ui/` — REPL, BROWSE grid, form engine, Assistant sidebar, wizards
- `demos/*.prg` — demo programs, seeded into the store on every server start
- `tests/` — Vitest unit/integration tests and Playwright E2E specs

See [CLAUDE.md](CLAUDE.md) for the full architecture overview and W3Script command reference.

## Running tests

```bash
npm test                # Vitest — must be green before any PR
npx playwright test     # E2E — requires the dev server running on :5173/:3000
```

## Making changes

1. Open an issue first for anything non-trivial, so we can discuss the approach.
2. Fork, branch, and keep PRs focused — one feature or fix per PR.
3. Add or update tests for what you change. Bug fixes need a regression test.
4. Run `npm test` and make sure it passes.
5. Update docs that your change makes stale: `README.md` command tables, `CHANGELOG.md` (Added / Fixed / Changed), and `CLAUDE.md` if architecture changed.

## What to work on

Check the [issues](https://github.com/DDecoene/WebBaseIII/issues) — anything labeled `good first issue` is a scoped, beginner-friendly entry point. Issues labeled `help wanted` are up for grabs too.

Have a dBASE III feature you miss that isn't implemented yet? Open an issue and tell us how it worked — first-hand dot-prompt memories are valuable spec material.

## Faithfulness vs. modernity

When in doubt about behavior: dBASE III semantics win for the language (`.T.`/`.F.` output, `SEEK`/`FOUND()` behavior, record pointer rules), and modern conventions win for the platform (unlimited work areas, `alias.field` instead of `alias->field`, SQLite instead of `.dbf` files).

## License

By contributing, you agree your contributions are licensed under [AGPL-3.0](LICENSE.md).
