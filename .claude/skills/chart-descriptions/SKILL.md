---
name: chart-descriptions
description: Write the text around a TANAW chart, computed from the same data the chart draws, so the lede, hover line, alt text, and caveats stay correct when the area, years, or zone change. Use when adding or editing a lede, finding, figcaption, tooltip, aria-label, or report paragraph that states a number.
---
# Chart descriptions

The description is the answer to the beat's question. It is built from the data at render time, so it changes when the reader changes the area, the window, or the zone. A sentence with a typed-in number is a bug waiting for the next data load.

## The four layers
| Layer | Where | Job | Length |
|---|---|---|---|
| Lede | `p.lede` under the heading | Answers the question: value, unit, years | 1 sentence |
| Live line | under the chart, `aria-live="polite"` | Describes what the reader is pointing at | 1 sentence |
| Alt text | `aria-label` on the `svg` | Says what the chart is and its main point | 1 to 2 sentences |
| Reading notes | `ul.caveats`, `figcaption` | Limits of the data | 1 line each |

A `p.finding` is a lede for the Side by side beat. It always ends with the "for review" framing.

## Build them as functions
Put description builders in `dashboard/src/story.ts` as pure functions: rows in, string out. The component calls the function with the rows it draws. This keeps the text testable and stops the text and the bars from drifting apart.

```ts
export function lossLede(rows: MetricRow[], from: number, to: number): string {
  const total = sumLoss(rows, from, to)
  if (rows.length === 0) return 'No tree cover loss rows are loaded for this area yet.'
  return `${formatHa(total)} of tree cover loss was recorded here from ${from} to ${to}.`
}
```

Rules for the functions:
- Format with the helpers in `api.ts` (`formatHa`, `formatPhp`, `shortPhp`). Do not format numbers by hand.
- Take the years from the data or the API response (`min_year`, `max_year`), never from a constant.
- Handle every branch: no rows, one row, a null `value`, a zero total, a share with a zero denominator.
- Return plain strings. Markup stays in the component.

## What each sentence must carry
- **A number with its unit**: hectares, mm, PHP (nominal), cm.
- **The years** it covers, as "from 2016 to 2025".
- **The place**: "here", the area name, or the zone.
- **The source in words** where it matters: "DPWH flood control", "recorded by satellite".

## Comparisons
- Compare groups of years: "the five years to 2025 against the five years before". Not one year against another.
- A share needs its whole: "62 percent of the basin's tree cover loss", not "62 percent".
- Upstream against downstream is allowed. One study area against another is allowed as a side by side, never as a sum.
- Put land and money in one sentence only with "in the same period" or "in these years" between them. Never "despite", "while", "yet", "even though", or "only". Those words argue.
- Write "about" before a rounded figure in running text.

## The live line
One sentence that follows the reader. Default (nothing selected) restates the main point.
- Year: "In 2020, 412 ha of tree cover loss was recorded here. It was a typhoon year, so part of that loss may be natural."
- Year with funding: "In 2022, 96 ha of tree cover loss was recorded and 41 DPWH contracts worth PHP 1.20 billion were sited here."
- Zone off: "Showing downstream only."

Append the flag when it changes how to read the value:
| quality_flag | Add |
|---|---|
| `storm_year` | "It was a typhoon year, so part of that loss may be natural." |
| `category_from_description` | "The type of work is an estimate read from the contract description." |
| any flag that is not ok | "Data quality note: <flag>." |

## Alt text
Say the chart type, the measure, the years, and the main point. "Bar chart of tree cover loss per year in hectares, 2001 to 2025. The highest year is 2020 at 412 ha." Compute the main point with the same function that places the annotation.

## Words
| Use | Never |
|---|---|
| tree cover loss | deforestation |
| recorded, reported | confirmed, proven |
| reported status | actual status, real progress |
| in the same period, in these years | because of, caused by, led to, resulted in |
| spending pattern, mismatch, for review | anomaly, irregularity, corruption, ghost project |
| does not appear in this data | missing, absent, neglected, ignored |
| sited here | protects, serves (the coordinate is the site) |
| contract cost | amount paid, amount spent on the ground |

"Does not appear in this data" matters: the dataset is DPWH only, so a category with no rows may be funded by DENR or an LGU.

## Reading notes to keep with each claim
- Tree cover loss: includes storm, fire, landslide, and plantation harvest. Detection improved from 2011 and again from 2015.
- Funding: DPWH only. The point is the project site, not the area it protects. Years outside the funding window are left out. Status is as reported by DPWH.
- Overlap: a project counts in every study area it falls in, so totals are not added across areas.
- Side by side: the figures sit next to each other and do not show that one caused the other.

## Before you finish
- Change the area, the window, and the zone. Does every sentence still read correctly?
- Is there any digit in the copy that was typed, not computed?
- Search the new text for the "Never" column and for em dashes.
- Hand new insight sentences to the `geospatial-reviewer` agent before they ship.
