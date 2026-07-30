# 1BUY Fulfilment Platform — engineering context

Everything a developer needs before touching this codebase: what it is, why it is
shaped the way it is, the rules that must not be broken, and where each thing
lives.

Read §3 before writing any code. Most of it is not guessable from the file tree,
and several of the rules exist because breaking them silently produces wrong
money.

---

## 1. What this is

1BUY buys electronic components from suppliers and sells them to customers **as
Merchant of Record** — it takes title, carries the risk, imports the goods, pays
the duty, and invoices the customer under its own GSTIN. It is not a broker
passing an order along.

That position is the whole reason the platform exists. A single order touches
seven parties — customer, supplier, escrow provider, testing laboratory, freight
carrier, customs house agent, and 1BUY's own warehouse and finance teams — and
each holds only part of the truth. This is the one record that holds all of it.

**Jurisdiction is India.** GST, customs valuation and e-invoicing rules are baked
into the domain, not bolted on.

### The four problems it solves

| Problem | How the platform answers it |
|---|---|
| Counterfeit parts entering the chain | Approved Vendor List gate, plus independent lab testing of a sample **before** the full lot ships |
| Payment exposure in both directions | Escrow held by a neutral third party, released against a passed inspection and two Finance approvers |
| Customs valuation and duty errors | CIF-based valuation with the statutory notional additions; BCD/SWS treated as cost, import IGST as recoverable |
| Evidence arriving after the decision | Each stage declares what must be recorded and attached before the order may leave it |

---

## 2. Stack

| | |
|---|---|
| Framework | Next.js **16.2.12**, App Router, Turbopack |
| React | **19.2.4** (React Compiler is on — see §3.8) |
| Styling | Tailwind **v4** (`@theme inline`, container queries) |
| Data | Prisma **6.19.3** + SQLite |
| UI primitives | Radix UI, `cmdk`, Motion, Sonner, TanStack Table, Recharts, Lucide |
| Validation | Zod |
| Tests | Vitest — **201 tests across 8 files**, all pure domain logic |

> ⚠️ **`AGENTS.md` in the repo root is a standing instruction:** this version of
> Next.js has breaking changes from what most models and developers have
> memorised. Read the relevant guide in `node_modules/next/dist/docs/` before
> writing framework code.

### Commands

```bash
npm run dev          # dev server on :4100
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run lint         # eslint
npm run seed         # rebuild the whole demo database
npm run db:push      # apply schema.prisma to the SQLite file
```

**The Prisma client is generated into `lib/generated/prisma`, not
`node_modules`.** The dev server's file watcher does not cover `node_modules`, so
a regenerated client there stayed invisible until a full restart and every schema
change produced an "Unknown argument" crash on a field that genuinely existed.

**After any schema change you must restart the dev server.** `prisma generate`
updates the client on disk, but the running Next server holds the old one in
memory and Turbopack's hot reload does not pick it up. The symptom is
`Unknown field X for include statement on model Y` on every page.

---

## 3. The rules

These are not style preferences. Each exists because breaking it produced a real
defect.

### 3.1 Money is an integer in minor units

Paise for INR, cents for USD. Every field named `*Amount`, `*Value`, `*Total`,
`*Price`, `*Cost`, `*Duty`, `*Fee`, `*Tax` or `*Freight` is an `Int`. Rounding is
explicit and testable via `roundHalfUp` in `lib/domain/money.ts`.

The single exception is `unitPrice*`, a `Float` because component prices carry up
to four decimals. It is converted to integer minor units **at line level
immediately**, so float error cannot accumulate.

### 3.2 Import IGST is not a cost

`dutyBcd` and `dutySws` are real cost. `dutyIgst` is recoverable and is
**excluded from landed cost**. Treating them alike silently misstates margin on
every imported order. See `lib/tax/landed-cost.ts`.

### 3.3 The stage ladder is the single source of truth

`lib/domain/stages.ts` declares 39 stages across 7 phases, once. The flow rail,
the transition rules, SLA ageing, the next-action prompt, the audit trail and the
generated documentation all derive from it. **Adding or reordering a stage means
editing that file only.**

Never hardcode a stage count anywhere — derive it from the arrays.

### 3.4 A per-order overlay never mutates the ladder

An order can reorder or drop phases (`OrderPhasePlan`), and can have extra steps
inserted (`CustomStage`). Both are **overlays**. The ladder itself is never
mutated per order, because it is shared by every other order.

**If you add a code path that computes stages, it must build its context through
`stageContextFrom()` in `lib/domain/stage-context.ts`.** Its input type *requires*
the phase plan, so a caller that forgets to fetch it gets a type error. This
exists because four places built the context by hand, only one learned about
phase plans, and re-planned orders rendered a flow the server would then refuse —
they could not be advanced at all.

### 3.5 Evidence gates advancement, and the escape hatch is recorded

A stage is finished when there is something on file showing it happened, not when
somebody pressed a button. The gate checks the stage being **left**.

It can be passed without complete evidence, but only with a written reason of at
least `OVERRIDE_REASON_MIN` (8) characters, which is written to the audit log
naming exactly what was missing. Client and server share the constant so they
cannot drift.

### 3.6 Gates compose through one function

When more than one gate is outstanding — evidence *and* dual authorisation — the
decision goes through `nextAdvanceStep()` in `lib/domain/advance-gate.ts`. Its
invariant:

> The submitted request carries every answer collected, no matter which gate
> happened to be satisfied last.

The two gates were previously chained as dialogs, and only whichever closed last
passed its answer to the server. An operator who had to satisfy both had their
waiver silently dropped, the server refused for missing evidence, the client
reopened the evidence form — an unescapable loop.

### 3.7 Checklist state is derived, never stored

`lib/domain/stage-tasks.ts` computes sub-task completion from what is actually
recorded: a document row from the attachment, a capture row from required fields,
an action row from the evidence field that records it happening. **Nothing is a
to-do list maintained by hand** — such a list drifts from reality within a week
and is then worse than nothing, because it looks authoritative.

### 3.8 React Compiler is on

Manual `useMemo`/`useCallback` that the compiler cannot preserve is a lint
**error**, not a warning. Prefer deriving during render over `useEffect` +
`setState`; `react-hooks/set-state-in-effect` is also an error. Two patterns that
work well here:

```ts
// Instead of an effect that clears a draft when it matches what was saved:
const active = draft && sig(draft) !== sig(saved) ? draft : saved;

// Instead of an effect that clears a preview when the underlying record moves:
const shown = preview?.pinnedAt === order.stage ? preview.stageId : anchorStageId;
```

### 3.9 Audit is append-only, one row per changed field

Never one row saying "updated". `reason` is carried on every row it justifies.
An order six months old must be able to answer *why*, not just *what*.

### 3.10 Connector failure degrades, never blocks

Every integration runs in one of three modes — mock, manual, live. A real adapter
failure falls back to manual capture with its own audit row. **An order is never
blocked by a third party being down.**

### 3.11 Provenance on anything external

Any record an external API could have produced carries `provenance`,
`provenanceActor`, `provenanceAt`, `provenanceRef`. A reader must always be able
to tell whether the platform was *told* a fact or *assumed* it.

### 3.12 Separation of duties

- Final escrow release: two **different** Finance approvers **and** a passed inspection.
- A step added to an order's flow is a **request**; someone other than the requester must approve it.
- Phases already completed or in progress cannot be moved or removed.
- Evidence cannot be filed against a stage the order has **not reached** — enforced server-side in `uploadStageDocument`, not just hidden in the UI.

### 3.13 Serialisable props across the RSC boundary

Column definitions and similar config crossing server → client use **named**
actions, never render functions.

### 3.14 The layout contract

`min-w-0` constrains a grid **container**, never the **track**. A bare `grid`
sizes its implicit column to `max-content`; `grid-cols-1` is the fix. The page
must never scroll horizontally — wide content scrolls inside its own container.

Prefer `@container` queries over viewport breakpoints for anything inside a grid
column that collapses.

---

## 4. Directory map

```
app/(app)/                 53 files — every screen, App Router
  orders/[id]/             the order detail page and its panels/dialogs
  dashboard/ create-po/ create-pi/ demand-aggregation/ escrow/ testing/
  logistics/ customs/ warehouse/ tax/ avl/ masters/ documents/ reports/ settings/
components/                22 files
  flow/FlowRail.tsx        the stage rail — a dumb renderer over railStates()
  shell/                   AppShell, TopBar, Sidebar, CommandPalette, Notifications, Help
  ui/                      Layout, Badges, DataTable, InfoTooltip primitives
lib/                       60 files
  domain/                  ← the source of truth. See §5.
  actions/                 server actions ('use server')
  queries/                 server-side reads
  tax/                     GST engine + landed cost
  adapters/                the three-mode integration layer
  demo/                    the demo order fixture, shared with the seed
prisma/
  schema.prisma            63 models
  seed.ts                  + seed-masters, seed-split-sourcing, seed-demand-pool, seed-demo-order
```

---

## 5. `lib/domain` — read these first

| Module | What it owns |
|---|---|
| `stages.ts` | **The ladder.** 39 stages, 7 phases, transition rules, SLA, rail states |
| `stage-context.ts` | The only sanctioned way to build a `StageContext` (§3.4) |
| `stage-evidence.ts` | What each stage must record — 171 fields, 41 document slots |
| `stage-tasks.ts` | Sub-task checklists + the testing standards (§7) |
| `advance-gate.ts` | Composing the gates in front of an advance (§3.6) |
| `phase-plan.ts` | Per-order reordering/curtailment, what may change and what it costs |
| `money.ts` | `toMinor`, `convertMinor`, `roundHalfUp`, `pctOf` |
| `incoterms.ts` | All 11 Incoterms 2020 + `FOR`, with cost/risk split and customs valuation |
| `enums.ts` | Every enum-ish union + Zod schemas + display metadata |
| `exceptions.ts` | Exception types and the named routes out of each |
| `aggregation.ts` | Demand pooling maths |
| `allocate.ts` | Supply-to-demand allocation with depletion |
| `line-import.ts` | CSV/TSV parsing for bulk line upload |
| `xlsx-lite.ts` | Dependency-free `.xlsx` reader — **see §8** |
| `reconcile.ts` | Three-way match between PO, PI and what arrived |

---

## 6. The domain model

### The work order is the hub

An order is named from four documents:

```
CustomerPO _ OurPI _ OurPO _ SupplierPI
```

Pending segments are named (`SPI-PENDING`), not blank. When all four exist the
canonical name completes and **locks**; the provisional name is retained as a
searchable alias.

`WorkOrder.supplierPoId` has **no unique constraint** — this is deliberate and is
what makes the many-to-many shapes possible:

- **Split sourcing** — one customer PO served by several supplier POs ⇒ several work orders
- **Demand aggregation** — one bulk supplier PO serving several customer POs ⇒ one work order each

> Aggregation is a **buy-side** concept. Fulfilment stays per customer, because
> proforma invoices, tax invoices, e-way bills and PODs name one buyer and cannot
> be pooled.

`POLinkMapping` is the join carrying the allocated quantity and both prices. **A
customer line can only contribute what it has left unallocated** — the platform
refuses to promise the same pieces twice.

### The seven phases

| | Phase | Mutability |
|---|---|---|
| A | Demand Capture | **Structural** — always runs, always first |
| B | Sourcing & Commitment | **Structural** |
| C | Financial Arming | Flexible — reorderable, removable with a reason |
| D | Quality Assurance | Flexible |
| E | Logistics | Flexible |
| F | Inspection & Settlement | Flexible |
| G | Value-Add & Delivery | **Terminal** — always last, never removed (cancel instead) |

### Cascade behaviour — the trap

Most children of `WorkOrder` cascade on delete. **Three do not**, because their
`workOrderId` is nullable, so a delete sets it to null and orphans the row:

- `InputTaxCredit`
- `ReverseChargeSelfInvoice`
- `IntegrationCallLog`

Orphaning the first two leaves tax credits sitting in the GST registers claimed
against an order that no longer exists. Any code that deletes a work order must
remove them explicitly — see `lib/demo/demo-order.ts` for the reference cleanup.

---

## 7. Testing standards

The numbers are **not** interchangeable, and a wrong one on a lab instruction
produces a report that proves nothing. Declared in `stage-tasks.ts`:

| Standard | Governs |
|---|---|
| **SAE AS6171** | The authentication standard for suspect/counterfeit EEE parts. Risk-based, one slash sheet per method (/3 XRF, /4 DPA, /5 X-ray, /6 acoustic, /7 electrical, /8 Raman, /9 FTIR). Since AS6081 Rev A removed its own criteria and points here, **this governs the verdict**. |
| SAE AS6081 Rev A | Distributor-facing obligation for open-market purchases |
| IDEA-STD-1010 | Visual inspection — remarking, resurfacing, repackaging |
| ASTM E1508 | Quantitative analysis by energy-dispersive spectroscopy (SEM-EDS) |
| ASTM B568 | Coating thickness by X-ray spectrometry (plating/lead finish) |
| ASTM E1742 | Radiographic examination practice |
| ASTM D3951 | Commercial packaging (the return leg) |
| IPC/JEDEC J-STD-033 | Moisture-sensitive device handling |
| IPC/JEDEC J-STD-002 | Solderability |

**ASTM is the analytical method underneath a measurement; AS6171 is the
authentication decision on top of it.** Both belong on an instruction — neither
substitutes for the other.

---

## 8. Security decisions that must persist

### SheetJS (`xlsx`) is deliberately **not** a dependency

It was installed and then removed. The npm build carries **four unfixed
high-severity advisories** — prototype pollution and ReDoS — with fixed versions
distributed only from the vendor's own CDN. This code parses files an operator
uploaded, which is precisely that threat model.

`lib/domain/xlsx-lite.ts` replaces it: ~200 lines reading the ZIP central
directory and inflating `sheet1.xml` / `sharedStrings.xml` via the platform's
native `DecompressionStream('deflate-raw')`. **Do not reintroduce `xlsx`.**

The 3 remaining npm advisories (postcss, sharp) are pre-existing transitive
dependencies of `next`.

### Other standing rules

- Uploads are validated for MIME type and size before any bytes are stored.
- Nothing is filed against a stage the order has not reached (§3.12).
- The demo reset action takes **no order id** — it can only ever act on the fixed
  demo alias, checked twice before deleting anything.

---

## 9. Demo data

`npm run seed` builds the whole database. Four scenarios:

| Seed | Scenario |
|---|---|
| `seed-masters` | Customers (same-state / different-state / SEZ), suppliers, parts, HSN rates |
| `seed-split-sourcing` | One customer PO across three suppliers, at three different stages |
| `seed-demand-pool` | Overlapping demand across customers, left unsourced so aggregation has something to work on |
| `seed-demo-order` | **`DEMO-ORDER`** — a clean one-to-one order parked at B3 |

`DEMO-ORDER` is the demo fixture: one customer order, one supplier order, sitting
at *supplier PI received* with all four documents present and 30 stages ahead
untouched. It has a **Reset demo** button on its own page, and the button runs
the same code as the seed — sharing it is what stops the two drifting.

> Re-seeding while somebody has the order open will desync their page. The app
> now detects this and reloads rather than showing a transition error, but it is
> still worth announcing.

---

## 10. Known gaps

- Tasks #13 (exceptions/SLA/notification consolidation), #15 (settings sub-pages, RBAC enforcement, guided tour) and #16 (verify all 28 acceptance criteria with evidence) are open.
- **No authentication.** The acting user is hardcoded; RBAC is modelled but not enforced.
- Seeded documents have **no bytes behind them** — only newly uploaded files have real content.
- `WHL` and `WHA` are placeholders ("Testing Laboratory", "Customs Agent"); the real vendor names are not yet confirmed.
- The theme-bootstrap script emits a console warning in dev. Three approaches were tried; all warn. The first paint is correct and it is left as is.
- `OrderDetailView.tsx` carries 26 pre-existing `react-hooks/refs` lint errors, unrelated to recent work.

---

## 11. Generated documentation

| File | What it is | Regenerate |
|---|---|---|
| `database-design.html` | Self-contained, searchable reference for all 63 tables and 915 columns, with the raw schema embedded | from `prisma/schema.prisma` |
| `1BUY-Fulfilment-Platform.docx` | Problem statement, objectives, methodology, full user guide, every field | from `lib/domain` |
| `CONTEXT.md` | This file | by hand |

The first two are **generated from the source of truth, not written alongside
it** — they cannot describe a column or a stage the software does not have. If
you change the domain, regenerate rather than edit.
