// Hand-rolled SVG charts. Rules: single series (no legend box — the title
// names it), series colour from --series-1, bars ≤ 24px with a 4px rounded
// data-end and a square baseline, ≥ 2px surface gap, hairline solid grid,
// clean round ticks, selective direct labels, hover + focus tooltips on
// oversized hit targets, and a Table view of the same data.
import { ChartColumnBig, Table2 } from 'lucide-react'
import { useState } from 'react'
import { useElementWidth } from '../../lib/hooks.js'

/** Clean round tick values from 0 to ≥ max. */
export function niceTicks(max, count = 4, integer = false) {
  if (!(max > 0)) return integer ? [0, 1] : [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  let step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag
  if (integer) step = Math.max(1, Math.ceil(step))
  const top = Math.ceil(max / step - 1e-9) * step
  const ticks = []
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return ticks
}

/** Vertical bar rising from baseline y0 with rounded top corners only. */
function columnPath(x, y0, w, h, r = 4) {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  const top = y0 - h
  return `M${x},${y0}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${y0}Z`
}

export function DataTable({ columns, rows, caption }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'num' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'num' : ''}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ChartCard({ title, subtitle, table, children, className = '' }) {
  const [view, setView] = useState('chart')
  return (
    <figure className={`card chart-card ${className}`}>
      <figcaption className="chart-head">
        <div>
          <h3 className="chart-title">{title}</h3>
          {subtitle && <p className="chart-sub">{subtitle}</p>}
        </div>
        <div className="segmented segmented-sm" role="group" aria-label={`${title}: view`}>
          <button type="button" className={`segment${view === 'chart' ? ' is-on' : ''}`} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
            <ChartColumnBig size={13} aria-hidden="true" /> Chart
          </button>
          <button type="button" className={`segment${view === 'table' ? ' is-on' : ''}`} aria-pressed={view === 'table'} onClick={() => setView('table')}>
            <Table2 size={13} aria-hidden="true" /> Table
          </button>
        </div>
      </figcaption>
      <div className="chart-body">{view === 'chart' ? children : table}</div>
    </figure>
  )
}

function Tooltip({ x, y, width, value, label }) {
  const left = Math.max(70, Math.min(width - 70, x))
  return (
    <div className="chart-tooltip" style={{ left, top: y }} role="presentation">
      <div className="chart-tooltip-value">{value}</div>
      <div className="chart-tooltip-label">{label}</div>
    </div>
  )
}

/**
 * Vertical column chart.
 * data: [{ key, value, label (x label or null), tip: {value, label}, aria }]
 */
export function ColumnChart({ data, height = 190, integer = false, yFormat = (v) => v, reference, labelIndex, ariaLabel, empty }) {
  const [ref, width] = useElementWidth()
  const [hover, setHover] = useState(null)
  const m = { top: 22, right: 8, bottom: 28, left: 40 }
  const max = Math.max(0, ...data.map((d) => d.value), reference?.value ?? 0)
  const ticks = niceTicks(max, 4, integer)
  const yMax = ticks[ticks.length - 1] || 1
  const plotW = Math.max(0, width - m.left - m.right)
  const slot = data.length ? plotW / data.length : 0
  const barW = Math.max(2, Math.min(24, slot * 0.66, slot - 2))
  const y0 = m.top + height
  const yOf = (v) => y0 - (v / yMax) * height
  const total = height + m.top + m.bottom
  const active = hover != null ? data[hover] : null

  return (
    <div className="chart" ref={ref} style={{ height: total }}>
      {width > 0 && (
        <svg width={width} height={total} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'chart-baseline' : 'chart-grid'} x1={m.left} x2={width - m.right} y1={yOf(t)} y2={yOf(t)} />
              <text className="chart-axis" x={m.left - 8} y={yOf(t)} dy="0.32em" textAnchor="end">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = m.left + i * slot + (slot - barW) / 2
            const h = (d.value / yMax) * height
            return <path key={d.key} className={`chart-bar${hover === i ? ' is-active' : ''}`} d={columnPath(x, y0, barW, h)} />
          })}
          {reference && reference.value > 0 && (
            <g className="chart-ref">
              <line x1={m.left} x2={width - m.right} y1={yOf(reference.value)} y2={yOf(reference.value)} />
              <text x={width - m.right} y={yOf(reference.value) - 6} textAnchor="end">
                {reference.label}
              </text>
            </g>
          )}
          {labelIndex != null && data[labelIndex] && data[labelIndex].value > 0 && (
            <text
              className="chart-value"
              x={m.left + labelIndex * slot + slot / 2}
              y={yOf(data[labelIndex].value) - 7}
              textAnchor="middle"
            >
              {data[labelIndex].valueLabel ?? data[labelIndex].value}
            </text>
          )}
          {data.map((d, i) =>
            d.label ? (
              <text key={`x-${d.key}`} className="chart-axis" x={m.left + i * slot + slot / 2} y={y0 + 18} textAnchor="middle">
                {d.label}
              </text>
            ) : null,
          )}
          {data.map((d, i) => (
            <rect
              key={`hit-${d.key}`}
              className="chart-hit"
              x={m.left + i * slot}
              y={m.top - 10}
              width={Math.max(slot, 1)}
              height={height + 10}
              tabIndex={0}
              role="img"
              aria-label={d.aria}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
            />
          ))}
        </svg>
      )}
      {active && (
        <Tooltip
          x={m.left + hover * slot + slot / 2}
          y={Math.min(yOf(active.value), y0 - 4) - 10}
          width={width}
          value={active.tip?.value ?? active.value}
          label={active.tip?.label ?? active.label}
        />
      )}
      {empty && !data.some((d) => d.value > 0) && <div className="chart-empty">{empty}</div>}
    </div>
  )
}

/**
 * Horizontal bar chart (category rows). data: [{ key, label, icon, tone, value }]
 * Bars carry the status colour (paired with icon + label), value at the tip of
 * the longest bar only; the rest via tooltip and table.
 */
export function HBarChart({ data, ariaLabel, unit = 'tasks' }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(0, ...data.map((d) => d.value))
  const ticks = niceTicks(max, 4, true)
  const top = ticks[ticks.length - 1] || 1
  const maxIndex = data.findIndex((d) => d.value === max)
  return (
    <div className="hbar" role="group" aria-label={ariaLabel}>
      <div className="hbar-grid" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className={t === 0 ? 'hbar-gridline is-base' : 'hbar-gridline'} style={{ left: `${(t / top) * 100}%` }} />
        ))}
      </div>
      {data.map((d, i) => {
        const Icon = d.icon
        const pct = (d.value / top) * 100
        return (
          <div
            key={d.key}
            className={`hbar-row${hover === i ? ' is-active' : ''}`}
            tabIndex={0}
            role="img"
            aria-label={`${d.label}: ${d.value} ${unit}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)}
            onBlur={() => setHover((h) => (h === i ? null : h))}
          >
            <span className="hbar-label">
              {Icon && <Icon size={14} className={`tone-icon tone-${d.tone}`} aria-hidden="true" />}
              {d.label}
            </span>
            <span className="hbar-track">
              {d.value > 0 && <span className={`hbar-bar bar-${d.tone}`} style={{ width: `${pct}%` }} />}
              {i === maxIndex && d.value > 0 && (
                <span className="hbar-value" style={{ left: `calc(${pct}% + 6px)` }}>
                  {d.value}
                </span>
              )}
              {hover === i && (
                <span className="chart-tooltip hbar-tooltip" style={{ left: `min(calc(${pct}% + 12px), calc(100% - 120px))` }}>
                  <span className="chart-tooltip-value">
                    {d.value} {d.value === 1 ? unit.replace(/s$/, '') : unit}
                  </span>
                  <span className="chart-tooltip-label">{d.label}</span>
                </span>
              )}
            </span>
          </div>
        )
      })}
      <div className="hbar-axis" aria-hidden="true">
        <span className="hbar-label" />
        <span className="hbar-ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${(t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
