#!/usr/bin/env node
// scripts/smoke.mjs — sanity check: database + the four chart types.
//
// Queries both views and renders one chart of each type, printing the URLs.
// No model calls, so it is the cheapest way to tell whether the plumbing is
// alive before blaming the agent.

import { createChart } from "../src/charts.mjs";
import { close, query } from "../src/db.mjs";
import { exitScript } from "../src/env.mjs";

const ok = (label, detail) => console.log(`[  ok  ] ${label.padEnd(34)} ${detail}`);

try {
  const sales = await query("select count(*) as rows, round(sum(net_total), 2) as revenue from vw_sales");
  ok("vw_sales", `${sales.rows[0].rows} rows · R$ ${sales.rows[0].revenue.toLocaleString("en-US")}`);

  const performance = await query(
    "select salesperson, actual_revenue, attainment_pct from vw_salesperson_performance order by attainment_pct",
  );
  ok("vw_salesperson_performance", `${performance.rowCount} salespeople`);

  const worst = performance.rows[0];
  const items = performance.rows.map((row) => ({
    label: row.salesperson,
    value: row.actual_revenue,
    color: row.attainment_pct >= 100 ? "positive" : row.attainment_pct >= 90 ? "warning" : "negative",
  }));

  const charts = {
    gauge: createChart({
      type: "gauge",
      title: "Attainment",
      format: "percent",
      items: [{ label: `${worst.salesperson}`, value: worst.attainment_pct }],
    }),
    horizontal_bar: createChart({ type: "horizontal_bar", title: "Revenue by salesperson", format: "currency", items }),
    vertical_bar: createChart({ type: "vertical_bar", title: "Revenue by salesperson", format: "currency", items }),
    donut: createChart({ type: "donut", title: "Share by salesperson", format: "currency", items }),
  };

  for (const [type, url] of Object.entries(charts)) {
    const response = await fetch(url, { method: "GET" });
    const size = Number(response.headers.get("content-length") || 0);
    if (!response.ok) throw new Error(`${type}: QuickChart answered ${response.status}`);
    ok(type, `${response.headers.get("content-type")} · ${(size / 1024).toFixed(0)} kB`);
    console.log(`         ${url.slice(0, 110)}…`);
  }

  console.log("\nEverything checks out.");
} catch (error) {
  console.error(`\n[ FAIL ] ${error.message}`);
  process.exitCode = 1;
} finally {
  await close();
  await exitScript(process.exitCode ?? 0);
}
