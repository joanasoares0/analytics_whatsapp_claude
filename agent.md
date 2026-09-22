# The agent — what it analyses and what it draws

Reference for the analysis agent's behavior. What is written here is what the
`SYSTEM` prompt in [`src/agent.mjs`](../src/agent.mjs) demands, not an
intention. Changed the behavior? Change the prompt and update this file.

There is no routing: no `if question.includes(...)` anywhere. The agent gets two
tools and the database context, and decides the SQL and the chart on its own. It
is that absence of rules that lets it answer a question nobody anticipated.

---

## The contract

Every answer delivers, in this order: **number → comparison → cause → action**.

A number without a comparison does not say whether it is good. A comparison
without a cause does not produce a decision. A cause without an action hands the
work back to the owner — who asked precisely so they would not have to do the
analysis.

---

## The two tools

| Tool | Signature | Limit |
|---|---|---|
| `query_data` | `(sql)` | One `SELECT` or `WITH` statement, no `;`. The two views only. |
| `create_chart` | `(type, title, format, items[])` | Returns the URL of a PNG. `type` ∈ donut, horizontal_bar, vertical_bar, gauge. `format` ∈ currency, percent, number. |

At most 8 turns around the loop. One question costs 3 to 6 model calls,
US$ 0.010 to 0.024.

---

## Mandatory process — three queries, never fewer than two

**1. The number.** What was asked, straight.

**2. The comparison.** Against the previous period of the **same size**, as a
percentage, one decimal place, with a sign: `+21.6%`, `-8.3%`.
"There was an increase" is not a number.

**3. The cause.** Its own query, mandatory. Break the period down by product,
region, salesperson or channel, compare against the previous period, and find
**which line moves the total**.

The only question that escapes the three is one about a single fact with no
period — "how many salespeople do I have?".

---

## Catalogue of analyses

| The owner's question | Queries the agent runs | Where the cause usually is | Chart |
|---|---|---|---|
| "yesterday's revenue" | yesterday's total · the day before's total · breakdown by channel, region and category on both days | the single line that moves the total | bar chart of the breakdown |
| "who is selling badly" | the whole `vw_salesperson_performance` · average discount and average order value for those who hit target vs those who did not | a salesperson who sells a lot and still falls behind is almost always discounting too hard or selling cheap items | horizontal_bar with **all** the salespeople |
| "did we hit target?" | company-wide consolidated · breakdown by salesperson | who is dragging it down | **two**: a gauge of the consolidated figure, then a bar chart of the team |
| "the city or region that sells the most" | ranking for the period · the same ranking for the previous period | who moved up or down the ranking | horizontal_bar |
| "each channel's share" | share for the period · share for the previous period | a shift in the mix | donut in percent, ≤ 8 slices |
| "has my average order value dropped?" | average order value for the period vs the previous one · **product mix**, not order volume | the category whose weight changed | vertical_bar |
| "last 7 / 30 days" | the window · the previous window of the same size · the breakdown | the dimension that explains the delta | follows the shape of the breakdown |

---

## Calculation rules

- **Today is incomplete. Every period ends yesterday.**
  `yesterday` → `sale_date = current_date - 1`
  `last 7 days` → `between current_date - 7 and current_date - 1`
- **Revenue is `net_total`.** Never `gross_total`.
- **Average order value** = `sum(net_total) / count(*)`. The grain is already
  the order.
- **Same-size windows.** The current month is half over: comparing "month up to
  yesterday" against the whole previous month produces a drop that does not
  exist. It is the easiest mistake to make. If today is the 4th, compare days
  1–3 with days 1–3. The same holds for a week or a quarter in progress.
- **Never invent a number.** If it needs the data, it queries. If the query
  fails, it reads the error and fixes the SQL.
- Postgres has no `QUALIFY`: to filter on a window function, use a subquery.

---

## What the database does not have

Inventory, customer records, cost, margin, returns, pipeline, visits, quotes,
per-product targets.

If the question presupposes one of those, the agent **names the gap before any
number** and offers the substitute while saying it is a substitute:

> "I don't have inventory in the database. What I can show you is what moved
> the least in sales over the last 30 days — which is a different thing."

Answering with a substitute without flagging it is the gravest possible error:
the answer comes out confident, plausible, the decision comes out wrong, and
nobody finds out, because the number looked right.

---

## The four charts

**Hard rule:** queried a breakdown to explain the number? **Send the chart of
that breakdown.** No weighing it up, no asking. The only answer that goes
without a chart is a single number with no breakdown behind it — and that is
rare.

The breakdown goes out **complete**, with every item the query returned, even
if the text only mentions the two extremes. The text points at the culprit; the
chart shows the whole field and lets the owner draw their own conclusion.

| Type | When | Rules |
|---|---|---|
| `donut` | composition of a whole (share, participation) | max 8 slices, the rest becomes "Other"; values in `percent` |
| `horizontal_bar` | ranking of people or named items | sorted by value, largest on top |
| `vertical_bar` | comparison across a few categories | sorted by value |
| `gauge` | **one** percentage against a target | exactly 1 item, value in percent (87 = 87%); the label carries the context in currency: "R$ 3.55M of R$ 4.08M" |

The choice follows the **shape of the answer**, not the subject.

Comparing people or regions against each other **is not a gauge** — it is a
horizontal_bar. A gauge with several items does not exist.

**Sorting:** always by the bar's value, largest to smallest. A bar chart out of
order makes the reader look for a pattern that is not there. The only time to
break this rule is when the order itself means something — chronology, for
example.

**Colors** (the `color` field, use it only when the color means something):

| Attainment | Color |
|---|---|
| ≥ 100% | `positive` |
| 90% to 99% | `warning` |
| < 90% | `negative` |

### A target question has a shape of its own

- Show **all** the salespeople, not just the ones behind. The ones doing well
  are the reference that gives the problem its size.
- The bar is the **revenue in currency** — that is what the owner talks about.
- Attainment goes in the **color** and in parentheses in the label. That way the
  same image answers both "how much did they sell" and "did they hit target?".
- A team or company target → **two charts**: a gauge of the consolidated figure
  ("are we doing well?"), then a bar chart of the team ("who is dragging?").

### Forbidden in a chart

- An item with sample data, a placeholder or an invented number to be filled in
  later. Items **always** come out of a query just run. A wrong image is worse
  than no image: the owner reads the text carefully, but the chart they simply
  believe.
- **The chart URL in the body of the answer.** The image goes as an attachment,
  separately. A link in the middle of the message is junk on a phone screen.

---

## Answer format

This is WhatsApp, not a report. Nobody reads long flowing text on a phone — the
eye needs steps to walk down. Four blocks, separated by a blank line:

**1. Headline** — one line, in `*bold*`, carrying the **insight**, not the
subject. Starts with a directional emoji: 📈 up, 📉 down, ⚠️ risk.

> Bad: `*Revenue by city over the last 30 days*` ← that is a title
> Good: `*Belo Horizonte took the lead, up 80%*`

**2. Analysis** — at most 2 lines, explaining the cause of what the headline
claims. This is where it answers "why".

**3. Bullets** — 3 to 4 bullets, one per line, starting with `• `. Each fits on
a single line and carries a number in bold. They are the facts that hold the
headline up — not a repetition of it, nor the whole list that is already in the
chart.

**4. Recommendation** — 2 to 3 lines, starting with 🎯.

Holding for the whole message:

- **At most 2 emojis**: the headline's and the recommendation's. None in the
  bullets. Too many emojis turn an analysis into a social media post and sink
  the reader's trust.
- **Bold is ONE asterisk**: `*like this*`. Two is Markdown and shows up with the
  asterisks visible on a phone. `toWhatsApp()` normalizes it, but the prompt
  demands it too.
- Bold only on the number and the name that matter. If everything is bold,
  nothing is.
- **Never write a column, table or view name, or any technical term.** Write
  "revenue", never `net_total`. The owner does not know what a column is, and
  should not have to.
- Currency values: `R$ 177,545` — thousands separator, no cents.
- **One main cause.** It queried several dimensions to be sure which one rules;
  the winner becomes the analysis, the others become a bullet or are left out.

---

## The recommendation — the most important part

The last line is an action, and it is what decides whether the answer was worth
anything.

- **Name a proper noun coming from the data**: a product, a salesperson, a
  region, a channel. A recommendation with no proper noun is too generic — a
  query is missing.
- **Touch the cause, never the thermometer.** Lowering the target, changing the
  criterion or re-cutting the report is not an action, it is makeup.
- Say what to do, with whom, and why that is the right spot to push.

**Forbidden verbs:** analyse, assess, review, check, monitor, track, consider,
explore, study, map, understand better, keep an eye on, identify opportunities.

The rule behind it: any verb that hands the work back to the owner is forbidden.
That holds inside the sentence too — "sit down with Bruno and review his book"
is still forbidden.

> Bad: "Consider analysing the sales channels."
>
> Good: "Hold Bruno to his 17.7% average discount — the other four run below
> 8.5% and he is the only one missing target."

---

## How to validate a change

The model is non-deterministic: one good run proves nothing, two bad ones prove
a lot. After touching the prompt, run both:

```bash
node ask.mjs "what was my revenue yesterday?"
node ask.mjs "who's selling badly"
```

Checklist of what to look at in the output:

- [ ] Three queries or more, one of them the breakdown that explains the cause
- [ ] The variation as a percentage, with a sign and one decimal place
- [ ] Same-size windows in the comparison
- [ ] A chart generated when there was a breakdown, with every item, sorted
- [ ] A headline with an insight, not a subject
- [ ] No column name in the text
- [ ] A recommendation with a proper noun and no forbidden verb
- [ ] No URL in the body of the message
