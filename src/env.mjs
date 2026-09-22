// src/env.mjs — loads .env from the project root.
//
// The scripts read credentials from the .env file; the Netlify functions get
// the same names from the dashboard, where no .env exists. So loading it is
// best-effort: missing file, no error.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  const file = join(ROOT, ".env");
  if (existsSync(file)) dotenv.config({ path: file, quiet: true });
  loaded = true;
}

/** Read a variable, failing loudly when something required is missing. */
export function required(name) {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env at the project root (see .env.example), ` +
        "and to the Netlify dashboard for production.",
    );
  }
  return value;
}

export function optional(name, fallback = undefined) {
  loadEnv();
  return process.env[name] || fallback;
}

/**
 * End a command-line script.
 *
 * Closing the connection pool is not enough to return the prompt: the TLS
 * socket to Supabase (reached over IPv6, with an IPv4 attempt left behind) and
 * the keep-alive sockets of fetch outlive it, and a CLI that hangs after
 * printing its answer is a bug of its own. Waiting on stdout first so nothing
 * is cut off when the output is piped.
 */
export async function exitScript(code = 0) {
  await new Promise((resolve) => process.stdout.write("", resolve));
  process.exit(code);
}
