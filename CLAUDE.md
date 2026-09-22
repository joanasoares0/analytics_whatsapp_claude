# Business Analysis over WhatsApp

The business owner sends a question in plain language over WhatsApp and gets back
a number, a variation, a cause, a recommendation and a chart. An agent writes its
own SQL and picks the visualization by itself. Nothing runs on their machine.

**Stack:** Node · PostgreSQL (Supabase) · An AI model (OpenAI or compatible) ·
Netlify Functions · Meta Cloud API · QuickChart

> This is a reference `CLAUDE.md`. It describes how the project works so that
> Claude Code understands the context on its own when it opens the folder. Fill
> in the fields marked `<...>` with your own values. The **"Adapting it to your
> own scenario"** section, at the end, lists what to swap if you go beyond the
> demo.

---

## Working rules

Read this section before touching anything.

**1. The agent's behavior lives in the prompt, not in code.**
If an answer comes out wrong — ugly formatting, cause not investigated, generic
recommendation —, the fix is the text of the system prompt in `src/agent.mjs`.
Do not build keyword routing, do not add `if question.includes(...)`. The value
of this project is answering a question nobody anticipated; routing kills that.

**2. Whatever code can guarantee must not depend on the model remembering it.**
WhatsApp bold, chart order, number formatting: all of that is deterministic and
lives in code (`toWhatsApp`, the gauge ordering). Asking for it in the prompt
works most of the time — and "most of the time" is not good enough.

**3. Every change is tested before it is called done.**
```bash
node ask.mjs "what was my revenue yesterday?"
node ask.mjs "who's selling badly"
```
Changed the prompt? Run both. The model is non-deterministic: one good run
proves nothing, two bad ones prove a lot.

**4. Never run the database seed without warning first.**
`db/02_seed.sql` wipes and regenerates the entire base, and `db/01_schema.sql`
drops the tables before recreating them — `db/scripts/db_setup.py` asks before
either of them, and that prompt is not to be removed. The numbers change, and
already-rehearsed demos stop matching. (In the standard demo the database
already comes ready on Supabase — there is no need to run the seed.)

**5. The `.env` lives at the project root, next to `.env.example`.**
Copy `.env.example` to `.env` and fill it in. Never commit `.env` — it is in
`.gitignore` (only `.env.example`, with empty values, is versioned).
Double-check before pushing to Git.

**6. The agent does not write to the database, and that is not a convention —
it is a permission.**
The database user has `SELECT` only on the read views. Do not try to work
around it.

---

## Architecture

```
Phone ──► Meta Cloud API ──► whatsapp-webhook (Netlify)
                                   │  answers 200 in ~2s and delegates
                                   ▼
                          respond-background (15 min ceiling)
                                   │
                       ┌───────────┼───────────┐
                       ▼           ▼           ▼
                   AI model     Supabase    QuickChart
                                (2 views)     (PNG)
                                   │
                                   ▼
                       Meta Cloud API ──► Phone
```

**Why the webhook and the background job are separate functions:** the analysis
takes a few seconds (typically 8 to 15). Meta requires a `200` within a few
seconds, otherwise it treats the call as a failure and resends the same message
— the owner would get the answer two or three times. The webhook only accepts
and delegates; the work happens in the background function, which has a 15
minute ceiling.

---

## Layout

```
db/
  01_schema.sql        tables — they store `days_ago`, not a date
  02_seed.sql          designed data, re-runnable (wipes everything first)
  03_views.sql         the read views
  04_role.sql          read-only database user
  scripts/
    db_setup.py        runs the four .sql above (asks before destroying data)
    db_check.py        verifies the numbers and the permission wall
    _db.py             shared helpers for the two above
src/
  agent.mjs            system prompt + tool-use loop   ← the behavior lives here
  db.mjs               Postgres, SELECT only, with retry
  charts.mjs           Chart.js → PNG from QuickChart
  whatsapp.mjs         sending through the Meta Cloud API + toWhatsApp()
  env.mjs              loads .env, and ends the CLI scripts cleanly
netlify/functions/
  whatsapp-webhook.mjs      receives, validates, delegates
  respond-background.mjs    runs the analysis and answers
scripts/
  permission_proof.mjs  shows the database refusing writes and reads outside the views
  smoke.mjs             sanity: database + the chart types
  send_test.mjs         question → agent → WhatsApp
ask.mjs                 CLI: shows the SQL the agent wrote and the cost
netlify.toml            build and functions config
package.json            Node dependencies and npm scripts
.env                    credentials (outside Git)
.env.example            the same variables, empty, versioned
```

---

## The database

Supabase, schema **`demo`**. Fictional data for a technology reseller: sales by
salesperson, region, city, channel, product and category, across a few months.

### The table stores no date

The sales table stores **`days_ago`** (0 = today, 1 = yesterday). The real date
is born in the view as `current_date - days_ago`.

Consequence: **the data never ages.** "Yesterday" is always yesterday, with no
cron and no ingestion job. The rows are the same every day; only the calendar
label changes.

> If you swap in real data with absolute dates, this property stops holding —
> and that is fine. Adjust the views to use the real date column.

### Why the schema is `demo` and not `public`

Keeping the tables out of the `public` schema stops them from being readable via
PostgREST by anyone holding the publishable key (which is public by definition)
and avoids a name collision with other applications sharing the same Supabase
project.

### The two views

**`demo.vw_sales`** — one row per transaction
`transaction_id · sale_date · sale_year · sale_month · month_name · salesperson ·
region · city · channel · product · category · qty · unit_price · discount_pct ·
gross_total · net_total`

> **`net_total` is the revenue.** Never use `gross_total`.

**`demo.vw_salesperson_performance`** — target vs actual, **rolling 30-day window**
`salesperson · home_region · months_tenure · actual_revenue · planned_target ·
variance · attainment_pct · orders · avg_order_value · avg_discount_pct · status`

> A rolling window, not a calendar month: month-to-date holds anywhere from 1 to
> 31 days depending on when the question is asked. Early in the month the ranking
> turns into statistical noise and the worst salesperson shows up in first place.
> 30 running days give the same reading on any date.

### What the database does not have

Inventory, customer records, cost, margin, returns, pipeline.

The prompt forces the agent to **name the gap before any number** and to offer
the closest substitute while saying that it is a substitute. Without that rule,
"which product is sitting in inventory?" got a confident answer that quietly
swapped "sitting in inventory" for "sold little". A plausible answer on a false
premise is the worst possible error here.

---

## The agent

The model is set by `OPENAI_MODEL` in the `.env` (there is a default in the
code, so if the variable disappears nothing breaks). Two tools, and only two:

| Tool | What it does |
|---|---|
| `query_data(sql)` | runs SELECT/WITH against the views |
| `create_chart(type, title, format, items)` | returns the URL of a PNG |

Chart types: `donut`, `horizontal_bar`, `vertical_bar`, `gauge`.
The gauge takes a single item and always comes before the bars.

**Answer format:** four blocks — a headline carrying the insight (not the
subject), two lines of analysis, 3 to 4 bullets, a recommendation. At most two
emojis, one in the headline and one in the action.

**The contract guard.** Before the loop accepts a final answer, it checks what
the agent *did*: at least two queries, a breakdown, and a chart of that
breakdown. Anything missing and it pushes the agent back to work, at most twice.
This is rule 2, not routing — it never looks at the words of the question, only
at the agent's own process. The wording of the demand lives in
`missingFromContract()` in `src/agent.mjs`.

**Cost:** each question turns into 3 to 6 model calls. Measure your real cost
with `ask.mjs`, which prints the cost per run, and tune the model in
`OPENAI_MODEL` to fit your budget.

---

## Environment variables (`.env`)

These are the names the code reads. Renaming one here means renaming it in the
module that uses it and in the Netlify dashboard too.

```dotenv
# ---------- Database (Supabase) ----------
# Read-only user, with SELECT only on the views. Never use the superuser.
# A password with @ : / ? # breaks the URL — use percent-encoding (# becomes %23, @ becomes %40).
SUPABASE_DB_URL=postgresql://<user>:<password>@<host>:<port>/postgres

# Administrator connection, used ONLY by db/scripts/db_setup.py to build the database.
# On Supabase this is the `postgres` user. The agent never sees it.
SUPABASE_DB_ADMIN_URL=postgresql://postgres:<password>@<host>:5432/postgres
# The password db/04_role.sql gives the read-only user.
AGENT_DB_PASSWORD=<strong-password>

# ---------- AI model ----------
OPENAI_API_KEY=<your-key>
# Optional: swaps the model without touching the code.
OPENAI_MODEL=<model>

# ---------- Meta Cloud API (WhatsApp) ----------
# A secret phrase YOU make up and repeat in Meta's webhook dashboard.
WHATSAPP_VERIFY_TOKEN=<secret-phrase>
# A SYSTEM USER token (Business Manager), not the temporary one from the "Try it" screen.
WHATSAPP_ACCESS_TOKEN=<permanent-token>
# IDs from the "Step 1. Try it" screen in Meta for Developers.
WHATSAPP_PHONE_NUMBER_ID=<phone-number-id>
WHATSAPP_WABA_ID=<business-account-id>
# Your number in international format without the + (e.g. 5511999999999).
MY_NUMBER=<your-number>

# ---------- Optional, recommended in production ----------
# The App Secret of the app on Meta. Validates that the POST really came from Meta.
WHATSAPP_APP_SECRET=
```

> The same variables have to exist **twice**: in the local `.env` (which the
> scripts read) and in the Netlify dashboard under *Site configuration →
> Environment variables* (which the production functions read). They do not talk
> to each other — change one place, change the other and redeploy.

---

## Commands

```bash
npm install          # the agent (Node)
uv sync              # the database scripts (Python)

# Build the database: schema, data, views, read-only user
python db/scripts/db_setup.py
python db/scripts/db_check.py

# A question in the terminal, showing the SQL the agent wrote and the cost
node ask.mjs "which city sells the most?"

# Question → agent → WhatsApp (uses MY_NUMBER from the .env)
node scripts/send_test.mjs "who's selling badly"

# Shows the database refusing writes and reads outside the views
node scripts/permission_proof.mjs

# Sanity: database + the chart types
node scripts/smoke.mjs
```

---

## Known pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `403 (#131005) Access denied` when sending, while reading works | The temporary token from the "Try it" screen is a **user** token: Meta accepts reads from anywhere and refuses writes coming from a datacenter | A **System User** token, with `whatsapp_business_messaging` and `whatsapp_business_management` |
| Database connection error (password) | A password with special characters (`# @ : / ?`) breaks the URL | Percent-encoding: `#` becomes `%23`, `@` becomes `%40` |
| Database connection refused | Wrong port/host | A direct connection uses port 5432 (host `db.<ref>.supabase.co`); the pooler uses 6543 (host `...pooler.supabase.com`, user `<user>.<ref>`). In serverless, prefer the pooler |
| The webhook answers 200 and nothing happens | The delegating `fetch` has no `await`: the runtime freezes on return and the request never goes out | Keep the `await` on the delegation |
| The webhook receives, but nothing arrives on the phone | The 24h window is closed | The owner has to send a message first. In the normal flow this is automatic: they always ask something first |
| Production answers "no database access" | An out-of-date variable in the Netlify dashboard | Update `SUPABASE_DB_URL` in Netlify and **redeploy** |
| Error `#131030` when sending | The destination number is not authorized | Add your number to Meta's test list |
| A number shows up twice in the donut | QuickChart v4 turns `datalabels` on by default | Already turned off in `charts.mjs` |
| The gauge does not render | QuickChart only draws a gauge on Chart.js **v2** | The `gauge` uses `v=2`; the others use `v=4` |
| An absurd drop on a question about "this month" | Comparing a partial month against a whole previous month | The same-size window rule, in the prompt |
| Double asterisks show up in the message | The model used Markdown | `toWhatsApp()` normalizes it |

---

## Current limits

- **No memory.** Every message is independent. "And Bruno?" works because the
  name is in the data; "and him?" as a follow-up gets lost.
- **No deduplication.** If Meta resends a webhook, the agent answers twice. It
  rarely happens because the `200` goes out fast.
- **Meta's test number:** talks to up to 5 authorized recipients. A production
  number of your own requires business verification and publishing the app.
- **Meta's message cost:** the free-form answer inside the 24h window may be
  charged depending on the policy in force and the country. Check Meta's current
  table before going to production.

---

## Adapting it to your own scenario

If you go beyond the demo and wire the agent to your own data, this is what you
touch:

1. **The connection string** (`SUPABASE_DB_URL`): point it at your database and
   at a **read-only** user you created.
2. **The views** (`db/03_views.sql`): swap in your own. The agent reads the
   column names from your database — keep the names clear. If you change the
   columns, update the description of the views in this file, because this is
   where the agent learns the domain.
3. **The "What the database does not have" section**: list what YOUR database
   does not cover. It is what stops the agent from inventing an answer for
   something that does not exist.
4. **The system prompt** (`src/agent.mjs`): adjust the business context, the
   names of salespeople/regions/products and the tone of the answer.
5. **The regression questions** (rule 3 above): swap in the two questions that
   best represent your case, and use them whenever you touch the prompt.
6. **The model** (`OPENAI_MODEL`): pick it by cost and quality. Measure with
   `ask.mjs`.

> The golden rule when adapting: **the behavior lives in the prompt and in the
> data, not in `if`s.** If the agent gets something wrong, fix the description of
> the views or the system prompt — never build keyword routing.

---

## Next steps (ideas)

- [ ] Memory per phone number
- [ ] Deduplication by `message_id`
- [ ] New chart types
- [ ] Proactive alerts (the agent speaks up without being asked)
