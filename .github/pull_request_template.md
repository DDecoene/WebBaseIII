<!--
  Base branch: target the active release branch (release/vX.Y.Z), NOT main.
  See CONTRIBUTING.md. GitHub defaults the base to main — change it.
-->

## Summary

<!-- What does this change and why? -->

Refs #<!-- issue number -->

## Checklist (Definition of Done)

- [ ] PR base is the active **`release/vX.Y.Z`** branch (not `main`)
- [ ] `npm test` (Vitest) passes
- [ ] `npx playwright test` passes — includes a Playwright e2e case for any user-facing command/feature
- [ ] Docs updated as relevant: `README.md`, `CHANGELOG.md` (under the milestone heading), `CLAUDE.md`
- [ ] Screenshots retaken if the UI changed
- [ ] No `Co-Authored-By` / AI attribution in commits
