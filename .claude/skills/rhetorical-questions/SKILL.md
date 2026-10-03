---
name: rhetorical-questions
description: Write the question that opens each TANAW insight, as a heading, eyebrow, or bridge line, so the reader knows what the chart below is about to answer. Use when writing or editing headings, section titles, tab intros, report headers, or pitch copy. Covers which questions are allowed, because a question can imply wrongdoing as easily as a statement.
---
# Rhetorical questions

A good question tells the reader what to look for before they see the chart. In TANAW it also carries a risk: "Where did the money go?" accuses without saying so. These rules keep the pull of a question and remove the accusation.

## Where a question goes
- **Beat heading** (`h3`): one question per chart. Replaces a label heading.
  - Before: "Tree cover loss per year, in hectares"
  - After: "How much tree cover was lost here, and when?"
- **Bridge line** at the end of a tab: raises the next beat. "What was spent here in the same years?"
- **Area framing** (`eyebrow` or intro): the main question for the study type from CLAUDE.md, used once per area.

The unit and the years move from the heading into the lede and the chart's `aria-label`, so nothing is lost.

## The five checks
A question ships only if all five are true.
1. **The chart below answers it.** If the reader has to go elsewhere, it is the wrong question for this beat.
2. **The next sentence answers it** with a number, a unit, and the years.
3. **It asks what, where, when, how much, or what kind.** These describe. "Why" and "who" ask for cause or blame, which the data cannot give.
4. **"Nothing unusual" is a possible answer.** If the question only makes sense when something is wrong, it is leading.
5. **A DPWH district engineer could read it without feeling accused.**

"Why" is allowed in one place only: the area framing question for `urban` ("Why do streets flood after ordinary rain?"). Answer it with what the data shows, never with a cause.

## Allowed and not allowed
| Write this | Not this | Why |
|---|---|---|
| How much tree cover was lost here, and when? | Who cleared the forest? | Asks for blame |
| Where in the basin was the loss recorded? | Why is the upstream being stripped? | Presumes cause and intent |
| What was spent on flood control here? | Where did the money go? | Implies it is missing |
| What kind of work was funded? | Why was nothing spent on slopes? | Presumes a failure |
| Where does the spending sit relative to the land change? | Is the money going to the wrong place? | Asks for a verdict |
| What do DPWH records report for these contracts? | Were these projects ever built? | Implies ghost projects |
| What could a reviewer check next? | What are they hiding? | Accuses |

Also not allowed:
- Negative questions: "Isn't it strange that...", "Shouldn't there be...".
- Questions about a single year of NDVI or a single storm year.
- A question whose honest answer is "we cannot tell from this data". Write the limit as a caveat instead.
- "Deforestation" in a question about Hansen data. It is "tree cover loss".

## Style
- 12 words or fewer. One question mark. No stacked questions.
- Plain words a barangay official would use. "How much", not "What is the magnitude of".
- Say "here" or name the area, so the question is about a place.
- One question per beat and at most one bridge per tab. A page of questions reads like an interrogation.
- When the data is missing, use a statement, not a question: "Built-up surface is not computed for this area yet."
- No em dashes.

## Question bank
Land (`river_basin`, `rural_upland`)
- How much tree cover was lost here, and when?
- Where in the basin was the loss recorded?
- Which years stand out, and were they typhoon years?

Land (`urban`)
- How much of the city became built-up surface?
- How much green space is left, and where?

Funding
- What was spent on flood control here?
- What kind of work was funded?
- What do DPWH records report for these contracts?

Side by side
- Where does the spending sit relative to the land change?
- How do upstream and downstream compare?
- Which types of work do not appear in this data?

Live sensors
- What are the stations reading now?
- How deep is the water on this street?

Next step
- What could a reviewer check next?
