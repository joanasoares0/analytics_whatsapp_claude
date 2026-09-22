// src/charts.mjs — Chart.js config → PNG URL from QuickChart.
//
// Four chart types: donut, horizontal_bar, vertical_bar, gauge.
// Two things that are settled in code and not left to the model: the gauge
// always comes before the bars, and bars are sorted by value, largest first.
//
// QuickChart notes: the gauge only renders on Chart.js v2 (`v=2`); the other
// three use v=4, where `datalabels` has to be turned off or the donut prints
// each number twice.

// TODO: implement.
