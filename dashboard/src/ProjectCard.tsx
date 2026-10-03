import { CATEGORIES, formatPhp, shortName } from './api'
import type { AreaData, AreaFeature, ProjectFeature } from './api'
import { FundingYearChart } from './charts'
import { contractInArea, contractLede } from './story'

interface Props {
  project: ProjectFeature
  // The study area whose story this contract belongs to: the selected area when the site is
  // linked to it, else the smallest area the site is linked to. Null when it is linked to none.
  area: AreaFeature | null
  areaData?: AreaData
  // The area the reader came from. It is offered as the way back even when the site is not linked.
  cameFrom: AreaFeature | null
  compare: boolean
  onCompare: (on: boolean) => void
  onClose: () => void
  // Opens the Funding tab of an area, which is where this contract sits in the story.
  onStory: (areaId: string) => void
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="field">
      <dt className="label">{label}</dt>
      <dd>{value ?? 'Not recorded'}</dd>
    </div>
  )
}

export default function ProjectCard({
  project,
  area,
  areaData,
  cameFrom,
  compare,
  onCompare,
  onClose,
  onStory,
}: Props) {
  const p = project.properties
  const [lon, lat] = project.geometry.coordinates
  const category = CATEGORIES.find((c) => c.key === p.category)
  const place = [p.municipality, p.province].filter(Boolean).join(', ')
  const back = area ?? cameFrom
  const window = areaData?.projects
  const years = window
    ? Array.from({ length: window.max_year - window.min_year + 1 }, (_, i) => window.min_year + i)
    : []

  return (
    <article className="project-card">
      <button className="back" onClick={onClose}>
        {back ? `Back to ${shortName(back)}` : 'Back to all areas'}
      </button>
      <p className="eyebrow">
        {area ? `One contract in ${shortName(area)}` : 'One DPWH flood control contract'}
      </p>
      <h2>{p.description ?? p.type_of_work ?? 'Flood control project'}</h2>
      {place && <p className="place">{place}</p>}
      <div className="badges">
        {category && (
          <span className="badge" style={{ borderColor: category.color }}>
            <span className="dot" style={{ background: category.color }} />
            {category.label}
          </span>
        )}
        <span className="badge">
          {p.status ? `Reported status: ${p.status}` : 'No status on record'}
        </span>
      </div>

      <section className="beat">
        <h3>What do DPWH records report for this contract?</h3>
        <p className="lede">{contractLede(p)}</p>
        <dl className="fields">
          <Field label="Contract cost" value={p.amount_php == null ? null : formatPhp(p.amount_php)} />
          <Field label="Approved budget" value={p.abc_php == null ? null : formatPhp(p.abc_php)} />
          <Field label="Contractor" value={p.contractor} />
          <Field label="Type of work" value={p.type_of_work} />
          <Field
            label="Reported progress"
            value={p.progress_pct == null ? null : `${p.progress_pct.toFixed(0)} percent`}
          />
          <Field label="Infrastructure year" value={String(p.year)} />
          <Field label="Started" value={p.start_date} />
          <Field label="Completion date" value={p.completion_date} />
          <Field label="Contract ID" value={p.contract_id ?? p.component_id} />
          <Field label="Site" value={`${lat.toFixed(5)}, ${lon.toFixed(5)}`} />
        </dl>
        <ul className="caveats">
          <li>
            Status, progress, and dates are as reported by DPWH. The completion date can be the
            scheduled one.
          </li>
          {p.quality_flag === 'category_from_description' && (
            <li>
              The category is read from the description, because the source lists no type of work
              for this contract. Treat it as an estimate.
            </li>
          )}
          <li>Source: DPWH Transparency Portal.</li>
        </ul>
      </section>

      <section className="beat">
        <h3>Where does this contract sit in the area's spending?</h3>
        {!area && (
          <p className="empty">
            {cameFrom && cameFrom.properties.projects_linked === false
              ? `DPWH projects are not linked to ${shortName(cameFrom)} yet, so this contract cannot be placed in the area's spending. This is not a count of zero.`
              : 'This site is not linked to a study area in the loaded data, so there is no area spending to place it in.'}
          </p>
        )}
        {area && !areaData && <p className="empty">Loading the spending for {shortName(area)}.</p>}
        {area && areaData && window && (
          <>
            <p className="lede">
              {contractInArea(p, areaData.projects.features, shortName(area), window.min_year, window.max_year)}
            </p>
            <p className="chart-label">
              DPWH flood control contract cost per year in {shortName(area)}
              {years.includes(p.year) ? `, with ${p.year} marked` : ''}
            </p>
            <FundingYearChart
              projects={areaData.projects.features}
              years={years}
              activeYear={years.includes(p.year) ? p.year : null}
            />
            <ul className="caveats">
              <li>The coordinates are the project site, not the area the project protects.</li>
              <li>
                Study areas overlap. A contract counts in every area it falls in, so totals must not
                be added across areas.
              </li>
            </ul>
          </>
        )}
      </section>

      <section className="beat">
        <h3>Site imagery</h3>
        <button className="back" aria-pressed={compare} onClick={() => onCompare(!compare)}>
          {compare ? 'Hide site imagery' : 'Compare site imagery on the map'}
        </button>
        <p className="context-note">
          Use the imagery to look at the site before and after the project years. Narrow or small
          structures can be built and still be hard to see from above, so this is a prompt to look
          closer, not a finding about the project.
        </p>
      </section>

      {back && (
        <button className="bridge" onClick={() => onStory(back.properties.area_id)}>
          <span>Back to the story: Funding</span>
          What kind of work was funded in {shortName(back)}?
        </button>
      )}
    </article>
  )
}
