# SplitSmart

Group expense splitting that handles the cases the big apps punt on: itemised
restaurant bills, receipts read from a photo, expenses that repeat on a
schedule, and a settle-up plan that minimises how many payments anyone has to
make.

Built with Next.js 15, TypeScript, Prisma and SQLite. Clone it, run one command,
and it opens on a populated demo.

```bash
git clone https://github.com/<your-username>/splitsmart.git
cd splitsmart
cp .env.example .env            # then set AUTH_SECRET (see below)
npm install
npm run setup                   # generate client, create the DB, seed demo data
npm run dev                     # http://localhost:3000
```

Sign in as `ari@example.com` / `password123`.

---

## What it does

**Five ways to split, all of which add up exactly**

Equal, exact amounts, percentages, weighted shares, and per-item. Every mode is
guaranteed to sum to the bill total - the leftover paise on a ₹100 three-way
split is given to somebody, never dropped.

**Itemised bills with proportional tax**

The restaurant case. Tap who ate what; tax, service charge and discounts are
then spread *in proportion to what each person actually ordered*. If you had the
₹900 steak and I had the ₹120 dal, you caused most of the GST, so you carry most
of it. Someone who only shared the naan pays almost no tax, and someone who
ordered nothing pays nothing at all.

**Receipt scanning from a photo**

Point your camera at the bill. OCR runs **in your browser** via Tesseract - the
photo never leaves your device and there is no API key to configure. The parser
pulls out line items, quantities, GST/CGST/SGST, service charge and discounts,
then *reconciles*: items + tax + tip − discount must equal the printed total. If
it doesn't, you get a confidence score and a specific warning rather than a
silently wrong bill.

An optional Claude vision pass (set `ANTHROPIC_API_KEY`) handles the messy half -
crumpled thermal paper, handwriting, two columns, mixed scripts. It is opt-in per
scan, because that one does upload the image.

**Debt simplification**

Six flatmates with tangled balances need fifteen transfers to settle directly.
This works out the smallest practical set of payments that clears everyone at
once, and tells you the saving up front: *"3 payments instead of 9."* If Ari owes
Sam ₹500 and Sam owes Priya ₹500, the answer is one payment from Ari to Priya and
Sam never touches his phone.

**Recurring expenses**

Rent, the shared Netflix account, the cleaner. Set it once. Rules anchored to the
31st fire on 31 Jan → 28 Feb → **31 Mar** - they do not drift to the 28th forever,
which is the bug almost every naive implementation ships.

**Analytics and export**

Spend by category, spend over time against your own share, and paid-vs-owed per
member. Every chart has a table view behind it. Export the whole group to `.xlsx`
(six formatted sheets with live `SUM()` formulas) or flat CSV.

**Also**: multiple payers on one bill, multi-currency groups, UPI deep links on
the settle-up screen, an append-only activity feed, and dark mode.

---

## Three decisions worth explaining

### Money is never a float

Every amount in this codebase is an integer count of **minor units** - paise,
cents. `₹12.35` is the number `1235`.

`0.1 + 0.2 !== 0.3` in IEEE 754. An expense app that loses a paise per bill
drifts until the balances stop reconciling, and the bug reports arrive six months
later as "the maths is wrong somewhere." Integers make that impossible.

### Splits are guaranteed to sum to the total

Three people, ₹100. A naive split gives everyone ₹33.33 and quietly loses a paise.

Every mode routes its rounding through a largest-remainder allocator: everyone
gets their floored share, then leftover units go one at a time to whoever was
robbed hardest by the flooring, with ties broken by index. So ₹100 ÷ 3 is
`[33.34, 33.33, 33.33]` — and it is the *same* answer every time, because people
re-open old expenses and expect the numbers not to move.

`allocate()` asserts this invariant before returning. If it ever breaks, it
breaks loudly in a test rather than silently in somebody's balance.

### Debt simplification is a stated heuristic, not a claimed optimum

Finding the provably fewest transfers is NP-hard - it reduces to set partition.
So this runs a two-stage heuristic and says so:

1. **Cancel exact matches.** A debtor owing exactly what a creditor is owed is a
   free win - one payment retires two people.
2. **Greedily match** the largest remaining debtor against the largest creditor.

Stage 2 alone bounds the result at *n−1* payments for *n* people with non-zero
balances. Stage 1 usually takes real groups well below that. Both stages break
ties on user id, so the plan never reshuffles between page loads - a settle-up
list that changes when you refresh is one nobody trusts.

The plan is verified before it is returned: apply every transfer and all
balances must land on exactly zero, or it throws rather than moving real money
on a wrong plan.

---

## Testing

```bash
npm test
```

86 tests over the parts where being wrong actually costs someone money:

- **Money** — parsing, formatting, Indian digit grouping, and 3,000 randomised
  allocations asserting the sum invariant holds for any total and any weights.
- **Splits** — all five modes, their rejection cases, and 2,000 randomised
  expenses confirming shares always reconcile to the total.
- **Balances & simplification** — multi-payer bills, settlements, and 500
  randomised ledgers checking that every generated payment plan clears the
  ledger to zero and stays within the *n−1* bound.
- **Receipt parsing** — realistic Indian restaurant and grocery receipts
  including the noise OCR actually produces. One of these caught the parser
  reading a shop's PIN code as a ₹5,60,001 line item, which is why item prices
  now have to look like prices.
- **Recurrence** — month-end clamping, leap years, intervals, end dates, and the
  catch-up path that generates everything missed while the app was closed.

---

## How it is put together

```
src/lib/
  money.ts              Integer minor-unit arithmetic + largest-remainder allocator
  split/
    allocate.ts         The five split modes
    balances.ts         Ledger -> net and pairwise balances
    simplify.ts         Debt simplification
  ocr/
    parse.ts            Receipt text -> structured line items (pure, heavily tested)
    scan.ts             Browser-side Tesseract runner
    enhance.ts          Optional Claude vision pass
  recurring/schedule.ts Anchored recurrence, month-end safe
  analytics/            Category / month / member breakdowns
  export/workbook.ts    .xlsx and CSV
  groups.ts             Service layer - the only module that talks to Prisma
```

The split engine is pure and has no idea a database exists. `groups.ts` is the
only place the engine and Prisma meet. Because the engine is pure TypeScript, the
*same* code runs in the browser to preview a split live as you type - what you see
before saving is exactly what gets stored, not an approximation of it.

Shares are computed once on write and stored as rows, so reading balances is a
plain aggregate rather than re-running the engine over every expense on every
page load.

---

## Configuration

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Defaults to local SQLite (`file:./dev.db`). |
| `AUTH_SECRET` | yes | Signs the session cookie. Generate with the command below. |
| `ANTHROPIC_API_KEY` | no | Enables the Claude vision pass for messy receipts. Everything works without it. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Moving to Postgres

Change the provider in `prisma/schema.prisma` to `postgresql`, point
`DATABASE_URL` at your connection string, and run `npm run db:push`. Nothing in
the application code is SQLite-specific.

---

## Scripts

| Command | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Run the test suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run setup` | Generate client, create DB, seed demo data |
| `npm run db:reset` | Wipe and re-seed |
| `npm run db:studio` | Prisma Studio |

---

## Known limits

- **Auth is deliberately simple** - bcrypt plus a signed httpOnly cookie, no
  provider, no email verification, no password reset. Enough to demonstrate the
  app; not what you would ship to real users.
- **Recurring rules fire when a group is opened**, not from a cron job. That is a
  deliberate trade for an app that may be asleep on a free tier - a rule that
  only runs when a server happens to be awake is not a rule. Occurrences are
  dated to the day they were due, so the ledger is identical either way.
- **Simplification is a heuristic**, as described above. It is near-optimal in
  practice and never wrong, just occasionally one payment off the theoretical
  floor.
- **Expenses are delete-and-re-add, not edit.** The data model stores the
  original split spec to support editing; the UI for it is not built yet.
- **OCR is English-only.** Tesseract supports more languages; wiring up a
  language picker is a small change in `scan.ts`.

## Licence

MIT.
