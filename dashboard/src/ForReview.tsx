import { useMemo, useState } from 'react'
import { formatPhp, shortName } from './api'
import type { AreaData, AreaFeature, ProjectFeature } from './api'
import {
  COST_CAVEAT,
  DOWNLOAD_CAVEAT,
  ESTIMATE_CHECK,
  NO_COST_NOTE,
  contractId,
  estimateLine,
  listCountLine,
  listedCount,
  otherRecordsLine,
  reviewAlt,
  reviewCsv,
  reviewFileName,
  reviewLede,
  progressValue,
  reviewLists,
  sharedPointLine,
} from './review'
import type { ReviewList } from './review'

interface Props {
  selected: AreaFeature
  current: AreaData
  // False when no DPWH project is linked to this area. That is not a count of zero.
  linked: boolean
  // Opens the contract's record in the panel.
  onProject: (componentId: string) => void
  // Prints the area brief.
  onPrint: () => void
  // Opens the next tab of the story.
}

const PAGE_SIZE = 10

/** One contract on a list, as a table row. The description opens the contract's record. */
function ContractRow({
  feature,
  notes,
  onProject,
}: {
  feature: ProjectFeature
  notes: string[]
  onProject: Props['onProject']
}) {
  const p = feature.properties
  return (
    <tr>
      <td>
        <button className="review-open" onClick={() => onProject(p.component_id)}>
          <span className="review-id">{contractId(feature)}</span>
          <span className="review-desc">
            {p.description ?? p.type_of_work ?? 'No description on record'}
          </span>
        </button>
        {notes
          .filter((note) => note !== NO_COST_NOTE)
          .map((note) => (
            <span className="review-note" key={note}>
              {note}
            </span>
          ))}
      </td>
      <td className="num">{p.year}</td>
      <td className="num">{p.amount_php == null ? 'None on record' : formatPhp(p.amount_php)}</td>
      <td className="num">{progressValue(feature) ?? 'None on record'}</td>
    </tr>
  )
}

/** A list as a table, ten contracts to a page, largest contract cost first. */
function Rows({ list, onProject }: { list: ReviewList; onProject: Props['onProject'] }) {
  const [page, setPage] = useState(0)
  const total = list.rows.length
  const pages = Math.ceil(total / PAGE_SIZE)
  const start = page * PAGE_SIZE
  const end = Math.min(start + PAGE_SIZE, total)
  return (
    <>
      <table className="review-table">
        <thead>
          <tr>
            <th>Contract ID and description</th>
            <th className="num">Infrastructure year</th>
            <th className="num">Contract cost</th>
            <th className="num">Reported progress</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.slice(start, end).map((f) => (
            <ContractRow
              key={f.properties.component_id}
              feature={f}
              notes={list.notes[f.properties.component_id] ?? []}
              onProject={onProject}
            />
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <nav className="pager" aria-label={`Pages of ${list.label}`}>
          <button className="back" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span aria-live="polite">
            {(start + 1).toLocaleString('en-PH')} to {end.toLocaleString('en-PH')} of{' '}
            {total.toLocaleString('en-PH')}, by contract cost
          </span>
          <button className="back" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </>
  )
}

function RuleBlock({ list, onProject }: { list: ReviewList; onProject: Props['onProject'] }) {
  return (
    <section className="beat review-rule" id={`review-${list.key}`}>
      <h3>{list.label}</h3>
      <p className="lede">{listCountLine(list)}</p>
      <dl className="review-facts">
        <div>
          <dt>Why these are listed</dt>
          <dd>{list.why}</dd>
        </div>
        <div>
          <dt>What to check</dt>
          <dd>{list.check}</dd>
        </div>
      </dl>
      <Rows list={list} onProject={onProject} />
      <ul className="caveats">
        {list.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </section>
  )
}

function download(name: string, text: string) {
  // The byte order mark lets a spreadsheet read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export default function ForReview({ selected, current, linked, onProject, onPrint }: Props) {
  const { features, min_year, max_year } = current.projects
  // The current year comes from the clock, so the "earlier year" rules move with it.
  const currentYear = new Date().getFullYear()
  const lists = useMemo(() => reviewLists(features, currentYear), [features, currentYear])
  const bridge = (
    <a className="bridge" href="/live-sensors">
      <span>Next: Live sensors</span>
      What are the stations reading now?
    </a>
  )

  if (!linked) {
    return (
      <section className="beat">
        <p className="empty">
          DPWH flood control contracts are not linked to this area yet. This is not a count of
          zero. No review list is shown, and one will appear once the funding data is loaded for
          this area.
        </p>
        {bridge}
      </section>
    )
  }
  if (features.length === 0) {
    return (
      <section className="beat">
        <p className="empty">{reviewLede(lists, features, min_year, max_year)}</p>
        {bridge}
      </section>
    )
  }

  const areaId = selected.properties.area_id
  const listed = listedCount(lists)
  const shown = lists.filter((l) => l.rows.length > 0)
  const longest = Math.max(...lists.map((l) => l.rows.length))
  const estimate = estimateLine(features)
  const other = otherRecordsLine(features, min_year, max_year)
  const points = sharedPointLine(features)

  return (
    <>
      <section className="beat">
        <h3>What could a reviewer check next?</h3>
        <p className="lede">{reviewLede(lists, features, min_year, max_year)}</p>
        <p className="chart-label">Contracts on each review list</p>
        <ul className="review-summary" aria-label={reviewAlt(lists)}>
          {lists.map((list) => {
            const count = list.rows.length
            const label = (
              <>
                <span className="review-summary-name">{list.label}</span>
                <span className="category-track">
                  {count > 0 && (
                    <span className="category-fill" style={{ width: `${(count / longest) * 100}%` }} />
                  )}
                </span>
                <span className="category-value">
                  {count === 0
                    ? 'No contracts match in this data'
                    : count.toLocaleString('en-PH')}
                </span>
              </>
            )
            return (
              <li key={list.key}>
                {count === 0 ? (
                  <div className="review-summary-row">{label}</div>
                ) : (
                  <button
                    className="review-summary-row"
                    onClick={() =>
                      document
                        .getElementById(`review-${list.key}`)
                        ?.scrollIntoView({ block: 'start' })
                    }
                  >
                    {label}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <div className="review-actions">
          {listed > 0 && (
            <button
              className="pill"
              onClick={() =>
                download(
                  reviewFileName(areaId, new Date()),
                  reviewCsv(lists, areaId, shortName(selected), new Date()),
                )
              }
            >
              Download review list (CSV)
            </button>
          )}
          <button className="back" onClick={onPrint}>
            Print area brief
          </button>
        </div>
        <ul className="caveats">
          <li>
            Being on a list is a prompt to look. It is not a finding about the contract or the
            contractor.
          </li>
          <li>
            Bar length is the number of contracts on a list. A contract can be on more than one
            list, and it has one row per list in the CSV file.
          </li>
          <li>
            The lists are built from the DPWH data loaded for {min_year} to {max_year}. Select a
            list to go to it, and select a contract to open its record.
          </li>
        </ul>
      </section>

      {shown.map((list) => (
        <RuleBlock key={list.key} list={list} onProject={onProject} />
      ))}

      {estimate && (
        <section className="beat review-rule">
          <h3>Category is an estimate</h3>
          <p className="lede">{estimate}</p>
          <dl className="review-facts">
            <div>
              <dt>What to check</dt>
              <dd>{ESTIMATE_CHECK}</dd>
            </div>
          </dl>
          <ul className="caveats">
            <li>This is a count. These contracts are not listed here or in the CSV file.</li>
          </ul>
        </section>
      )}

      <section className="beat review-rule">
        <h3>Checks against other records</h3>
        <ul className="next-steps">
          {other && <li>{other}</li>}
          <li>DENR National Greening Program records for the same years and places.</li>
          <li>LGU DRRM fund use inside this area.</li>
          <li>A site visit to see the works and the land around them as they are today.</li>
        </ul>
      </section>

      <section className="beat review-rule">
        <h3>How to read these lists</h3>
        <ul className="caveats">
          <li>
            Status, progress, and dates are as reported by DPWH. TANAW has not checked them on
            site.
          </li>
          <li>The completion date can be the scheduled one.</li>
          <li>{COST_CAVEAT}</li>
          <li>{DOWNLOAD_CAVEAT}</li>
          <li>
            The year is the DPWH infrastructure year, which can differ from the year the work was
            built.
          </li>
          <li>The coordinates are the project site, not the area the project protects.</li>
          {points && <li>{points}</li>}
          <li>
            This data holds DPWH contracts. DENR, LGU, and other agency work does not appear in
            it.
          </li>
          <li>
            Study areas overlap. A contract appears in every area it falls in, so lists and totals
            must not be added across areas.
          </li>
          <li>
            Being on a list is a prompt to look. It is not a finding about the contract or the
            contractor.
          </li>
        </ul>
        <p className="finding">
          TANAW shows patterns for review. It does not show cause, and it does not judge any
          project.
        </p>
        {bridge}
      </section>
    </>
  )
}
