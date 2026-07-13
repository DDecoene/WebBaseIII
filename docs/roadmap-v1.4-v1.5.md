# Roadmap — v1.4.0 and v1.5.0

*Written 2026-07-13, the day v1.3.0 shipped.*

Parity was finished at v1.0.0. Everything since (`TIME` columns, cell validation, `LOOKUP`
columns, field-bound `@ SAY GET`) has been small, careful deviation from dBASE III in the
direction of "less painful". This document is the first roadmap that isn't driven by what
dBASE III had — it's driven by what people who *actually shipped xBase software for a living*
said they miss, after WebBase-III was shown to them.

## Where the direction came from

Two threads, both June 2026:

- **Show HN**, 2026-06-24 — 96 points, 27 comments:
  <https://news.ycombinator.com/item?id=48656986>
- **r/retrocomputing**, ~2026-06-24:
  <https://old.reddit.com/r/retrocomputing/comments/1ue8k6s/>

They did not ask for more dBASE III. They asked, repeatedly and independently, for one
specific thing — and it is not a feature, it is a *property of the environment*.

> "One of the very cool things Fox allow us was to ship their ability to `CREATE FORM,
> CREATE REPORT, BROWSE, etc` so the users can customize the app with the same power as us.
> This is one of the most important advantages of ERPs and such made with Fox and **is still
> unmatched**."
>
> — [mamcx, HN](https://news.ycombinator.com/item?id=48687809) (building [tablam.org](https://tablam.org) out of the same conviction)

> "if the ERP allows the customer to do their own custom reports and forms… they won't pay
> you extra customization fees?"
>
> — [nottorp, HN](https://news.ycombinator.com/item?id=48688871) — the joke that names the business reason this capability disappeared

> "Loved doing xbase coding back in the day as it had **everything all in one tool**.
> Especially when you added in SQL, form and report builders. Foxpro even had a distribution
> kit to compile to an .exe."
>
> — garyk1968, [r/retrocomputing](https://old.reddit.com/r/retrocomputing/comments/1ue8k6s/)

> "you have to wonder if maybe some of these tools could be useful again. With the increased
> power of modern computers, and some additions of modern technology like a web UI, HTTP
> support for data access… We could be entering a new age of building our own tools."
>
> — [jdswain, HN](https://news.ycombinator.com/item?id=48692500)

> "I'm not nostalgic about the tech of those years, but I definitely think that **we unlearned
> a few things along the way**."
>
> — [myth2018, HN](https://news.ycombinator.com/item?id=48687266)

### The thesis

xBase's real advantage was never the dot prompt. It was that **the tools that built the app
shipped with the app**. The person using the software could open the screen painter and the
report writer and change their own forms and reports, with the same power the developer had.
Modern web software took that away and never gave it back — and `mamcx`, who has been doing
this for 25+ years, says it is *still unmatched*.

WebBase-III is one component short of being able to demonstrate that. It has the language,
the editable grid (`BROWSE`), the report engine and designer, and the Assistant's wizards.
**It has no form designer.** Forms exist only if you hand-write `@ SAY GET` into a `.prg`.

So:

- **v1.4.0 gives the end user the developer's tools** — the screen painter, plus a catalog to
  hold an application together.
- **v1.5.0 lets you hand the whole thing to someone** — an app, published to a URL. FoxPro's
  distribution kit, except distribution in 2026 is a link.

That order matters. The screen painter is what makes an app *buildable* by its user; app
publishing is what makes one worth building.

---

## v1.4.0 — The screen painter

> Give the end user the same power as the developer.
> [Milestone 5](https://github.com/DDecoene/WebBaseIII/milestone/5)

### `CREATE SCREEN` / `MODIFY SCREEN` — a visual form designer

The centrepiece, and the single most-requested capability across both threads. A visual
designer for `@ SAY GET` forms on the character-cell grid, which **generates real W3Script**
you can then open in the program editor and edit by hand. dBASE III+ had a screen painter;
FoxPro had `CREATE FORM`; WebBase-III has neither.

Design constraints that fall out of what already exists:

- Output is `@ r,c SAY "…" GET <field>` source, not an opaque binary. The generated form must
  be readable, editable, and re-openable in the designer — a round trip, the way `MODIFY
  STRUCTURE` already round-trips a schema.
- Field-bound `GET`s (shipped in v1.3.0, #59) already bind to the active table's columns,
  prefill from the record, validate on submit, and render a picker for `LOOKUP` columns. The
  designer's job is to *place* them, not to reinvent binding.
- Screens are stored like programs and reports are: server-side, in `data/system.sqlite3`
  (see `ProgramStore.ts` / `ReportStore.ts` for the shape).

### Catalog — hold an application together

`garyk1968` named dBASE IV's catalog manager specifically. A catalog groups tables, screens,
reports and programs into one named *application*, so a WebBase-III app is a thing with a
name rather than a loose pile of objects in a database. It is also the natural unit of
publishing, which is what v1.5.0 needs.

### Assistant: JOIN + work areas (#34)

Already open, already on this milestone. The Assistant catalog exposes no work-area state, so
the `JOIN` and `SET RELATION` wizards can't offer real dropdowns. Closes the last gap between
the sidebar and the REPL language.

---

## v1.5.0 — Ship it

> Publish an app to a URL.
> [Milestone 6](https://github.com/DDecoene/WebBaseIII/milestone/6)

FoxPro shipped a **distribution kit** that compiled your app to an `.exe` you could hand to a
customer (`garyk1968`). That is the piece that made xBase a way to *deliver software*, not
just to write it. The 2026 equivalent is not an `.exe` — it is a link.

Export a catalog (its tables, screens, reports and programs) as a portable app, and open it
from a URL. The person on the other end gets a working data application — and, because
v1.4.0 shipped the screen painter and the report designer *with* it, they get the tools to
change it too. That is the whole thesis, executed: the tools ship with the app.

This is also the milestone that earns a second Show HN. v1.3.0 does not — HN treats a point
release as a repost, and the first Show HN did well enough (96 points) to count as
significant attention. *"Build a database app in your browser, then send someone the link"*
is a headline. *"v1.4.0 is out"* is not.

---

## Explicitly not doing

- **`.DBF` file import.** Off the table, and nobody in either thread actually asked for it —
  that was an assumption, not a finding. Revisit only if real users ask.
- **Being useful.** [nutifafa asked what the use case was](https://news.ycombinator.com/item?id=48690733) and the honest answer stands: there
  isn't one. It's a toy, a piece of history revived. The features above are chosen because
  they make it a *better* toy and because they demonstrate an argument worth making — not
  because WebBase-III is bidding to run anyone's business.
