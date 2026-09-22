#!/usr/bin/env node
// scripts/permission_proof.mjs — shows the database refusing.
//
// The agent reads two views and can do nothing else. That is not a promise made
// in a prompt, it is a grant in Postgres. This script demonstrates it by trying
// the things the agent must never be able to do, and printing each refusal.
//
// It bypasses the guard in src/db.mjs on purpose: the point is to hear the
// answer from the database itself.

import pg from "pg";
import { exitScript, required } from "../src/env.mjs";

const STATEMENTS = [
  ["read the two views", "select count(*) from demo.vw_sales", "allowed"],
  ["read the sales table directly", "select * from demo.sales limit 1", "refused"],
  ["insert a row", "insert into demo.sales (transaction_id) values ('x')", "refused"],
  ["update a row", "update demo.sales set qty = 0", "refused"],
  ["delete a row", "delete from demo.sales", "refused"],
  ["create a table", "create table demo.scratch (id int)", "refused"],
  ["read another schema", "select * from pg_shadow limit 1", "refused"],
];

const connectionString = required("SUPABASE_DB_URL");
const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

let failures = 0;

await client.connect();
console.log(`Connected as ${connectionString.split("//")[1].split(":")[0]}\n`);

for (const [label, statement, expected] of STATEMENTS) {
  let outcome;
  try {
    await client.query(statement);
    outcome = "allowed";
  } catch (error) {
    outcome = "refused";
    var reason = error.message.split("\n")[0];
  }
  const good = outcome === expected;
  if (!good) failures += 1;
  console.log(`[${good ? "  ok  " : " FAIL "}] ${label.padEnd(32)} ${outcome}`);
  if (outcome === "refused") console.log(`         ${reason}`);
}

await client.end();

console.log(
  failures === 0
    ? "\nThe wall holds: two views readable, everything else refused by the database."
    : `\n${failures} case(s) came out wrong. Re-run db/scripts/db_setup.py --only 04.`,
);
await exitScript(failures === 0 ? 0 : 1);
