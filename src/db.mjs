// src/db.mjs — Postgres access. SELECT only, with retry.
//
// Reads SUPABASE_DB_URL from .env. The database user holds SELECT on the two
// views and nothing else, so read-only is a permission, not something this
// module enforces — what it adds is a second, cheaper wall: obviously wrong SQL
// is refused here, before it costs a round trip.

import pg from "pg";
import { optional, required } from "./env.mjs";

const STATEMENT_TIMEOUT_MS = 15_000;
const MAX_ROWS = 200; // what goes back to the model, not what the query may scan
const RETRIES = 2;

// One statement, reading. Anything else is a bug in the agent's SQL, or worse.
const ALLOWED_START = /^\s*(select|with)\b/i;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum)\b/i;

// node-postgres hands numeric and bigint back as strings, to protect precision
// it does not need here: these are money and counts well inside a float. Parsing
// them keeps the JSON the model reads (and the chart values) clean.
pg.types.setTypeParser(1700, Number.parseFloat); // numeric
pg.types.setTypeParser(20, Number.parseInt); // int8

let pool;

function getPool() {
  if (pool) return pool;
  const connectionString = required("SUPABASE_DB_URL");
  pool = new pg.Pool({
    connectionString,
    // Supabase always serves over TLS; its certificate chain is not in Node's
    // trust store, hence the relaxed check on an otherwise encrypted link.
    ssl: connectionString.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    max: Number(optional("PGPOOL_MAX", "3")),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
  return pool;
}

/** Reject anything that is not a single read, before it reaches the database. */
export function checkSql(sql) {
  const trimmed = String(sql || "").trim().replace(/;\s*$/, "");
  if (!trimmed) throw new Error("Empty SQL.");
  if (!ALLOWED_START.test(trimmed)) throw new Error("Only SELECT or WITH statements are allowed.");
  if (trimmed.includes(";")) throw new Error("One statement at a time, without ';'.");
  if (FORBIDDEN.test(trimmed)) throw new Error("This query tries to write. The agent reads only.");
  return trimmed;
}

const isTransient = (error) =>
  ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "57P01", "53300", "08006", "08003"].includes(
    error.code,
  );

/**
 * Run one read query and return its rows.
 * Retries the failures that are worth retrying: a dropped connection, a
 * serverless cold start. A syntax error is not one of them.
 */
export async function query(sql) {
  const statement = checkSql(sql);

  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const result = await getPool().query(statement);
      return {
        rows: result.rows.slice(0, MAX_ROWS),
        rowCount: result.rowCount,
        truncated: result.rowCount > MAX_ROWS,
      };
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function close() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
