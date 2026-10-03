import { CATEGORIES, formatPhp } from './api'
import type { ProjectFeature } from './api'

interface Props {
  project: ProjectFeature
  compare: boolean
  onCompare: (on: boolean) => void
  onClose: () => void
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="field">
      <dt className="label">{label}</dt>
      <dd>{value ?? 'Not recorded'}</dd>
    </div>
  )
}

export default function ProjectCard({ project, compare, onCompare, onClose }: Props) {
  const p = project.properties
  const [lon, lat] = project.geometry.coordinates
  const category = CATEGORIES.find((c) => c.key === p.category)
  const place = [p.municipality, p.province].filter(Boolean).join(', ')

  return (
    <article className="project-card">
      <button className="back" onClick={onClose}>
        Back to the area
      </button>
      <h2>{p.type_of_work ?? 'Flood control project'}</h2>
      {place && <p className="place">{place}</p>}
      <div className="badges">
        {category && (
          <span className="badge" style={{ borderColor: category.color }}>
            <span className="dot" style={{ background: category.color }} />
            {category.label}
          </span>
        )}
        <span className="badge">
          {p.completion_date ? 'Reported complete' : 'No completion date on record'}
        </span>
      </div>

      <button className="back" aria-pressed={compare} onClick={() => onCompare(!compare)}>
        {compare ? 'Hide site imagery' : 'Compare site imagery on the map'}
      </button>

      <p className="context-note">
        Use the imagery to look at the site before and after the project years. Narrow or small
        structures can be built and still be hard to see from above, so this is a prompt to look
        closer, not a finding about the project.
      </p>

      <dl className="fields">
        <Field label="Contract cost" value={p.amount_php == null ? null : formatPhp(p.amount_php)} />
        <Field label="Approved budget" value={p.abc_php == null ? null : formatPhp(p.abc_php)} />
        <Field label="Contractor" value={p.contractor} />
        <Field label="Funding year" value={String(p.year)} />
        <Field label="Started" value={p.start_date} />
        <Field label="Completed" value={p.completion_date} />
        <Field label="Project ID" value={p.project_id ?? p.component_id} />
        <Field label="Site" value={`${lat.toFixed(5)}, ${lon.toFixed(5)}`} />
      </dl>
      <p className="compare-note">
        Source: DPWH flood control projects. The coordinates are the project site, not the area the
        project protects.
      </p>
    </article>
  )
}
