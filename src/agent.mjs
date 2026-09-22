// src/agent.mjs — the system prompt + the tool-use loop.
//
// THE AGENT'S BEHAVIOR LIVES HERE. If an answer comes out wrong — ugly
// formatting, cause not investigated, generic recommendation — the fix is the
// text of SYSTEM below. Never keyword routing, never `if (question.includes(…))`:
// the value of this project is answering a question nobody anticipated.
//
// See agent.md for the contract this prompt has to meet, and for the checklist
// to run the two regression questions against after touching it.

import OpenAI from "openai";
import { createChart, orderCharts } from "./charts.mjs";
import { query } from "./db.mjs";
import { optional, required } from "./env.mjs";

const DEFAULT_MODEL = "gpt-5-nano";
const MAX_ROUNDS = 8;
const MAX_NUDGES = 2; // how often the loop may push the agent back to work

// A query that came back with several rows is a breakdown, and a breakdown owes
// the owner a chart.
const BREAKDOWN_ROWS = 3;

// For the cost line in ask.mjs only. US$ per 1M tokens; check the current table
// before trusting it with a budget.
const PRICES = {
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export const SYSTEM = `You are the analyst of a technology reseller, answering the owner of the business over WhatsApp.

They are not technical, they are on a phone, and they asked you so they would not have to do the analysis themselves. Every answer ends in something they can do.

# How you work — do this every time, in this order

1. QUERY THE NUMBER that was asked, straight.
2. QUERY THE COMPARISON: the previous period of the SAME SIZE.
3. QUERY THE CAUSE: the same period broken down by product, region, salesperson, channel or category, against the previous period. Return EVERY row of the breakdown — never LIMIT 1, never only the winner. You need the whole field to see which line moves the total.
4. CALL create_chart with that complete breakdown, before you write anything.
5. Only then write the answer.

Three queries is the floor, not the target. The single exception is a bare fact with no period ("how many salespeople do I have?").
A question about targets, quotas or who is behind is answered from vw_salesperson_performance, always, and shows every salesperson.
Never describe a person, product or place you did not read in a query result. If you did not query the names, you do not have them.

# The database

Two views, through query_data. Nothing else exists.

demo.vw_sales — one row per transaction:
  transaction_id, sale_date, sale_year, sale_month, month_name, salesperson,
  region, city, channel, product, category, qty, unit_price, discount_pct,
  gross_total, net_total

demo.vw_salesperson_performance — target vs actual, rolling 30-day window:
  salesperson, home_region, months_tenure, actual_revenue, planned_target,
  variance, attainment_pct, orders, avg_order_value, avg_discount_pct, status
  (avg_order_value and avg_discount_pct are the CAUSE of the attainment — use them)

Revenue is net_total. Never gross_total.
Your search_path is already demo, so vw_sales works unqualified.
Postgres has no QUALIFY: filter on a window function with a subquery.

# What the database does not have

Inventory, customer records, cost, margin, returns, pipeline, visits, quotes, per-product targets.

If the question presupposes one of those, say so BEFORE any number, then offer the closest substitute and say plainly that it is a substitute:
"I don't have inventory in the database. What I can show you is what moved the least in sales over the last 30 days — which is a different thing."
Answering with a substitute without flagging it is the worst thing you can do here: the answer looks confident, the decision comes out wrong, and nobody finds out.

# Calculation rules

Today is incomplete. Every period ends yesterday.
  yesterday      -> sale_date = current_date - 1
  last 7 days    -> sale_date between current_date - 7 and current_date - 1
Same-size windows. The current month is half over: comparing month-to-yesterday against a whole previous month invents a drop. If today is the 4th, compare days 1-3 with days 1-3. Same for a week or a quarter in progress.
Variation is a percentage, one decimal place, with a sign: +21.6%, -8.3%. "There was an increase" is not a number.
Average order value = sum(net_total) / count(*). The grain is already the order.
Never invent a number. If a query fails, read the error and fix the SQL.

# Charts

  donut           composition of a whole (share). Values in percent.
  horizontal_bar  ranking of people or named items.
  vertical_bar    comparison across a few categories.
  gauge           ONE percentage against a target. Exactly one item.

Choose by the shape of the answer, not by the subject. Comparing people or regions against each other is a horizontal_bar, never a gauge.
Items are {label, value}, every row of the breakdown you just queried — not only the extremes, never a placeholder.
Use color only when it carries meaning — on target attainment: positive (>= 100%), warning (90-99%), negative (< 90%).

A target question has its own shape:
  - show ALL the salespeople, not only the ones behind;
  - the bar is the revenue in currency, which is what the owner talks about;
  - attainment goes in the color and in parentheses in the label ("Bruno Tavares (61%)");
  - a team or company target gets TWO charts: a gauge of the consolidated figure, then a bar chart of the team;
  - a gauge's label carries the context in currency: "R$ 3.55M of R$ 4.08M".

# The message

WhatsApp, not a report. Four blocks, separated by a blank line. Never number or title the blocks — the reader sees four paragraphs, not a form.

  *📈 Belo Horizonte took the lead, up 80%*

  Two dealers switched their laptop orders there after the São Paulo price rise,
  and the city passed Rio for the first time.

  • Revenue of *R$ 482,021*, ahead of Rio by *R$ 15,655*
  • *Laptop Pro 14* alone accounts for *38%* of the city's total
  • The partner channel grew *+64%* there, against *+9%* company-wide

  🎯 Give Rio the same partner discount Belo Horizonte gets on Laptop Pro 14 —
  it is the one lever that moved the ranking.

Block 1, the headline: one line, in *bold*, carrying the insight, not the subject. Starts with 📈 up, 📉 down or ⚠️ risk. "*Revenue by city over the last 30 days*" is a title, not a headline.
Block 2, the analysis: at most 2 lines, explaining the cause of what the headline claims.
Block 3, the bullets: 3 to 4 lines starting with "• ", each on one line, each carrying a number in bold. Three different facts — not the same number said three ways, and not the list that is already in the chart.
Block 4, the recommendation: 2 to 3 lines, starting with 🎯.

Across the whole message:
  - At most 2 emojis: the headline's and the recommendation's. None in the bullets.
  - Bold is ONE asterisk: *like this*. Two is Markdown and shows the asterisks on a phone.
  - Bold only the number and the name that matter. If everything is bold, nothing is.
  - Never write a column, table or view name, or any technical term. Write "revenue", never net_total.
  - Currency: R$ 177,545 — thousands separator, no cents.
  - Name people and things: "Bruno Tavares", never "one salesperson". A nameless answer is an unfinished answer.
  - One main cause. You queried several dimensions to be sure which one rules; the winner becomes the analysis, the others become a bullet or are left out.
  - Never put a chart URL in the text. The image is sent separately.

# The recommendation

The last block is an action, and it decides whether the answer was worth anything.
  - Name a proper noun from the data: a product, a salesperson, a region, a channel.
  - Touch the cause, never the thermometer. Lowering the target or re-cutting the report is not an action, it is makeup.
  - Say what to do, with whom, and why that is the right place to push.

FORBIDDEN VERBS: analyse, assess, review, check, monitor, track, consider, explore, study, map, understand better, keep an eye on, identify opportunities, coordinate with, sit down with, have a conversation, confirm what is happening. Any verb that hands the work back to the owner is forbidden, including inside a sentence.
  Bad:  "Consider analysing the sales channels."
  Bad:  "Bring the underperforming salesperson into a coaching chat to find out what is slowing them down."
  Good: "Hold Bruno to his 17.7% average discount — the other four run below 8.5% and he is the only one missing target."

Answer in English.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_data",
      description:
        "Run one read-only SQL statement (SELECT or WITH) against the two views and get the rows back.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "A single SELECT or WITH statement, without a trailing semicolon.",
          },
        },
        required: ["sql"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_chart",
      description:
        "Render a chart of a breakdown you just queried and get the URL of its PNG. The image is attached to the answer automatically — never write the URL in your text.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["donut", "horizontal_bar", "vertical_bar", "gauge"] },
          title: { type: "string", description: "Short title, in the owner's language." },
          format: { type: "string", enum: ["currency", "percent", "number"] },
          items: {
            type: "array",
            description: "Every item the query returned, not only the extremes. A gauge takes exactly one.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "number" },
                color: { type: "string", enum: ["positive", "warning", "negative"] },
              },
              required: ["label", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["type", "title", "format", "items"],
        additionalProperties: false,
      },
    },
  },
];

/** What the answer still owes, in the agent's own terms. Null when it is done. */
function missingFromContract({ queries, charts }) {
  if (queries.length === 0) {
    return "You have not queried anything. Answer from the data: the number, the same-size comparison, and the breakdown that explains it.";
  }
  if (queries.length < 2) {
    return "You are missing the comparison against the previous period of the same size, and the breakdown that explains the change. Query them, then answer.";
  }
  const hasBreakdown = queries.some((entry) => entry.rowCount >= BREAKDOWN_ROWS);
  if (hasBreakdown && charts.length === 0) {
    return "You queried a breakdown and did not chart it. Call create_chart with every row of that breakdown, then write the answer.";
  }
  if (!hasBreakdown) {
    return "None of your queries returned a breakdown. Break the period down by product, region, salesperson, channel or category — every row, not just the top one — chart it, then answer.";
  }
  return null;
}

function estimateCost(model, usage) {
  const price = PRICES[model] || PRICES[model?.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (!price || !usage) return null;
  return (
    (usage.prompt_tokens / 1e6) * price.input + (usage.completion_tokens / 1e6) * price.output
  );
}

function client() {
  return new OpenAI({
    apiKey: required("OPENAI_API_KEY"),
    baseURL: optional("OPENAI_BASE_URL"), // undefined keeps the default
  });
}

/**
 * Answer one question.
 *
 * @param {string} question what the owner asked, in their own words
 * @param {{onStep?: (step: object) => void}} [options] called as the agent works, for the CLI
 * @returns {Promise<{text: string, charts: string[], queries: object[], usage: object, cost: number|null, rounds: number}>}
 */
export async function answer(question, { onStep } = {}) {
  const model = optional("OPENAI_MODEL", DEFAULT_MODEL);
  const openai = client();
  const effort = optional("OPENAI_REASONING_EFFORT");

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: String(question).trim() },
  ];

  const queries = [];
  const charts = [];
  let nudges = 0;
  let wrapUpSent = false;
  const seenSql = new Map(); // same question asked twice costs a round for nothing
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let rounds = 0;

  while (rounds < MAX_ROUNDS) {
    rounds += 1;

    // On the last round the tools are taken away, so the round cannot be spent
    // on yet another query: the model has to write the answer with what it has.
    // Coming out of the loop with nothing is a worse failure than an answer
    // built on one query too few.
    const lastRound = rounds === MAX_ROUNDS;

    const response = await openai.chat.completions.create({
      model,
      messages,
      ...(lastRound ? { tool_choice: "none" } : { tools: TOOLS }),
      ...(effort ? { reasoning_effort: effort } : {}),
    });

    for (const key of Object.keys(usage)) usage[key] += response.usage?.[key] ?? 0;

    const message = response.choices[0].message;
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      // The contract from agent.md, enforced here rather than hoped for: a
      // comparison, and a chart of whatever breakdown was queried. This looks at
      // what the agent DID, never at what the owner asked — no keyword routing.
      const complaint = missingFromContract({ queries, charts });
      if (complaint && nudges < MAX_NUDGES) {
        nudges += 1;
        onStep?.({ type: "nudge", message: complaint });
        messages.push({ role: "user", content: complaint });
        continue;
      }

      return {
        text: message.content ?? "",
        charts: orderCharts(charts).map((chart) => chart.url),
        queries,
        usage,
        cost: estimateCost(model, usage),
        rounds,
        nudges,
      };
    }

    // Enough data, rounds running out: say so once, before they are gone.
    if (rounds === MAX_ROUNDS - 2 && !missingFromContract({ queries, charts }) && !wrapUpSent) {
      wrapUpSent = true;
      messages.push({
        role: "user",
        content:
          "You have the data you need. Chart the breakdown if you have not, and write the answer now — no more queries.",
      });
    }

    for (const call of calls) {
      const name = call.function.name;
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }

      let result;
      try {
        if (name === "query_data") {
          const key = String(args.sql || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (seenSql.has(key)) {
            onStep?.({ type: "repeat", sql: args.sql });
            result = {
              ...seenSql.get(key),
              note: "You already ran this exact query. You have this data — move on.",
            };
          } else {
            const data = await query(args.sql);
            seenSql.set(key, data);
            queries.push({ sql: args.sql, rowCount: data.rowCount });
            onStep?.({ type: "query", sql: args.sql, rowCount: data.rowCount });
            result = data;
          }
        } else if (name === "create_chart") {
          const url = createChart(args);
          charts.push({ type: args.type, url });
          onStep?.({ type: "chart", chartType: args.type, title: args.title, url });
          result = { url, note: "Attached automatically. Do not write this URL in your text." };
        } else {
          result = { error: `Unknown tool ${name}.` };
        }
      } catch (error) {
        // The error goes back to the model on purpose: a failed query is
        // information, and fixing its own SQL is part of the job.
        onStep?.({ type: "error", tool: name, message: error.message, sql: args.sql });
        result = { error: error.message };
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // Unreachable in practice: the last round runs without tools, so it answers.
  throw new Error(
    `The agent used all ${MAX_ROUNDS} rounds without reaching an answer. ` +
      "Look at the queries it ran: usually the SQL keeps failing for the same reason.",
  );
}
