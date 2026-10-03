---
name: dynamic-charts
description: Make TANAW dashboard charts respond to the reader, with linked hover, year window selection, zone toggles, annotations on the mark the text talks about, and short entrance motion. Use when adding or changing any chart in dashboard/src/charts.tsx or a panel that hosts one, or when a chart is static and the story needs the reader to explore it.
---
# Dynamic charts

A chart is dynamic when the reader can ask it a follow-up question: which year, which zone, which window. Motion alone is not the goal. Every interaction below changes what the description says (see `chart-descriptions`).

For chart form and color choices, also load the `dataviz` skill.

## What is already there
`dashboard/src/charts.tsx` draws hand-written SVG in React. There is no chart library. Keep it that way unless the user agrees to add one.
- Shared frame: `W`, `H`, `M`, `PLOT_W`, `PLOT_H`, the `niceMax` scale, the `bar` path helper.
- `TreeLossChart`: stacked bars per year, hover dimming, a `tooltip`, the `window-band` for the funding years, the `storm-mark`, and a `table-view` fallback.
- `FundingYearChart`, `CategoryBars`, `StatusList`: static.
- Colors: `CATEGORIES` in `api.ts`, `UP_COLOR`, `DOWN_COLOR`, `LOSS_COLOR` in `App.tsx`. Reuse them. A zone or category keeps one color on every chart.

## Patterns
Pick the smallest one that answers the beat's question.

### 1. Linked hover across charts
The peak of the story is land next to money, so the same year should light up in both charts.
- Lift the hover year out of the chart: the panel owns `const [year, setYear] = useState<number | null>(null)` and passes `activeYear` and `onYear` to each chart.
- Each chart dims the other years (the existing `opacity` rule) and shows its own value for the active year.
- The description line under the charts reads both values for that year.

### 2. Year window selection
Lets the reader compare groups of years, which is the only fair comparison for tree cover loss.
- Offer preset windows as buttons, not a free slider: the full record, the funding window (`min_year` to `max_year`), and equal halves of the funding window.
- Presets are groups of three years or more. Never offer a single year as a window.
- The `window-band` moves to the chosen window and the lede recomputes with `sumLoss(rows, from, to)`.

### 3. Zone and series toggle
For `river_basin` areas with `__up` and `__down` zones.
- Make each `legend` item a button with `aria-pressed`. Turning a series off rescales the axis with `niceMax`.
- At least one series stays on.

### 4. Annotation on the mark the text names
If the lede says "the highest year was 2020", the chart labels the 2020 bar.
- Compute the annotated mark from the data, with the same function the description uses.
- One or two annotations per chart. Use the existing `tick` and `value` text classes.
- A storm year annotation keeps the `storm-mark` and says the loss may be natural.

### 5. Entrance motion
- Bars grow from the baseline once, when the chart first shows. 300 ms or less, ease-out, CSS only (`transform: scaleY` with `transform-origin` at the baseline).
- No looping, no bouncing, no motion on every hover.
- Wrap it in `@media (prefers-reduced-motion: no-preference)` in `styles.css`. With reduced motion the chart is simply there.

### 6. Story steps
For a chart that carries more than one point (for example: the full record, then the funding window, then upstream only).
- Two to four steps, driven by Back and Next buttons with a "2 of 3" label. No scroll hijacking and no autoplay.
- Each step sets the window, the visible series, and the annotation, and swaps the description.
- Every state a step shows is also reachable with the normal controls.

## Rules
- **One y axis per chart.** Never put hectares and PHP on one plot with two axes. Stack two small charts that share the year axis and link their hover.
- **Bars start at zero.**
- **Keep the table.** Every chart keeps a `table-view` (`details`) with the same rows the bars draw. Add one to charts that lack it.
- **Keyboard and touch.** Hover targets are also focusable (`tabIndex={0}`, `onFocus`, `onBlur`), and a tap sets the active year. Nothing is hover only.
- **Quality flags stay visible.** The tooltip or description for a year shows its `quality_flag`. A `category_from_description` category is marked as an estimate.
- **No hidden partial years.** Years outside the funding window are not drawn as zero. They are left out, with the caveat that says so.
- **No cross-area totals.** A control may switch between areas, never sum them.
- **State in the URL.** If a control changes what the story says (window, zone), add it to the query string next to `area` and `tab` so a shared link opens the same view.
- **Empty state.** Zero rows returns the `empty` paragraph with a plain reason, as `TreeLossChart` does now.
- No em dashes in labels, tooltips, or captions.

## Before you finish
- Does each interaction change the description text as well as the picture?
- Can the whole chart be read with a keyboard, and with motion turned off?
- Does the table view match the bars after every control change?
- Run the type check and build scripts in `dashboard/package.json`.
