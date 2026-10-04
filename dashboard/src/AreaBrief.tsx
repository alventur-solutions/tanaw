// The printable area brief. It is hidden on screen and is the one thing on the page in print, so
// it stands on its own: no hover, no tabs, no map. Every sentence comes from story.ts or
// review.ts, built from the same rows the panel shows.
import { memo } from 'react'
import {
  CATEGORIES,
  DOWN_COLOR,
  LOSS_COLOR,
  STUDY_TYPE_LABEL,
  UP_COLOR,
  formatHa,
  formatPhp,
  regionOf,
  shortName,
  sumAmount,
  sumLoss,
} from './api'
import type { AreaData, AreaFeature, ProjectFeature } from './api'
import { FundingYearChart, RainChart, StatusList, TreeLossChart } from './charts'
import type { LossSeries } from './charts'
import {
  COST_CAVEAT,
  DOWNLOAD_CAVEAT,
  ESTIMATE_CHECK_PRINT,
  ROWS_SHOWN,
  STATUS_CAVEAT,
  contractId,
  estimateLine,
  listCountLine,
  moreInCsvLine,
  otherRecordsLine,
  progressValue,
  reviewLede,
  reviewLists,
  sharedPointLine,
  shortText,
} from './review'
import type { ReviewList } from './review'
import {
  URBAN_NOTE,
  categoryLede,
  fundingLede,
  lossLede,
  rainLede,
  sideLede,
  statusLede,
  zoneFinding,
  zoneLossLede,
} from './story'

/** Characters of a contract description printed in a table cell. */
const DESCRIPTION_CHARS = 110

// Reading notes printed once, in the last section, so they are left out under each list.
const PRINTED_ONCE = [COST_CAVEAT, DOWNLOAD_CAVEAT, STATUS_CAVEAT]

const NOT_LINKED =
  'DPWH flood control contracts are not linked to this area yet. This is not a count of zero, so no contract figure is printed.'

interface Props {
  selected: AreaFeature
  current: AreaData
  up?: AreaData
  down?: AreaData
  hasZones: boolean
  // False when no DPWH project is linked to this area. That is not a count of zero.
  linked: boolean
  // The date printed on the brief. The clock is used when it is not given.
  today?: Date
}

function CategoryTable({ features }: { features: ProjectFeature[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Type of work</th>
          <th>Contracts</th>
          <th>Contract cost</th>
        </tr>
      </thead>
      <tbody>
        {CATEGORIES.map((category) => {
          const rows = features.filter((f) => f.properties.category === category.key)
          const costed = rows.some((f) => f.properties.amount_php != null)
          return (
            <tr key={category.key}>
              <th>{category.label}</th>
              {rows.length === 0 ? (
                <td colSpan={2}>Does not appear in this data</td>
              ) : (
                <>
                  <td>{rows.length.toLocaleString('en-PH')}</td>
                  <td>{costed ? formatPhp(sumAmount(rows)) : 'No contract cost on record'}</td>
                </>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ReviewTable({ list }: { list: ReviewList }) {
  const rows = list.rows.slice(0, ROWS_SHOWN)
  const more = moreInCsvLine(list, rows.length)
  const caveats = list.caveats.filter((caveat) => !PRINTED_ONCE.includes(caveat))
  return (
    <div className="brief-list">
      <h3>{list.label}</h3>
      <p>
        {listCountLine(list)} {list.why}
      </p>
      <p>
        <strong>What to check:</strong> {list.check}
      </p>
      <table>
        <thead>
          <tr>
            <th>Contract ID</th>
            <th>Description</th>
            <th>Infrastructure year</th>
            <th>Reported status</th>
            <th>Reported progress</th>
            <th>Contract cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const p = f.properties
            // The text match is printed. The no-cost note is already the contract cost cell.
            const notes = (list.notes[p.component_id] ?? []).filter((note) => note.includes(' matches '))
            return (
              <tr key={p.component_id}>
                <td>{contractId(f)}</td>
                <td>
                  {shortText(p.description ?? p.type_of_work ?? 'No description on record', DESCRIPTION_CHARS)}
                  {notes.map((note) => (
                    <span className="brief-row-note" key={note}>
                      {note}
                    </span>
                  ))}
                </td>
                <td>{p.year}</td>
                <td>{p.status ?? 'No status on record'}</td>
                <td>{progressValue(f) ?? 'Not on record'}</td>
                <td>{p.amount_php == null ? 'No contract cost on record' : formatPhp(p.amount_php)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {more && <p className="brief-more">{more}</p>}
      <ul className="brief-notes">
        {caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </div>
  )
}

function AreaBrief({ selected, current, up, down, hasZones, linked, today }: Props) {
  const area = selected.properties
  const { features, min_year, max_year } = current.projects
  const printed = today ?? new Date()
  const region = regionOf(area.area_id)
  const urban = area.study_type === 'urban'
  const hasContracts = linked && features.length > 0

  // Land. Zone figures are printed when both zones have arrived with rows. If they have not, the
  // zone sentences are left out: on paper that would be a timing accident, not a fact.
  const zoned =
    hasZones && up !== undefined && down !== undefined && up.loss.length > 0 && down.loss.length > 0
  const series: LossSeries[] = zoned
    ? [
        { key: 'down', label: 'Downstream', color: DOWN_COLOR, rows: down.loss },
        { key: 'up', label: 'Upstream', color: UP_COLOR, rows: up.loss },
      ]
    : [{ key: 'all', label: 'Tree cover loss', color: LOSS_COLOR, rows: current.loss }]
  const lossYears = current.loss.map((r) => r.year)
  const from = Math.min(...lossYears)
  const to = Math.max(...lossYears)
  const hasLoss = current.loss.length > 0
  const lossSource = current.loss.find((r) => r.source_version)?.source_version ?? null
  const rainSource = current.rain.find((r) => r.source_version)?.source_version ?? null

  // Spending and review.
  const years = Array.from({ length: max_year - min_year + 1 }, (_, i) => min_year + i)
  const estimate = estimateLine(features)
  const lists = hasContracts ? reviewLists(features, printed.getFullYear()) : []
  const windowLoss = current.loss.some((r) => r.year >= min_year && r.year <= max_year)
  const zonesTogether =
    zoned && up.projects.features.length + down.projects.features.length > 0
  const other = hasContracts ? otherRecordsLine(features, min_year, max_year) : null
  const points = hasContracts ? sharedPointLine(features) : null

  return (
    <article className="brief">
      <header className="brief-head">
        <p className="brief-kicker">TANAW area brief</p>
        <h1>{shortName(selected)}</h1>
        <p className="brief-meta">
          {[
            STUDY_TYPE_LABEL[area.study_type],
            formatHa(area.area_ha),
            region,
            `Printed ${printed.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}`,
          ]
            .filter(Boolean)
            .join(' | ')}
        </p>
        <p className="brief-frame">
          Patterns for review. Not a finding about any project, contractor, or office.
        </p>
      </header>

      <div className="brief-cols">
        <section>
          <h2>Land: tree cover loss</h2>
          {urban && <p>{URBAN_NOTE}</p>}
          {!hasLoss ? (
            <p>
              Tree cover loss for this area is not loaded yet. No values are printed, so none of
              it should be read as zero hectares.
            </p>
          ) : (
            <>
              <p className="lede">{lossLede(current.loss, from, to)}</p>
              <p className="brief-chart-label">Tree cover loss per year, in hectares</p>
              <TreeLossChart
                series={series}
                windowYears={hasContracts ? [min_year, max_year] : undefined}
              />
              {zoned && <p>{zoneLossLede(up.loss, down.loss, from, to)}</p>}
              <ul className="brief-notes">
                <li>
                  This is gross loss: canopy removed for any reason, including clearing, fire,
                  storm damage, landslide, and plantation harvest. Regrowth and new planting are
                  not subtracted.
                </li>
                <li>It is counted on land that had 30 percent tree canopy or more in 2000.</li>
                <li>
                  Detection improved from 2011 and again from 2015, so compare groups of years, not
                  single years.
                </li>
                <li>
                  Years flagged as major storm years are marked on the chart where the data has
                  them. Loss from a storm late in a year can be dated to the following year.
                </li>
                {zoned && <li>The zones differ in size and in tree cover, so hectares are not a rate.</li>}
                {lossSource && <li>Source: {lossSource}</li>}
              </ul>
            </>
          )}
        </section>

        <section>
          <h2>Rainfall</h2>
          {current.rain.length === 0 ? (
            <p>
              Rainfall for this area is not loaded yet. No values are printed, so none of it
              should be read as zero rainfall.
            </p>
          ) : (
            <>
              <p className="lede">{rainLede(current.rain)}</p>
              <p className="brief-chart-label">Rainfall per year, in mm</p>
              <RainChart rows={current.rain} />
            </>
          )}
          <ul className="brief-notes">
            {current.rain.length > 0 && (
              <>
                <li>
                  Rainfall is the area mean from CHIRPS, at about 5.5 km per pixel. A local
                  downpour can be heavier than the area mean.
                </li>
                <li>
                  CHIRPS is a satellite and rain gauge estimate. Its daily values tend to read low
                  on extreme days.
                </li>
                <li>A year that is not complete is a lower bound and is left out of the mean.</li>
              </>
            )}
            <li>
              Rainfall is not flooding. Flood extent is not computed, so this brief does not show
              where or how often water stood.
            </li>
            {rainSource && <li>Source: {rainSource}</li>}
          </ul>
        </section>
      </div>

      <section>
        <h2>Spending: DPWH flood control contracts</h2>
        {!linked && <p>{NOT_LINKED}</p>}
        {linked && !hasContracts && <p>{reviewLede([], features, min_year, max_year)}</p>}
        {hasContracts && (
          <>
            <div className="brief-cols">
              <div>
                <p className="lede">{fundingLede(features, min_year, max_year)}</p>
                <p className="brief-chart-label">DPWH flood control contract cost per year</p>
                <FundingYearChart projects={features} years={years} />
              </div>
              <div>
                <p className="lede">{categoryLede(features)}</p>
                <CategoryTable features={features} />
                <p className="lede">{statusLede(features)}</p>
                <StatusList projects={features} />
              </div>
            </div>
            <ul className="brief-notes">
              <li>{COST_CAVEAT}</li>
              <li>
                The year is the DPWH infrastructure year, which can differ from the year the work
                was built. Years outside {min_year} to {max_year} are not complete in the DPWH data
                and are left out.
              </li>
              <li>
                This data holds DPWH contracts. DENR, LGU, and other agency work does not appear
                in it.
              </li>
              {estimate && (
                <li>
                  {estimate} {ESTIMATE_CHECK_PRINT}
                </li>
              )}
              <li>Each point is the project site, not the area the project protects.</li>
              <li>Status is as reported by DPWH. TANAW has not checked it on site.</li>
            </ul>
          </>
        )}
      </section>

      <section>
        <h2>Land and spending together</h2>
        {!windowLoss || !hasContracts ? (
          <p>
            {!windowLoss && 'Tree cover loss is not loaded for these years. '}
            {!linked && 'DPWH contracts are not linked to this area yet. '}
            {linked && !hasContracts && 'No DPWH contracts appear in this data here. '}
            A side by side reading needs both, so none is printed. Data that is not loaded is not
            a measured zero.
          </p>
        ) : (
          <>
            <p className="lede">{sideLede(current.loss, features, min_year, max_year)}</p>
            {zonesTogether && (
              <p>
                {zoneFinding(
                  sumLoss(up.loss, min_year, max_year),
                  sumLoss(current.loss, min_year, max_year),
                  sumAmount(up.projects.features),
                  sumAmount(features),
                )}
              </p>
            )}
            <ul className="brief-notes">
              <li>These figures sit side by side. They do not show that one caused the other.</li>
              {zonesTogether && (
                <>
                  <li>
                    Flood control works are usually sited along rivers and in built-up places, so
                    a lower upstream share of contract cost is expected. It is not a finding.
                  </li>
                  <li>The zones differ in size and in tree cover, so hectares are not a rate.</li>
                  <li>
                    Each point is the project site, not the area the project protects. A site near
                    the zone line can fall on either side.
                  </li>
                  <li>DENR and LGU work upstream does not appear in this data.</li>
                </>
              )}
            </ul>
          </>
        )}
      </section>

      <section className="brief-review">
        <h2>For review</h2>
        {!linked && <p>{NOT_LINKED} No review list is printed.</p>}
        {linked && !hasContracts && <p>{reviewLede([], features, min_year, max_year)}</p>}
        {hasContracts && (
          <>
            <p className="lede">{reviewLede(lists, features, min_year, max_year)}</p>
            {lists.map((list) =>
              list.rows.length === 0 ? (
                <p key={list.key}>
                  <strong>{list.label}:</strong> {listCountLine(list)}
                </p>
              ) : (
                <ReviewTable key={list.key} list={list} />
              ),
            )}
          </>
        )}
      </section>

      <section>
        <h2>Checks against other records</h2>
        <ul className="brief-checks">
          {other && <li>{other}</li>}
          <li>DENR National Greening Program records for the same years and places.</li>
          <li>LGU DRRM fund use inside this area.</li>
          <li>A site visit to see the works and the land around them as they are today.</li>
        </ul>
      </section>

      <section>
        <h2>How to read this brief</h2>
        <ul className="brief-notes">
          {hasContracts && (
            <>
              <li>
                Being on a list is a prompt to look. It is not a finding about the contract or the
                contractor.
              </li>
              <li>
                Status, progress, and dates are as reported by DPWH. TANAW has not checked them on
                site. {STATUS_CAVEAT}
              </li>
              <li>The completion date can be the scheduled one.</li>
              <li>{COST_CAVEAT}</li>
              <li>
                The year is the DPWH infrastructure year, which can differ from the year the work
                was built.
              </li>
              <li>The coordinates are the project site, not the area the project protects.</li>
              {points && <li>{points}</li>}
              <li>
                This data holds DPWH contracts. DENR, LGU, and other agency work does not appear
                in it.
              </li>
              <li>{DOWNLOAD_CAVEAT}</li>
            </>
          )}
          <li>
            Study areas overlap. A contract appears in every study area it falls in, so do not add
            figures across briefs.
          </li>
          <li>
            Sources:{' '}
            {[
              lossSource && `tree cover loss from ${lossSource}`,
              rainSource && `rainfall from ${rainSource}`,
              linked && 'contracts from the DPWH Infrastructure Transparency dataset (CC0)',
            ]
              .filter(Boolean)
              .join('; ')}
            {lossSource || rainSource || linked ? '. ' : 'none loaded for this area. '}
            Study area boundaries are drawn by TANAW.
          </li>
        </ul>
      </section>
    </article>
  )
}

export default memo(AreaBrief)
