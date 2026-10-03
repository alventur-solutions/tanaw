---
name: insight-story-flow
description: Order TANAW insights into a story with a clear start, middle, and end, so a reader moves from one question to the next instead of scanning a list of numbers. Use when designing or reworking a dashboard panel, an area page, a report section, or a pitch summary.
---
# Insight story flow

A TANAW story is a short chain of beats. Each beat answers one question with one chart, then hands the reader to the next beat.

## The beat
Every beat has the same five parts, in this order:
1. **Question**: what the reader is wondering (see `rhetorical-questions`).
2. **Answer**: one sentence with the number, the unit, and the years (the `lede`).
3. **Evidence**: one chart that shows the answer (see `dynamic-charts`).
4. **Reading note**: what limits the answer (the `caveats` list).
5. **Bridge**: one line that raises the next question.

If a beat has no chart, it is a caveat, not a beat. If a chart has no question, cut it or find its question.

## The arc for an area
Follow the river: land first, money second, the two together third, live readings last. This matches the tabs in `dashboard/src/App.tsx`.

| Step | Tab | Job of the beat |
|---|---|---|
| 1. Setting | panel head | Where is this place and what kind of place is it |
| 2. Land | Land history | What changed on the land, and when |
| 3. Money | Funding | What was spent here, on what kind of work |
| 4. Together | Side by side | Where the spending sits relative to the land change |
| 5. Now | Live sensors | What the stations read today |
| 6. Next | end of Side by side | What a reviewer could check next, and with which other records |

Step 4 is the peak of the story. Steps 2 and 3 exist to make step 4 readable. Step 6 always ends on "for review", never on a verdict.

## The lead metric by study type
| study_type | Framing question for the area | Lead metric in step 2 | Split in step 4 |
|---|---|---|---|
| `river_basin` | Does upstream change come with downstream floods? | tree cover loss, upstream vs downstream | upstream vs downstream |
| `rural_upland` | Is tree cover being lost, and to what? | tree cover loss, land conversion | by type of work |
| `urban` | Why do streets flood after ordinary rain? | built-up growth, green space loss | by type of work, drainage first |

Never lead an urban story with tree cover loss. If the urban metrics are not computed yet, say that plainly in step 2 and keep tree cover loss as supporting evidence.

## Rules for the flow
- **One idea per beat.** Two numbers in a lede is the limit: the value and what it is compared with.
- **Answer first.** The lede states the answer. The chart proves it. The reader should not have to read the chart to get the point.
- **Widest view first, then narrow.** Whole area, then zones, then one year, then one project.
- **Same window all the way through.** Steps 3 and 4 use the funding window from the API (`min_year` to `max_year`). When step 2 shows a longer history, mark the funding window on it (the `window-band` in `TreeLossChart`).
- **Bridges carry the story.** End each tab with one line that points to the next tab, for example "The next tab shows what was spent here in the same years."
- **Caveats travel with the claim.** Put the caveat in the beat where the claim is made, not in a footer the reader never reaches.
- **Empty is a beat too.** No data gets a plain statement of what is missing and why, not a blank chart.
- **End with an action.** The last line names what to check next: DENR records, LGU DRRM funds, a site visit.

## Outline template
Write this in your reply before changing any file:

```
Area: <area_id> (<study_type>)   Window: <min_year> to <max_year>
1. Q: <question>   A: <one sentence>   Chart: <component>   Caveat: <one line>   Bridge: <one line>
2. ...
```

Check the outline against these before building:
- Can each answer be computed from data the panel already loads?
- Does each question pass the checks in `rhetorical-questions`?
- Would the story still be fair if the pattern in step 4 turned out to be ordinary?
