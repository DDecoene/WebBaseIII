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
npm test                # Vitest — unit + integration; must be green before any PR
npx playwright test     # E2E — auto-starts the dev server via playwright.config.ts
```

## Branching workflow (important — read this)

WebBase-III uses **GitFlow with milestone-versioned release branches**, so the one
thing that trips people up is the PR base: **you target the active release branch,
not `main`.**

- `main` holds only released, tagged code — it's branch-protected and PRs against it
  can't be merged by contributors.
- All work for a version integrates on that version's **`release/vX.Y.Z`** branch
  (one per GitHub milestone). A [milestone](https://github.com/DDecoene/WebBaseIII/milestones)
  maps 1:1 to its release branch — find the open milestone (e.g. `v1.1.0`) and that's
  your base branch (`release/v1.1.0`).

### Step by step

```bash
# 1. Fork on GitHub, then clone your fork and add upstream
git clone https://github.com/<you>/WebBaseIII.git
cd WebBaseIII
git remote add upstream https://github.com/DDecoene/WebBaseIII.git
git fetch upstream

# 2. Branch off the CURRENT release branch (NOT main)
git checkout -b feature/my-change upstream/release/v1.1.0

# 3. ...make changes + tests, commit...

# 4. Push to your fork
git push -u origin feature/my-change
```

Then open the PR on GitHub and **change the base branch from `main` to
`release/vX.Y.Z`** (the base dropdown defaults to `main` — you must switch it).
Reference the issue with `Refs #N` in the body. Because the PR merges into a
non-default branch, `Closes #N` won't auto-close the issue; the maintainer closes it
on merge.

To keep your branch current (we periodically merge `main` into open release
branches): `git fetch upstream && git merge upstream/release/v1.1.0`.

1. Open an issue first for anything non-trivial, so we can discuss the approach.
2. Keep PRs focused — one feature or fix per PR.
3. Add or update tests for what you change. Bug fixes need a regression test.

## Definition of Done

Your PR is expected to meet the project's
[Definition of Done](CLAUDE.md#definition-of-done). In short:

- **`npm test` and `npx playwright test` both pass.**
- **Every user-facing command/feature ships with a Playwright e2e case** in the same
  PR — a REPL command needs a `tests/*.spec.ts` case that types it and asserts the
  rendered result. Unit coverage alone is not "done."
- **CI gates the merge** — the `unit` and `e2e` jobs must be green on your PR. CI runs
  for fork PRs automatically; the suite needs no secrets.
- **Docs reflect the change** — update `README.md` command tables / feature list,
  `CHANGELOG.md` (Added / Fixed / Changed under the milestone heading), and `CLAUDE.md`
  if architecture changed. Retake screenshots if the UI changed.

## Commit conventions

Use concise, conventional-commit-style messages matching the existing history
(`feat(...)`, `fix(...)`, `test(...)`, `docs: ...`). **Do not add `Co-Authored-By`
trailers or any AI/assistant attribution** — commits are authored solely by you.

## What to work on

Check the [issues](https://github.com/DDecoene/WebBaseIII/issues) — anything labeled `good first issue` is a scoped, beginner-friendly entry point. Issues labeled `help wanted` are up for grabs too.

Have a dBASE III feature you miss that isn't implemented yet? Open an issue and tell us how it worked — first-hand dot-prompt memories are valuable spec material.

## Faithfulness vs. modernity

When in doubt about behavior: dBASE III semantics win for the language (`.T.`/`.F.` output, `SEEK`/`FOUND()` behavior, record pointer rules), and modern conventions win for the platform (unlimited work areas, `alias.field` instead of `alias->field`, SQLite instead of `.dbf` files).

## License

By contributing, you agree your contributions are licensed under [AGPL-3.0](LICENSE.md).
