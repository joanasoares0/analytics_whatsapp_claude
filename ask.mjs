#!/usr/bin/env node
// ask.mjs — ask a question from the terminal, no WhatsApp involved.
//
//   node ask.mjs "what was my revenue yesterday?"
//
// Prints the SQL the agent wrote, the charts it chose and what the run cost.
// This is the regression harness: after touching the prompt in src/agent.mjs,
// run both of these and check the output against the checklist in agent.md.
//
//   node ask.mjs "what was my revenue yesterday?"
//   node ask.mjs "who's selling badly"

import { answer } from "./src/agent.mjs";
import { close } from "./src/db.mjs";
import { exitScript } from "./src/env.mjs";
import { toWhatsApp } from "./src/whatsapp.mjs";

const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const OFF = "\u001b[0m";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: node ask.mjs "what was my revenue yesterday?"');
  process.exit(1);
}

const compact = (sql) => sql.replace(/\s+/g, " ").trim();

function onStep(step) {
  if (step.type === "query") {
    console.log(`${DIM}sql${OFF}   ${compact(step.sql)}`);
    console.log(`${DIM}      ${step.rowCount} row(s)${OFF}`);
  } else if (step.type === "chart") {
    console.log(`${DIM}chart${OFF} ${step.chartType} — ${step.title}`);
  } else if (step.type === "error") {
    console.log(`${DIM}error${OFF} ${step.tool}: ${step.message}`);
    if (step.sql) console.log(`${DIM}      ${compact(step.sql)}${OFF}`);
  } else if (step.type === "repeat") {
    console.log(`${DIM}repeat${OFF} same query again — served from the first run`);
  } else if (step.type === "nudge") {
    console.log(`${DIM}nudge${OFF} ${step.message}`);
  }
}

const started = Date.now();

try {
  const result = await answer(question, { onStep });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n${BOLD}${toWhatsApp(result.text)}${OFF}\n`);

  for (const url of result.charts) console.log(`${DIM}image${OFF} ${url}`);

  const cost = result.cost === null ? "unknown price for this model" : `US$ ${result.cost.toFixed(4)}`;
  console.log(
    `\n${DIM}${result.rounds} round(s) · ${result.queries.length} quer${result.queries.length === 1 ? "y" : "ies"} · ` +
      `${result.charts.length} chart(s) · ${result.usage.total_tokens} tokens · ${cost} · ${seconds}s${OFF}`,
  );
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await close();
  await exitScript(process.exitCode ?? 0);
}
