# Shop Desk

A point-of-sale and shop-management system for small automotive businesses —
repair shops, inspection stations, tire and body shops, oil-change and detail
places, mobile mechanics, independent garages. Built for a shop doing
$0–$60,000 a month in card sales that finds Tekmetric, Shopmonkey and Mitchell
too expensive and too complicated.

Built to the Auto POS Master Engineering Blueprint v1.0.

## What it does

**Estimate → repair order → invoice → payment.** An advisor writes an estimate,
texts the customer a link, and the customer approves the brakes and declines the
struts from their phone. What they approved becomes a repair order; what they
declined is kept on file rather than lost. Finished work becomes an invoice and
the counter takes the money.

**Counter tickets.** Most of the volume at an oil-change or tire shop is a
customer standing at the counter. That opens a repair order directly, with no
estimate to approve first.

**The shop floor.** Repair orders move along a fixed status graph, technicians
get their own queue with no money on it, and work found on the lift can be added
mid-job — with a note on the record saying it appeared after the customer
approved the estimate.

**Digital inspections.** A technician marks each item green, yellow or red on a
tablet with what they measured. Sending it mints an unguessable link; the
customer sees the red items first, and everything that was fine underneath.

**Parts and tires.** Stock comes off the shelf when work is billed, not when a
line is written. Every movement carries a reason. Voiding an invoice puts the
parts back.

**Reports.** Billed and collected are reported separately, because on fleet
accounts they land in different months. Plus mix, real margin from line costs,
technician hours turned, estimate approval rate and receivables aging.

**Roles.** Owner, manager, service advisor, technician, counter clerk and
bookkeeper, as an explicit matrix rather than scattered `if` checks.

## Running it

```bash
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed
npm run dev
```

Then sign in at `/login`. Every seeded user's password is `shopdesk`:

| Email                       | Role            |
| --------------------------- | --------------- |
| `coleman@blueduckauto.test` | Owner           |
| `priya@blueduckauto.test`   | Service Advisor |
| `marco@blueduckauto.test`   | Technician      |

The seed prints a customer approval link and a customer inspection link. Both
work with no session — the token in the URL is the only credential.

```bash
npm test          # unit and integration tests
npm run build     # production build
```

## How it is put together

Next.js App Router with server components and server actions, Prisma over
SQLite in development and Postgres in production, Tailwind, Vitest.

A few decisions are load-bearing:

**Estimates, repair orders and invoices are three separate tables** (§10), and
line items are polymorphic across all three. That means lines are *copied* at
each conversion, which is the one genuinely dangerous thing in the design — a
copy that silently drops or alters a line produces an invoice that disagrees
with what the customer approved. Every conversion therefore goes through
`lib/convert.ts`, which copies inside a transaction, recomputes totals from the
copied rows, and refuses to commit if they do not match the source. Do not write
a conversion anywhere else.

**Money is integer cents everywhere.** Never floats. Off-by-a-penny invoice
totals are not forgiven by shop owners.

**Stored money columns are never trusted as input.** `paidCents` and
`balanceDueCents` exist so list screens do not have to aggregate, but every
mutation recomputes them from the payment and refund rows.

**No card data, ever** (§12). Payments carry a processor reference, a brand and
a last 4. `assertNoCardData` actively refuses any reference field holding a
12-or-more digit run, separators stripped — because the realistic way card data
reaches a database is someone typing it into the wrong box.

**Every tenant-owned row carries `tenantId`**, and no lookup is done by bare id.

## Layout

```
lib/            business logic, no React
  convert.ts        estimate → RO → invoice, the guarded conversions
  money.ts          integer-cent arithmetic
  auth.ts           scrypt, server-side sessions
  permissions.ts    the §5 role matrix
  customers.ts      customers and vehicles
  estimates.ts      building and approving estimates
  repairOrders.ts   the shop floor
  invoices.ts       payments, refunds, voids, receivables
  inventory.ts      parts, movements, sale and restore
  inspections.ts    templates, results, the customer's link
  reports.ts        billed vs collected, margin, productivity
  settings.ts       shop, people, packages, audit
app/(app)/      the signed-in application
app/approve/    public estimate approval, token only
app/inspection/ public inspection view, token only
tests/          267 tests over the logic in lib/
```
