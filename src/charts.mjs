// src/charts.mjs — Chart.js config → PNG URL from QuickChart.
//
// Four chart types: donut, horizontal_bar, vertical_bar, gauge.
// Two things are settled here and not left to the model: bars are sorted by
// value, largest first, and the gauge always comes before the bars. Asking for
// that in the prompt works most of the time, and most of the time is not enough.
//
// QuickChart notes: the gauge only renders on Chart.js v2 (`v=2`); the other
// three use v=4, where `datalabels` has to be turned off on the donut or every
// slice prints its number twice.

const QUICKCHART = "https://quickchart.io/chart";

export const CHART_TYPES = ["donut", "horizontal_bar", "vertical_bar", "gauge"];
export const FORMATS = ["currency", "percent", "number"];

const COLORS = {
  positive: "#2e9e68",
  warning: "#e0a000",
  negative: "#d1495b",
};

// Used when the agent does not colour the items itself, which is the usual case:
// colour is only meaningful when it carries a meaning.
const PALETTE = ["#3d6bbd", "#2e9e68", "#e0a000", "#d1495b", "#7b5ea7", "#0e8f9e", "#b06c3a", "#5a6b7b"];

const MAX_SLICES = 8; // the donut rule: everything past this becomes "Other"

// --- number formatting -------------------------------------------------------

export function formatValue(value, format) {
  const number = Number(value) || 0;
  if (format === "currency") return `R$ ${Math.round(number).toLocaleString("en-US")}`;
  if (format === "percent") return `${Number.isInteger(number) ? number : number.toFixed(1)}%`;
  return Math.round(number).toLocaleString("en-US");
}

// Chart.js callbacks have to reach QuickChart as real JavaScript, not as JSON
// strings. They go in as markers and are swapped back in after stringify.
const functions = [];
const fn = (source) => {
  functions.push(source);
  return `__FN_${functions.length - 1}__`;
};

function encodeConfig(config) {
  let json = JSON.stringify(config);
  functions.forEach((source, index) => {
    json = json.replace(`"__FN_${index}__"`, source);
  });
  functions.length = 0;
  return json;
}

const tickFormatter = (format) =>
  format === "currency"
    ? fn(
        "(v) => v >= 1e6 ? 'R$ ' + (v/1e6).toFixed(1) + 'M' : v >= 1e3 ? 'R$ ' + Math.round(v/1e3) + 'k' : 'R$ ' + v",
      )
    : format === "percent"
      ? fn("(v) => v + '%'")
      : fn("(v) => v >= 1e6 ? (v/1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v/1e3) + 'k' : v");

const labelFormatter = (format) =>
  format === "currency"
    ? fn("(v) => 'R$ ' + Math.round(v).toLocaleString('en-US')")
    : format === "percent"
      ? fn("(v) => (Number.isInteger(v) ? v : v.toFixed(1)) + '%'")
      : fn("(v) => Math.round(v).toLocaleString('en-US')");

// --- items -------------------------------------------------------------------

function normalize(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("A chart needs at least one item.");
  return items.map((item) => {
    const value = Number(item.value);
    if (!Number.isFinite(value)) throw new Error(`Item "${item.label}" has no usable value.`);
    return { label: String(item.label ?? "").trim() || "—", value, color: item.color };
  });
}

/** Largest first. A bar chart out of order makes the reader hunt for a pattern that is not there. */
const byValue = (items) => [...items].sort((a, b) => b.value - a.value);

const colorFor = (item, index) => COLORS[item.color] || PALETTE[index % PALETTE.length];

function foldIntoOther(items) {
  if (items.length <= MAX_SLICES) return items;
  const head = items.slice(0, MAX_SLICES - 1);
  const tail = items.slice(MAX_SLICES - 1);
  return [...head, { label: "Other", value: tail.reduce((sum, item) => sum + item.value, 0) }];
}

// --- the four charts ---------------------------------------------------------

function donut(title, format, items) {
  const slices = foldIntoOther(byValue(items));
  return {
    width: 640,
    height: 420,
    version: 4,
    config: {
      type: "doughnut",
      data: {
        // The value rides in the legend label: QuickChart's datalabels would
        // otherwise print it a second time on top of the slice.
        labels: slices.map((item) => `${item.label} — ${formatValue(item.value, format)}`),
        datasets: [
          {
            data: slices.map((item) => item.value),
            backgroundColor: slices.map(colorFor),
            borderColor: "#ffffff",
            borderWidth: 2,
          },
        ],
      },
      options: {
        plugins: {
          datalabels: { display: false },
          legend: { position: "right", labels: { font: { size: 13 } } },
          title: { display: true, text: title, font: { size: 17 } },
        },
      },
    },
  };
}

function bar(title, format, items, horizontal) {
  const sorted = byValue(items);
  return {
    width: horizontal ? 700 : 640,
    height: Math.max(320, horizontal ? 90 + sorted.length * 46 : 420),
    version: 4,
    config: {
      type: "bar",
      data: {
        labels: sorted.map((item) => item.label),
        datasets: [
          {
            data: sorted.map((item) => item.value),
            backgroundColor: sorted.map(colorFor),
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        layout: { padding: { right: horizontal ? 86 : 12, top: horizontal ? 8 : 24 } },
        plugins: {
          legend: { display: false },
          title: { display: true, text: title, font: { size: 17 } },
          datalabels: {
            display: true,
            anchor: "end",
            align: horizontal ? "right" : "top",
            color: "#333333",
            font: { size: 13, weight: "bold" },
            formatter: labelFormatter(format),
          },
        },
        scales: {
          x: {
            grid: { display: horizontal },
            ticks: horizontal ? { callback: tickFormatter(format) } : { font: { size: 12 } },
          },
          y: {
            grid: { display: !horizontal },
            ticks: horizontal ? { font: { size: 13 } } : { callback: tickFormatter(format) },
          },
        },
      },
    },
  };
}

function gauge(title, items) {
  if (items.length !== 1) throw new Error("A gauge takes exactly one item — use a bar chart to compare.");
  const [item] = items;
  const max = Math.max(130, Math.ceil((item.value * 1.15) / 10) * 10);
  return {
    width: 560,
    height: 340,
    version: 2, // QuickChart only draws a gauge on Chart.js v2
    config: {
      type: "gauge",
      data: {
        datasets: [
          {
            value: item.value,
            data: [75, 90, 100, max],
            backgroundColor: [COLORS.negative, COLORS.warning, COLORS.positive, "#9fd6bb"],
            borderWidth: 2,
          },
        ],
      },
      options: {
        // The headline number is the percentage; the label underneath carries
        // the context in currency, which is what the owner actually talks about.
        title: { display: true, text: [title, item.label].filter(Boolean), fontSize: 16 },
        valueLabel: {
          display: true,
          formatter: fn("(v) => Math.round(v) + '%'"),
          fontSize: 30,
          color: "#111111",
          backgroundColor: "transparent",
          bottomMarginPercentage: 8,
        },
      },
    },
  };
}

// --- the tool the agent calls ------------------------------------------------

/**
 * Build a chart and return the URL of its PNG.
 * @param {{type: string, title: string, format: string, items: Array<{label: string, value: number, color?: string}>}} spec
 */
export function createChart({ type, title, format = "number", items }) {
  if (!CHART_TYPES.includes(type)) {
    throw new Error(`Unknown chart type "${type}". Use one of: ${CHART_TYPES.join(", ")}.`);
  }
  if (!FORMATS.includes(format)) {
    throw new Error(`Unknown format "${format}". Use one of: ${FORMATS.join(", ")}.`);
  }

  const normalized = normalize(items);
  const heading = String(title || "").trim();

  const built =
    type === "gauge"
      ? gauge(heading, normalized)
      : type === "donut"
        ? donut(heading, format, normalized)
        : bar(heading, format, normalized, type === "horizontal_bar");

  const params = new URLSearchParams({
    c: encodeConfig(built.config),
    v: String(built.version),
    w: String(built.width),
    h: String(built.height),
    bkg: "white",
    f: "png",
    devicePixelRatio: "2",
  });
  return `${QUICKCHART}?${params.toString()}`;
}

/** The gauge answers "are we doing well?" and comes before the bars that answer "who?". */
export function orderCharts(charts) {
  return [...charts].sort((a, b) => (a.type === "gauge" ? -1 : 0) - (b.type === "gauge" ? -1 : 0));
}
