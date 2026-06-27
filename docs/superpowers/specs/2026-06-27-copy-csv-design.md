# `COPY TO` / `APPEND FROM` — CSV import/export design

Date: 2026-06-27
Issue: [#5](https://github.com/DDecoene/WebBaseIII/issues/5)
Milestone: v1.0.0 — feature-complete
Branch: `feature/copy-csv` (off `release/v1.0.0`)

## Goal

Move data in and out of WebBase-III tables via CSV — `COPY TO <file>.csv` exports
the current table (browser download), `APPEND FROM <file>.csv` bulk-imports a CSV
(browser file picker). Makes the toy actually useful for real data interchange.

## Deliberate deviation from dBASE III (must be documented to users)

dBASE III's `COPY TO`/`APPEND FROM` used **headerless, positional** `DELIMITED`
(comma, char fields quoted) or `SDF` (fixed-width) formats, mapping fields by
position against the open table's structure, with lenient coercion (bad → blank/0,
never abort).

WebBase-III **modernizes** this: **header-based CSV (RFC-4180)**, columns mapped by
**name**, not position. This is more useful for interop with spreadsheets and
modern tooling — which is the issue's stated intent ("APPEND FROM needs
header-to-column mapping"). We keep dBASE's lenient *spirit* (tolerate a few bad
rows) but bound it. **This deviation is surfaced to users in README, in-app HELP,
and CHANGELOG.**

## Decisions

| Decision | Choice |
|---|---|
| File transport | Browser download (export) / file picker upload (import). No server disk (project convention). |
| Format | RFC-4180 CSV with a header row of column names. |
| Import mapping | By header name, case-insensitive. Extra CSV columns ignored; missing columns → NULL. |
| Type coercion | Per column SQLite affinity: numeric → `Number()`; else text. Empty string → NULL. |
| Bad rows (≤10) | Skip; commit the good rows; report each skip with line number + reason. |
| Bad rows (>10) | Abort the whole import and roll back (transaction); 0 rows appended; report first 10 + total. |
| Import size cap | 5 MB. Enforced browser-side (before read) and server-side (on receipt). |
| Export row cap | 50,000 rows; over that, error and suggest `SET FILTER`. |
| Export ordering | Honors active `SET FILTER` and active index order. |

## Architecture & components

### `src/shared/csv.ts` (new) — pure CSV codec

Dependency-free, fully unit-testable in isolation.

```ts
// Serialize rows (in column order) to RFC-4180 CSV text with a header row.
export function toCSV(columns: string[], rows: Record<string, unknown>[]): string;

// Parse CSV text into a header array + array of string-cell rows.
// Tolerates CRLF/LF; handles quoted fields with embedded commas/quotes/newlines.
export function parseCSV(text: string): { header: string[]; rows: string[][] };
```

Quoting rule (write): a field is wrapped in `"` if it contains `,`, `"`, `\n`, or
`\r`; embedded `"` is doubled. Null/undefined → empty field.

### WS messages (`src/shared/types.ts`)

Server → client:
- `{ type: 'csv-download'; filename: string; content: string }` — browser builds a
  `Blob` and triggers a download.
- `{ type: 'csv-upload-open'; table: string; filename: string }` — browser opens a
  file picker for the user to choose the CSV.

Client → server:
- `{ type: 'csv-upload'; filename: string; content: string }` — the chosen file's
  text, sent back for import into the (still-active) table.

### Parser (`src/interpreter/Parser.ts`)

- `COPY TO <file>` → `{ type: 'COPY_TO'; file: string }`
- `APPEND FROM <file>` → `{ type: 'APPEND_FROM'; file: string }`

`COPY`/`APPEND`/`TO`/`FROM` keywords: `APPEND` and `TO` already exist; add `COPY`
and `FROM` to the lexer keyword set. `APPEND` parsing must branch: `APPEND FROM
<file>` vs the existing `APPEND [RECORD|BLANK]`.

### Executor (`src/interpreter/Executor.ts`)

- `doCopyTo(file)`: `requireTable()`; fetch filtered + index-ordered rows via the
  existing ordered-row path; error if count > 50,000 (suggest `SET FILTER`); build
  CSV with `toCSV(columns, rows)`; return an action that makes `Session` emit
  `csv-download`. Filename: the `<file>` arg (ensure `.csv` suffix).
- `doAppendFrom(file)`: `requireTable()`; return an action that makes `Session`
  emit `csv-upload-open`. The actual insert happens when the matching `csv-upload`
  message arrives.

Because import is a two-phase round-trip (command → picker → upload), the insert
logic lives where the `csv-upload` message is handled (`Session`), calling a
shared Executor method `importCSV(content): { appended; skipped: SkipDetail[];
aborted }`.

### Import algorithm (`importCSV`)

1. Enforce size cap (server-side): `Buffer.byteLength(content, 'utf8')` ≤ 5 MB
   (5 × 1024 × 1024), else error. Browser-side uses `file.size` (already bytes).
2. `parseCSV(content)`; resolve header→column map (case-insensitive) against the
   active table's structure. Unknown CSV headers are dropped from the map.
3. For each data row, validate: field count must equal header length (else skip,
   reason "expected N fields, got M"); coerce each mapped value to its column type
   (numeric coercion failure → skip, reason `column "x" — "v" is not numeric`).
4. Collect skips. If `skips.length > 10`: roll back, return `aborted: true` with the
   first 10 details + total. Else: insert the good rows in one transaction, commit,
   return `appended` count + skip details.
5. Inserts are parameterized (`INSERT INTO t (cols…) VALUES (?…)`), wrapped in a
   bridge transaction so abort = clean rollback.

The bridge gains a minimal transaction helper (or `importCSV` brackets the inserts
with `BEGIN`/`COMMIT`/`ROLLBACK` via `exec`).

### Browser (`src/terminal/Terminal.ts`, `src/ws/WsClient.ts`)

- `csv-download`: create `Blob([content], {type:'text/csv'})`, `URL.createObjectURL`,
  a transient `<a download=filename>`, click, revoke.
- `csv-upload-open`: a hidden `<input type=file accept=".csv,text/csv">`; on change,
  check `file.size` ≤ 5 MB (else print error, no upload), `FileReader.readAsText`,
  send `{ type:'csv-upload', filename, content }`.

## Output examples

```
. COPY TO orders.csv
48 record(s) copied to orders.csv.

. APPEND FROM orders.csv
Appended 46 record(s) from orders.csv.
** Skipped 2 row(s):
   line 6:  expected 4 fields, got 3
   line 19: column "amount" — "n/a" is not numeric
```

Aborted case:
```
. APPEND FROM bad.csv
** Import aborted: more than 10 malformed rows (37 total). No records were appended.
   line 2:  column "amount" — "abc" is not numeric
   … (first 10 shown)
```

## Documenting the deviation (user-facing)

1. **README** — `COPY TO`/`APPEND FROM` rows in the command table + a callout:
   "Unlike dBASE III's headerless, positional `DELIMITED`/`SDF`, WebBase-III uses
   modern header-based CSV (RFC-4180, mapped by column name)."
2. **In-app `HELP`** — the two command lines note "header-based CSV (modern, not
   dBASE DELIMITED/SDF)".
3. **CHANGELOG** — `[1.0.0]` entry calls out the deliberate modern-CSV deviation.

## Testing

- **Unit (`tests/Csv.test.ts`)** — `toCSV`/`parseCSV` round-trip; quoting/escaping
  (commas, embedded quotes, newlines); CRLF tolerance; ragged rows; empty input.
- **Integration (`tests/CopyCsv.test.ts`)** — `COPY TO` emits `csv-download` with
  correct header + rows, honoring an active `SET FILTER`; export row-cap error.
  `APPEND FROM` round-trip: feed a `csv-upload`, assert good rows inserted, ≤10 bad
  rows skipped with correct details, >10 aborts with zero inserted; 5 MB cap
  rejection. Uses unique DB names + the shared-handle fix already on this branch.
- **E2E (optional, `tests/copycsv.spec.ts`)** — real browser download + file-input
  upload round-trip.

## Interaction with live propagation (forward note)

On `release/v1.0.0`, an `APPEND FROM` by client B does **not** auto-update a BROWSE
grid open in client A — live propagation (`data-changed`) is a `release/v1.1.0`
feature and isn't on this branch.

When `release/v1.0.0` merges up and this feature meets live propagation, it
composes automatically with no extra wiring: import inserts go through
`ServerDatabaseBridge.exec()` (the `onMutate` chokepoint), so after the import's
transaction commits, client B's session fires `notifyChange` once and
`SessionManager.broadcast` refreshes any peer viewing that table. Because the
notify fires after `COMMIT` (and the per-table debounce coalesces the burst),
peers get exactly one refresh of committed data — never a half-imported state.

## Out of scope

- dBASE `DELIMITED WITH <char>` custom delimiters; `SDF` fixed-width.
- `COPY TO` producing a `.dbf`; `COPY STRUCTURE`; `COPY TO ... FIELDS <list>`.
- Server-side file paths of any kind.

## Definition of done

Follows CLAUDE.md GitFlow DoD: feature branch off `release/v1.0.0`, PR into it;
version stays the milestone's `1.0.0`; CHANGELOG `[1.0.0]` entry; README + CLAUDE.md
command tables + HELP updated; tag only when `release/v1.0.0` merges to `main`.
