# 1Source Fulfilment

Procurement-to-fulfilment platform for **1BUY**, operating as Merchant of Record
between customer and supplier: it takes title, carries the risk, imports the
goods, pays the duty, and invoices the customer under its own GSTIN.

A single order touches seven parties — customer, supplier, escrow provider,
testing laboratory, freight carrier, customs house agent, and 1BUY's own
warehouse and finance teams. This is the one record that holds all of it.

Jurisdiction is **India**: GST, customs valuation and e-invoicing rules are part
of the domain, not bolted on.

---

## Getting started

```bash
npm install
cp .env.example .env
npx prisma db push        # create the SQLite file
npx prisma generate       # build the client into lib/generated/prisma
npm run seed              # demo data — masters, orders, the demo order
npm run dev               # http://localhost:4100
```

| Script | Does |
|---|---|
| `npm run dev` | Dev server on **:4100** |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — **170 tests**, all pure domain logic |
| `npm run lint` | ESLint |
| `npm run seed` | Rebuild the whole demo database |
| `npm run db:push` | Apply `schema.prisma` to SQLite |

> **After any schema change, restart the dev server.** `prisma generate` updates
> the client on disk, but the running Next server holds the old one in memory and
> Turbopack's hot reload will not pick it up. The symptom is
> `Unknown field X for include statement on model Y` on every page.

---

## The hosted demo

**https://1source-fulfilment.vercel.app** — no login, seeded, fully clickable.
Start at `DEMO-ORDER`, which sits at **B3 · Supplier Proforma Invoice received**
with 30 stages still ahead of it. **Reset demo** on that page puts it back.

It runs **without a provisioned database**. The seeded SQLite file is committed
as `prisma/demo.db`, pulled into every function bundle by
`outputFileTracingIncludes` (`next.config.ts`), and copied to `/tmp` at cold
start by `lib/db.ts` — `/tmp` being the only writable path in a Vercel function.

So the demo **reads and writes normally**, including document uploads. What it
does not do is *persist*: each function instance gets its own copy, and changes
go when that instance recycles. Two browser tabs can land on different
instances. That is a deliberate trade for a prototype, not a design for users.

### Giving it a real database

Three sites, all commented where they sit:

1. `prisma/schema.prisma` — `provider = "postgresql"`
2. `lib/queries/search.ts` — restore `mode: 'insensitive'` on the `like` filter.
   Postgres `LIKE` is case-sensitive and the failure is **silent**: an empty
   result, not an error.
3. Set `DATABASE_URL` in the Vercel project. `lib/db.ts` then skips the `/tmp`
   branch entirely — no code change needed there.

Then `npx prisma db push && npm run seed` against it. Uploads still need real
object storage (Vercel Blob or S3) to survive; that is the four functions in
`lib/storage.ts` and nothing else.

---

## Read this before writing code

**[`CONTEXT.md`](CONTEXT.md)** — §3 is fourteen rules, each of which exists
because breaking it produced a real defect. Money as integer minor units. Import
IGST excluded from landed cost. The stage ladder as single source of truth.
Overlays that never mutate it. How the advance gates compose. Derived-not-stored
state.

Most of it is not guessable from the file tree.

**[`AGENTS.md`](AGENTS.md)** — this version of Next.js (16.2.12) has breaking
changes from what most people have memorised. Read the relevant guide in
`node_modules/next/dist/docs/` before writing framework code.

---

## Documentation

| File | What it is |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | Engineering context — architecture, rules, domain model, known gaps |
| `database-design.html` | 60 tables, 12 ERDs with crow's-foot notation, two-level DFD, searchable. Open in any browser; fully self-contained |
| `1BUY-Fulfilment-Platform.docx` | Problem statement, objectives, methodology, full user guide, every field |
| [`scripts/docs/`](scripts/docs) | The generators for the two above |

The HTML and the .docx are **generated from the source of truth**, so they cannot
describe a table or a stage the software does not have. When the domain changes,
regenerate rather than edit — see `scripts/docs/README.md`.

---

## Shape of the codebase

```
app/(app)/        every screen (App Router)
components/
  flow/           the stage rail — a dumb renderer over railStates()
  shell/          AppShell, TopBar, command palette, notifications, help
  ui/             Layout, Badges, DataTable, tooltip primitives
lib/
  domain/         ← the source of truth. Start with stages.ts
  actions/        server actions
  queries/        server-side reads
  tax/            GST engine + landed cost
  adapters/       three-mode integration layer (mock / manual / live)
prisma/           schema.prisma (60 models) + seeds
```

### The core idea

An order is a **work order**, named from four documents:

```
CustomerPO _ OurPI _ OurPO _ SupplierPI
```

It moves along a declarative ladder of **39 stages across 7 phases**
(`lib/domain/stages.ts`), which is the single source of truth for the flow rail,
transition rules, SLA ageing, the next-action prompt, the audit trail and the
generated documentation. Adding or reordering a stage means editing that one
file.

A stage is finished when there is **evidence on file** showing it happened — not
when somebody pressed a button.

---

## Stack

Next.js 16.2.12 (App Router, Turbopack) · React 19.2.4 with the React Compiler ·
Tailwind v4 · Prisma 6.19.3 + SQLite · Radix UI · Zod · Vitest

---

## Status

Working prototype with seeded demo data. Open items are listed in
[`CONTEXT.md` §10](CONTEXT.md) — the significant one being that **there is no
authentication**: the acting user is hardcoded, and RBAC is modelled but not
enforced.
