# Skyroad Holidays – Cash Management System

A private web app for tracking every rupee of cash in and out, client receivables, supplier payables, and the physical cash in your office locker and in hand. Works in any browser on Mac, Windows, iPad and phone; every device sees the same live data.

**Stack:** Next.js 15 (App Router, TypeScript) · PostgreSQL on Supabase · hosted on Vercel (Mumbai region).
Only four runtime packages: `next`, `react`, `react-dom`, `postgres`.

---

## Contents

1. [How the money logic works](#1-how-the-money-logic-works)
2. [Go live – step by step (≈30 minutes)](#2-go-live--step-by-step)
3. [Environment variables](#3-environment-variables)
4. [Username and password](#4-username-and-password)
5. [Daily use](#5-daily-use)
6. [Backups and export](#6-backups-and-export)
7. [Tests performed](#7-tests-performed)
8. [Known limitations](#8-known-limitations)
9. [Project structure](#9-project-structure)

---

## 1. How the money logic works

Everything is calculated from one table of entries (`skyroad.txn`). No total is ever typed in or stored, so totals can never drift out of step with the entries.

| Entry type | Effect on physical cash | Effect on outstanding |
|---|---|---|
| **Cash In** | + to the chosen location | Reduces a receivable if linked to one |
| **Cash Out** | − from the chosen location | Reduces a payable if linked to one |
| **Transfer** | − from one location, + to another (total unchanged) | none |
| **Collection Due** | none | + To Collect |
| **Payment Due** | none | + To Pay |

**Formulas**

- Location balance = opening balance + cash in − cash out + transfers in − transfers out
- Total cash = sum of all location balances. Cash in Locker / Cash in Hand = locations of that type
- To Collect = Σ collection dues − Σ cash-in linked to them
- To Pay = Σ payment dues − Σ cash-out linked to them
- Net cash movement (period) = cash in − cash out (transfers excluded)
- Booking: received, to collect, supplier cost, supplier paid, to pay, other expenses, cash balance, and expected margin (package − supplier cost − other expenses) are all shown separately. Package value and supplier cost never count as cash.

**Safeguards (enforced inside the database, so they hold on every device at once)**

- Amounts are exact decimals (`numeric(14,2)`), never floating point; must be > 0.
- A payment can never exceed what is outstanding, even if two devices save at the same instant (row locking).
- A receivable/payable that has payments against it cannot be deleted or reduced below what's been paid.
- Deletes are "soft": the entry moves to **Settings → Trash**, drops out of every total, and can be restored.
- Hard deletes of transactions are blocked at database level.
- Every create, edit, delete and restore is written to an audit log with before/after values and who did it.
- Every form carries a one-time key, so a double-click or a resend never creates a duplicate.
- Inactive cash locations can't receive new entries; a location can only be deactivated at ₹0.00.
- Cash entries can't be dated in the future.

## 2. Go live – step by step

You need: the project folder on your Mac, Node.js 20 or newer (`node -v`), and free accounts at supabase.com, github.com and vercel.com.

### Step 1 – Create the database (Supabase)

1. supabase.com → **New project**. Name `skyroad-cash`, region **South Asia (Mumbai)**, set a strong database password and save it in your password manager.
2. When it's ready: **Project Settings → Database → Connection string → URI**. Choose **Transaction pooler** (port 6543). Copy it and replace `[YOUR-PASSWORD]` with your database password. This is your `DATABASE_URL`.

### Step 2 – Create the tables

In Terminal, inside the project folder:

```bash
cp .env.example .env.local        # then open .env.local and paste your DATABASE_URL
npm install
npm run db:migrate                # creates all tables, rules and views
```

You should see `✓ 1 migration(s) applied.`
(Alternative: paste the contents of `db/migrations/001_init.sql` into Supabase → SQL Editor → Run.)

### Step 3 – Try it on your Mac (optional but recommended)

```bash
npm run dev
```

Open http://localhost:3000 → you'll be sent to **/setup** to create your password (see section 4). Add one test entry, check the dashboard, then delete it.

### Step 4 – Put the code on GitHub

1. github.com → **New repository** → name `skyroad-cash` → **Private** → Create.
2. In Terminal:

```bash
git init && git add . && git commit -m "Skyroad cash system"
git branch -M main
git remote add origin https://github.com/<your-username>/skyroad-cash.git
git push -u origin main
```

`.env.local` is in `.gitignore`, so your secrets are never uploaded.

### Step 5 – Deploy (Vercel)

1. vercel.com → **Add New → Project** → import `skyroad-cash` from GitHub.
2. Before clicking Deploy, open **Environment Variables** and add `DATABASE_URL` and `SETUP_TOKEN` (section 3).
3. **Deploy.** After 1–2 minutes you get a URL like `https://skyroad-cash.vercel.app`.
4. Visit `https://<your-url>/api/health` – it should say `"status":"ok"`.
5. Open the main URL → **/setup** → set your password.
6. Optional: Settings → Domains → add `cash.skyroadholidays.com` and follow the DNS instructions.

> **Plan note:** Vercel's free *Hobby* plan is for non-commercial, personal use only. Because this runs a business, use Vercel **Pro** (US$20/month per developer seat) – or deploy the same code to another Node host such as Netlify or Render.

From now on, every `git push` redeploys automatically.

## 3. Environment variables

| Name | Required | What it is |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase *Transaction pooler* connection string (port 6543) |
| `SETUP_TOKEN` | Yes, for first setup | Any long random text (20+ characters). Typed once on /setup so no one else can claim the account. Generate: `openssl rand -base64 24` |
| `DATABASE_SSL` | No | `disable` only for a local Postgres without SSL |
| `DATABASE_POOL_MAX` | No | Connections per server instance (default 5) |
| `TEST_DATABASE_URL` | No | A **separate, empty** database used by `npm test` – never your live one |

Local: put them in `.env.local`. Vercel: Project → Settings → Environment Variables (then redeploy).

## 4. Username and password

- **Username:** `Skyroadholidays` (not case-sensitive).
- **First password:** open the app → **/setup** → enter your `SETUP_TOKEN`, then your new password (8+ characters) twice. Setup works only once; afterwards the page sends you to sign-in. You can remove `SETUP_TOKEN` from Vercel after this.
- **Change password:** **Settings → Change password**. All other devices are signed out.
- **Forgot password:** on your Mac in the project folder, run `npm run set-password`. It updates the password directly in the database and signs out all devices.
- Passwords are stored only as scrypt hashes. Sessions are httpOnly cookies; only a hash of the session token is stored. Sessions end after 7 days unused, and always after 30 days. 5 wrong passwords from one device locks that device for 15 minutes.
- **Settings → Signed-in devices** shows every device and can sign the others out.

## 5. Daily use

**First thing:** **Cash & Locker → Manage locations** → enter today's real cash as the opening balance of *Cash in Hand* and *Cash in Locker*. Add other locations (e.g. *Petty cash*) if you need them.

| I want to… | Do this |
|---|---|
| Record cash received | **+ New entry** → Cash In. Pick the booking; its open receivable is selected automatically |
| Record cash paid | **+ New entry** → Cash Out. Link it to a supplier invoice, or leave unlinked for an expense |
| Take a new booking | **Bookings → + New booking**. Tick "Raise as receivable"; enter any advance taken today |
| Record a client part-payment | **To Collect** → **Collect** on the row → change the amount for a part payment |
| Pay a supplier | **To Pay** → **Pay** on the row |
| Log a supplier invoice | **+ New entry → Payment Due** (or **+ Supplier invoice** on the booking page) |
| Move cash to the locker | **Cash Transfer** quick action |
| Count the locker | **Cash & Locker → Verify physical cash**. Tick "post adjustment" only once you're sure |
| Fix a mistake | Open the entry → **Edit** (all totals recalculate) or **Delete** (restorable from Trash) |
| Find anything | Search box at the top: client, booking ref, supplier, hotel, txn ID |
| Reports / Excel / PDF | **Reports** → choose report & period → **Export Excel / CSV** or **Print / Save as PDF** |

Pages refresh every 20 seconds and whenever you switch back to the tab, so a phone and a laptop stay in step.

**Tip:** on iPhone, open the site in Safari → Share → **Add to Home Screen** for an app-like icon.

## 6. Backups and export

1. **In the app (any device):** **Settings → Download full backup (JSON)** – every location, booking, transaction (including deleted), cash count and the full audit log. Also CSV downloads of all transactions and all bookings. **Suggested habit: every Friday, download it and drop it in Google Drive.**
2. **From your Mac:** `npm run backup` saves the same JSON into `./backups/`.
3. **Full database dump** (if Postgres tools are installed): `pg_dump "$DATABASE_URL" --schema=skyroad -Fc -f skyroad-$(date +%F).dump`
4. **Supabase's own backups:** on the free plan, retention is limited and a project **pauses after about a week of low activity** (daily use of the app keeps it awake). When you rely on this daily, upgrading Supabase to Pro adds daily backups and removes pausing.

**Restoring:** a `pg_dump` file restores with `pg_restore`. The JSON backup is a complete readable record of every figure; if you ever need it re-imported, any developer (or Claude) can load it table by table.

## 7. Tests performed

All tests were run against a real PostgreSQL 16 database.

**A. Database business rules – 50 checks** (`db/tests/business_rules.sql`)
Opening balances; receivable/payable don't change cash; partial and full collections and payments; overpayment blocked; transfers keep the total unchanged; transfer to the same location blocked; editing amount and location reverses the old effect exactly once; soft delete recalculates and restore re-applies; due with payments can't be deleted or reduced below settled; type change blocked once paid; hard delete blocked; restore that would overpay blocked; zero/negative amounts blocked; cash rows need a location and dues can't have one; duplicate submission key blocked; inactive location blocked; booking summary separates cash, outstanding and margin; audit log records soft deletes, restores and the actor.

**B. Application layer – 34 tests** (`tests/app.test.ts`)
Indian amount parsing/formatting and exact paise totals; IST periods and the April–March financial year; first-time setup (once only, validation); login, case-insensitive username, session tokens never stored raw; password change signs out other devices; idle-session expiry; logout; form validation; booking + receivable + advance in one step; double-submitted booking and collection recorded once; duplicate booking reference message; partial collections; overpayment message shows exact outstanding (₹70,000.00); **two simultaneous collections from two devices – exactly one succeeds**; supplier payable and partial payment; transfers; edit recalculation; soft delete/restore; package amount change updates the receivable and rolls back fully if invalid; booking summary figures; payments inherit supplier and booking; booking deletion rules; custom locations and deactivation rules; cash count shortage and adjustment; period filters; To Collect/To Pay filters (today, overdue, next 7 days, settled, search); every report runs and reconciles with the dashboard (location closing = total cash, day-book closing = total cash, outstanding reports = To Collect/To Pay, register = inflow/outflow, monthly net = net); CSV formula-injection protection; global search; full backup with no secrets; per-device login lockout without locking out the owner's other devices.

**C. Pages and server actions – 60 checks**
Every page (dashboard in all periods, transactions list/new/view/edit, settle, To Collect, To Pay, bookings list/new/view/edit, cash, all 9 reports, search, settings, login) rendered with React 19 against the populated database with no errors; signed-out access redirected to /login; exports and backup refuse signed-out requests; each server action run end-to-end (add cash in, duplicate resubmit, invalid amount, unknown booking, transfer with "save & add another", record collection, over-collection, new booking with advance, edit, delete, restore, cash count, new location, wrong current password, CSV with Excel BOM and totals, backup, sign out). Rendered pages were screenshot in Chromium at desktop (1366px) and phone (390px) widths and checked for layout overflow.

**Run the tests yourself:** set `TEST_DATABASE_URL` in `.env.local` to an **empty second database** (a second free Supabase project works), then `npm test`. It refuses to run against your live database.

## 8. Known limitations

- **Final framework build happens at deploy time.** Package downloads were blocked in the environment where this was built, so `next build` was not executed there. Pages and server actions were verified by rendering them with React 19 and stubbing only Next.js's routing/cookie functions; the data layer was type-checked strictly, and the UI type-checked against simplified React/Next type stubs. Your first `npm install && npm run build` (or Vercel deploy) is the first full framework build. `next.config.mjs` lets a type-only warning not block deployment; `npm run verify` shows any.
- **Not yet deployed:** there is no live URL until you complete section 2 with your own Supabase and Vercel accounts.
- **Near-real-time, not instant:** other devices update within ~20 seconds or on tab focus, not push-instantly.
- **Single user.** Every change records who made it, so adding staff logins later is straightforward, but there's no user-management screen yet.
- **PDF = browser print.** "Print / Save as PDF" uses the browser's print dialog with a print-optimised layout (A4 landscape); there's no server-generated PDF file.
- **Excel = CSV.** Exports are UTF-8 CSV that open directly in Excel (₹ and names display correctly, numbers are summable), not native .xlsx.
- **No restore button for JSON backups.** Backups are complete, but restoring from JSON is a manual (developer) job; `pg_dump` files restore with standard tools.
- **Cash only.** Bank and UPI balances aren't tracked; deposits to bank are recorded as Cash Out ("Deposited to bank").

## 9. Project structure

```
app/                     Pages (App Router) and server actions
  (app)/                 Signed-in area: dashboard, transactions, bookings, collect, pay, cash, reports, search, settings, settle
  login/ setup/          Sign-in and first-time password
  api/export|backup|health
  actions.ts             All writes (each re-checks the session and validates on the server)
components/              UI (ActionForm, TxnForm, BookingForm, DuesPage, charts, shell)
lib/
  ledger.ts              Transactions, bookings, dues, locations, cash counts
  insights.ts            Dashboard, reports, search, backup
  auth-core.ts           Password hashing, sessions, lockout
  money.ts dates.ts csv.ts constants.ts
  db.ts / db-core.ts     Database connection
db/migrations/001_init.sql   Schema, integrity triggers, audit log, views
db/tests/business_rules.sql  Database rule tests
tests/                   Application tests (+ a minimal test-only Postgres client)
scripts/                 migrate, set-password, backup, test
```
# Skyroad-cash-system
