// netlify/functions/db-check.mjs — does production really reach the database?
//
// The two functions that matter answer Meta, not a browser: the webhook returns
// "ok" and the background one returns nothing at all. So when production says
// "no database access", there is nowhere to look. This endpoint is that place.
//
// It runs three read queries with the same SUPABASE_DB_URL the agent uses and
// reports what came back, including the refusal it gets on a base table — the
// permission wall, proven from the server rather than from a laptop.
//
//   GET /.netlify/functions/db-check?token=<WHATSAPP_VERIFY_TOKEN>
//
// Guarded by the verify token because it is a window onto the data. It never
// writes, and it never prints a credential.

import { createHash, timingSafeEqual } from "node:crypto";

import { query } from "../../src/db.mjs";

const digest = (value) => createHash("sha256").update(String(value)).digest();

function authorized(request) {
  const secret = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!secret) return false;
  const given = new URL(request.url).searchParams.get("token") ?? "";
  return timingSafeEqual(digest(given), digest(secret));
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (request) => {
  if (!authorized(request)) return json({ error: "Forbidden" }, 403);

  const started = Date.now();
  const report = {};

  try {
    const who = await query("select current_user as db_user, current_database() as db, version() as server");
    report.connection = {
      user: who.rows[0].db_user,
      database: who.rows[0].db,
      server: who.rows[0].server.split(" on ")[0],
    };

    const totals = await query(
      "select count(*) as transactions, round(sum(net_total), 2) as total_revenue from vw_sales",
    );
    report.vw_sales = totals.rows[0];

    const yesterday = await query(
      "select round(sum(net_total), 2) as revenue, count(*) as orders from vw_sales where sale_date = current_date - 1",
    );
    report.yesterday = yesterday.rows[0];

    const team = await query(
      "select salesperson, attainment_pct, status from vw_salesperson_performance order by attainment_pct limit 3",
    );
    report.worst_performers = team.rows;
  } catch (error) {
    return json({ ok: false, failed_at: "reading the views", error: error.message }, 500);
  }

  // The wall: the same credentials must be refused on the base table.
  try {
    await query("select * from demo.sales limit 1");
    report.permission_wall = "BROKEN — the agent's user can read the sales table";
  } catch (error) {
    report.permission_wall = `holds — ${error.message}`;
  }

  return json({ ok: true, ...report, elapsed_ms: Date.now() - started });
};
