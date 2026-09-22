# Business Analysis over WhatsApp

The owner of a business sends a question in plain language over WhatsApp and
gets back a number, how it moved, **why** it moved, a recommendation and a
chart. An AI agent writes its own SQL and picks its own visualization. Nothing
runs on the owner's machine — the only app they need is the one already on
their phone.

```
 "who's selling badly"  ──►  📱 WhatsApp
                                  │
                                  ▼
        Meta Cloud API ──► webhook (answers 200 in ~2s, delegates)
                                  │
                                  ▼
                        background function
                                  │
                   ┌──────────────┼──────────────┐
                   ▼              ▼              ▼
               AI model       PostgreSQL     QuickChart
             writes the SQL    (2 views,       (PNG)
             picks the chart   read-only)
                                  │
                                  ▼
                              📱 answer + chart
```

## What an answer looks like

> 📉 *Bruno is at 61% of target while selling the most orders on the team*
>
> He closed 132 orders — more than anyone — but at an average discount of 17.7%,
> and his average order value is the lowest on the team.
>
> • Revenue of *R$ 584,228* against a target of *R$ 957,751*
> • Average discount of *17.7%*, while the other four stay under *8.5%*
> • Average order value of *R$ 4,426* vs *R$ 8,067* for Ana, who sells a similar
>   number of orders
>
> 🎯 Cap Bruno's discount at 10% on Peripherals, where he gives the most away.
> At his current volume, that closes roughly half the gap to target on its own.

Every number above comes out of the seeded database in this repo.

## Three decisions that shape the project

**The behavior lives in the prompt, not in `if`s.** There is no keyword routing
anywhere — no `if question.includes(...)`. The agent gets two tools and a
description of the database, and works out the SQL and the chart by itself.
That is what lets it answer a question nobody anticipated.

**The agent cannot write to the database, and that is a permission, not a
convention.** The database user holds `SELECT` on two read-only views and
nothing else. There is a script that proves it, by watching the database refuse.

**The demo data never ages.** The sales table stores `days_ago` (0 = today,
1 = yesterday) instead of a date; the real date is computed in the view as
`current_date - days_ago`. Run the seed today or a year from now and
"yesterday" is still yesterday, with the same numbers — no cron, no ingestion
job, nothing to re-record before a demo.

## Stack

Node · PostgreSQL (Supabase) · an OpenAI-compatible model · Netlify Functions ·
Meta Cloud API (WhatsApp) · QuickChart

## The data

A fictional technology reseller: 5 salespeople, 2,572 transactions over 180
days, R$ 17,966,842.11 in revenue. The agent only ever sees two views:

| View | Grain |
|---|---|
| `demo.vw_sales` | one row per transaction — date, salesperson, region, city, channel, product, category, quantity, unit price, discount, gross and net total |
| `demo.vw_salesperson_performance` | target vs actual on a rolling 30-day window, with average order value and average discount — the two columns that explain *why* someone is behind |

What the database deliberately does **not** have: inventory, customer records,
cost, margin, returns, pipeline. The agent is required to name the gap before
giving any number, and to say out loud when it is offering a substitute. A
plausible answer resting on a false premise is the worst failure this system
can produce.

## Getting started

Requirements: Node 18+, a PostgreSQL database (the demo uses Supabase), an API
key for an OpenAI-compatible model, and a WhatsApp number on the Meta Cloud API.

```bash
# 1. Credentials — fill in .env at the project root (see CLAUDE.md for every variable)
cp .env.example .env

# 2. Database — creates the schema, the data, the views and the read-only user.
#    It asks before each step that destroys data.
uv sync                        # or: pip install 'psycopg[binary]' python-dotenv
python db/scripts/db_setup.py
python db/scripts/db_check.py     # the numbers, and proof that the agent cannot write

# 3. Ask something from the terminal, no WhatsApp involved
npm install
node ask.mjs "what was my revenue yesterday?"
```

`db_setup.py` needs an administrator connection (`SUPABASE_DB_ADMIN_URL`); the
agent itself only ever gets `SUPABASE_DB_URL`, the read-only user the setup
creates. The SQL in `db/` also runs straight through `psql` if you prefer.

`ask.mjs` prints the SQL the agent wrote and what the run cost, which is the
fastest way to see it think.

Other commands:

```bash
node scripts/send_test.mjs "who's selling badly"  # question → agent → WhatsApp
node scripts/permission_proof.mjs                 # watch the database refuse writes
node scripts/smoke.mjs                            # sanity: database + chart types
```

## Project status

Work in progress. The schema, the seed and the two views (`db/01`, `db/02`,
`db/03`) run clean and their numbers are verified, and the agent's behavior is
fully specified in [`agent.md`](agent.md). Still to come: the read-only role
script (`db/04_role.sql`) and the Node implementation described above — `src/`,
`netlify/functions/`, `scripts/`. The commands in this README document the
target shape of the project rather than what you can run today.

## Known limits

- **No memory.** Each message stands alone. "And Bruno?" works because the name
  is in the data; "and him?" as a follow-up does not.
- **No deduplication.** If Meta resends a webhook, the agent answers twice.
- Meta's test number reaches up to 5 authorized recipients. A production number
  of your own requires business verification and publishing the app.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — how the project works end to end: architecture,
  layout, environment variables, known pitfalls, and how to adapt it to your
  own data.
- [`agent.md`](agent.md) — what the agent analyses and what it draws: the
  answer contract, the mandatory queries, the chart rules and the message
  format.
