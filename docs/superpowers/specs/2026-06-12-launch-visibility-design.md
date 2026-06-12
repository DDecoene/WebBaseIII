# WebBase-III Launch & Visibility Plan

**Date:** 2026-06-12
**Status:** Approved design
**Goal:** Showcase the project — stars, visitors, attention from the retro-computing and dev communities. Contributors are a welcome side effect, not the primary target.

## Positioning

Nostalgia-first. The hook is recognition ("I grew up with the dot prompt"), the tech is the bonus.

- **Repo description / slogan:**
  > dBASE III is back. In your browser. `USE customers` like it's 1984.
- **Show HN title:**
  > Show HN: I rebuilt dBASE III for the browser (with its own interpreter in TypeScript)
- **README restructure:** demo GIF first, then one nostalgic opening paragraph ("Remember the dot prompt?"), then the "Open in GitHub Codespaces" badge. Feature lists and command tables move below the fold.

## Try-it-now path: GitHub Codespaces

No hosted demo. Instead:

- Add `.devcontainer/devcontainer.json` with `postCreateCommand: npm install`, `postStartCommand`/instructions for `npm run dev`, and forwarded ports 5173 + 3000.
- Add an "Open in GitHub Codespaces" badge near the top of the README.
- One click → personal sandbox → no hosting cost, no shared-server sandboxing concerns.

## Repo readiness checklist (pre-launch)

1. **Slogan** — update GitHub repo description (and `package.json` description).
2. **Demo GIF** — animated terminal session: `USE` → `LIST` → `BROWSE` → `REPORT FORM`. Top of README.
3. **Devcontainer + Codespaces badge** — see above. Verify it actually boots in a real Codespace before launch.
4. **GitHub topics** — `dbase`, `retrocomputing`, `retro`, `typescript`, `sqlite`, `interpreter`, `repl`, `database`, `websocket`, `dbase-iii`.
5. **Social preview image** — set in repo settings; used by HN/Reddit/X link unfurls. 1280×640, slogan + terminal screenshot.
6. **README rewrite** — nostalgia-first opening per Positioning section.
7. **CONTRIBUTING.md** — how to run, test, and submit PRs; link Definition of Done.
8. **Seed issues** — 5–10 real issues, several labeled `good first issue`.
9. **License** — stays AGPL-3.0 unless Dennis explicitly decides otherwise. (Noted: MIT is more conventional for showcase projects and friendlier to casual contributors; open decision, not a blocker.)

## Launch sequence

- **Day 0 — Show HN.** Post Tuesday–Thursday, ~15:00 CET (US morning). Dennis posts from his own account and actively answers comments that day. First comment: a short "why I built this" note with the Codespaces link.
- **Week 1 — Reddit + Mastodon.** Spread posts over days, title adapted per community: r/programming (tech angle), r/vintagecomputing + r/retrobattlestations (nostalgia angle), r/typescript (interpreter angle). Mastodon with #retrocomputing hashtag; X/LinkedIn cross-posts.
- **Week 2 — Blog post.** "Why I rebuilt dBASE III in 2026" on dev.to (or personal blog), telling the story: the dot prompt, W3Script, the interpreter, the Assistant. Links back to the repo; submitted to HN/lobste.rs as a second wave.

## Post-launch

- Respond to issues and PRs fast in the first weeks — maintainer responsiveness is the deciding factor in whether visitors stick around.
- Keep the `good first issue` pool stocked.

## Non-goals

- No hosted public demo server (Codespaces replaces it).
- No paid promotion.
- No commitment to a contributor-focused roadmap; this is showcase-first.

## Success criteria

- Codespaces badge boots a working dev environment in one click.
- README sells the project in the first screenful without scrolling.
- Show HN posted with all checklist items done beforehand.
