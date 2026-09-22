#!/usr/bin/env node
// scripts/send_test.mjs — question → agent → WhatsApp.
//
//   node scripts/send_test.mjs "who's selling badly"
//
// The whole path, ending on the phone, using MY_NUMBER from .env. The 24h
// window has to be open: the owner must have sent a message first.

import { answer } from "../src/agent.mjs";
import { close } from "../src/db.mjs";
import { exitScript } from "../src/env.mjs";
import { myNumber, sendImage, sendText } from "../src/whatsapp.mjs";

const question = process.argv.slice(2).join(" ").trim();
const to = myNumber();

if (!question) {
  console.error('Usage: node scripts/send_test.mjs "who\'s selling badly"');
  process.exit(1);
}
if (!to) {
  console.error("Missing MY_NUMBER in .env — your number in international format, without the +.");
  process.exit(1);
}

try {
  console.log(`Asking: ${question}`);
  const result = await answer(question);

  await sendText(to, result.text);
  console.log(`Sent the answer to ${to}`);

  for (const url of result.charts) {
    await sendImage(to, url);
    console.log("Sent a chart");
  }

  console.log(`\n${result.queries.length} quer(ies) · ${result.charts.length} chart(s)`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await close();
  await exitScript(process.exitCode ?? 0);
}
