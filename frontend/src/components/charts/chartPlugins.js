// Shared across every bar chart in the app (AdminAnalyticsCharts.js and
// GradeCharts.js) so these stay one implementation instead of drifting into
// several slightly different ones.

// Chart.js's default axis picks round-number ticks (0, 21, 42, 63…) that a
// bar's actual value — 204, say — usually lands *between*, so there's no
// gridline connecting the bar back to a labeled number on the axis. This
// replaces the auto ticks with the bars' own exact values instead, so a bar
// end sits exactly on a gridline that's labeled with its number — the axis
// leads straight to the bar, no separate label needed floating on the chart
// itself. Snapping to literally every value backfires when several bars are
// close together (200 vs 204, 11 vs 14 vs 12) — their tick labels sit almost
// on top of each other — so values within 12% of the chart's own range of
// each other are collapsed onto one shared tick. The true max always gets a
// line, but by SWAPPING it into the last kept slot rather than adding a
// second one right next to it — appending it unconditionally (the earlier
// bug here) could still land two labels almost on top of each other (e.g.
// 200 and 204 both surviving, 2.14 and 2.18 both surviving) whenever the max
// itself was the value too close to the previous tick.
export const snapTicksToValues = (values) => ({
  afterBuildTicks: (scale) => {
    const rounded = values.map((v) => Math.round(v * 100) / 100);
    const max = Math.max(0, ...rounded);
    const minGap = max > 0 ? max * 0.12 : 1;
    const sorted = [...new Set(rounded)].sort((a, b) => a - b);
    const kept = [0];
    sorted.forEach((v) => {
      if (v - kept[kept.length - 1] >= minGap) kept.push(v);
    });
    if (!kept.includes(max)) {
      if (max - kept[kept.length - 1] < minGap) kept[kept.length - 1] = max;
      else kept.push(max);
    }
    scale.ticks = kept.sort((a, b) => a - b).map((v) => ({ value: v }));
  },
});

// Prints each bar's exact value right above it (vertical bars) or beside it
// (horizontal, indexAxis: 'y'). `color` follows the current theme rather than
// a fixed hue that could go invisible on a dark card; `format` turns the raw
// number into its on-chart text ("85%", "2.34", "204"). Currently unused —
// kept for any chart that specifically wants an on-bar label instead of the
// axis-snapping approach above.
export function valueLabelPlugin(color, format = (v) => String(v)) {
  return {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const horizontal = chart.options.indexAxis === 'y';
      chart.data.datasets.forEach((dataset, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const value = dataset.data[i];
          if (value === null || value === undefined) return;
          ctx.save();
          ctx.fillStyle = color;
          ctx.font = "700 11px 'Inter', system-ui, sans-serif";
          if (horizontal) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(format(value), bar.x + 6, bar.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(format(value), bar.x, bar.y - 5);
          }
          ctx.restore();
        });
      });
    },
  };
}
