import { useEffect, useRef, useState } from 'react'
import { useCached, peek } from './data.js'
import { fmtWhenEn } from '../Usage.jsx'
import { SubPage } from './ui.jsx'

// ─── Usage ──────────────────────────────────────────
// 和 Clawd 的 Usage 页同一个接口 /api/cc/usage：最上面 Resets 是订阅额度（5 小时 / 7 天用了多少、几点恢复），
// 下面是上下文条、今天的四个数、按 token 折算的堆叠柱状图（48 小时 / 30 天，可以切表格）

const fmtK = (n) => n == null || !Number.isFinite(n) ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)}k` : String(Math.round(n))
const weighted = (r, w) => ({ read: r.read * w.read, write: r.write * w.write, io: r.input * w.input + r.output * w.output })
const COLOR = { read: 'var(--v-acc)', write: 'var(--v-gold)', io: 'var(--v-her)' }
const SERIES = [['read', 'Cache read'], ['write', 'Cache write'], ['io', 'In / out']]
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return !Number.isFinite(m) ? '' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
const rowLabel = (r) => r.hour ? `${Number(r.hour.slice(11, 13))}:00` : `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`

function LimitBar({ label, w }) {
  if (!w) return null
  const resets = Date.parse(w.resets_at)
  const back = Number.isFinite(resets) && resets <= Date.now()
  const pct = back ? 0 : Math.max(0, Math.min(100, Math.round(w.used_percentage)))
  const warn = pct >= 90
  return (
    <div className="v-limit">
      <div className="v-limit-top">
        <b>{label}</b><span>{back ? 'reset' : `${pct}% used`}</span>
        <em className={warn ? 'warn' : ''}>{back ? 'Available again' : Number.isFinite(resets) ? fmtWhenEn(w.resets_at) : ''}</em>
      </div>
      <div className="v-limit-track"><i className={warn ? 'warn' : ''} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function Chart({ rows, weights, sel, onSel, hours }) {
  const [ref, W] = useWidth()
  const H = 170, top = 8, bottom = 22, left = 34, plotH = H - top - bottom
  const data = rows.map(r => weighted(r, weights))
  const mx = Math.max(...data.map(d => d.read + d.write + d.io), 1)
  const p10 = 10 ** Math.floor(Math.log10(mx))
  const max = [1, 2, 2.5, 5, 10].map(m => m * p10).find(v => v >= mx)
  const slot = rows.length ? (W - left) / rows.length : 0
  const bw = Math.max(2, Math.min(18, slot - 2))
  const Y = v => top + plotH - (v / max) * plotH
  const pick = (ev) => { const r = ev.currentTarget.getBoundingClientRect(); const i = Math.floor((ev.clientX - r.left - left) / slot); if (i >= 0 && i < rows.length) onSel(i) }
  return (
    <div ref={ref} className="v-chart">
      {W > 0 && (
        <svg width={W} height={H} onPointerMove={pick} onPointerDown={pick}>
          {[0, 0.5, 1].map(f => <g key={f}><line x1={left} x2={W} y1={Y(max * f)} y2={Y(max * f)} /><text x={left - 6} y={Y(max * f) + 4} textAnchor="end">{fmtK(max * f)}</text></g>)}
          {sel != null && <rect x={left + sel * slot} y={top} width={slot} height={plotH} className="v-chart-sel" />}
          {data.map((d, i) => {
            let acc = 0
            return (
              <g key={i}>{['read', 'write', 'io'].map(k => {
                const y0 = Y(acc), y1 = Y(acc + d[k]); acc += d[k]
                return <rect key={k} x={left + i * slot + (slot - bw) / 2} y={y1} width={bw} height={Math.max(0, y0 - y1 - 1)} rx={k === 'io' ? 2 : 0} fill={COLOR[k]} opacity={i === sel ? 1 : 0.78} />
              })}</g>
            )
          })}
          {rows.map((r, i) => i % (hours ? 6 : 5) === 0 && <text key={`t${i}`} x={left + i * slot + slot / 2} y={H - 6} textAnchor="middle">{hours ? `${Number(r.hour.slice(11, 13))}h` : rowLabel(r)}</text>)}
        </svg>
      )}
    </div>
  )
}

export default function UsagePage({ onBack }) {
  const data = useCached('usage', null) // 开场时已经取过、存在本地：进来直接是数，不从空白跳出来
  const [error, setError] = useState('')
  const [range, setRange] = useState('hours')
  const [sel, setSel] = useState(null)
  const [table, setTable] = useState(false)
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => { if (alive && !peek('usage')) setError("Couldn't load usage — try again later") }, 8000)
    return () => { alive = false; clearTimeout(t) }
  }, [])

  const rows = data ? (range === 'hours' ? data.hours || [] : data.days || []) : []
  const s = sel == null ? rows.length - 1 : Math.min(sel, rows.length - 1)
  const row = rows[s]
  const today = data?.days?.[data.days.length - 1]
  const hit = today && today.read + today.write > 0 ? today.read / (today.read + today.write) : null
  const todayW = today && data ? Object.values(weighted(today, data.weights)).reduce((a, b) => a + b, 0) : null
  const rl = data?.rate_limits
  const w = row && data ? weighted(row, data.weights) : null

  return (
    <SubPage title="Usage" onBack={onBack}>
      {error && <div className="v-card v-usage-note">{error}</div>}
      {!data && !error && <div className="v-empty">Loading…</div>}
      {data && <>
        {rl && (rl.five_hour || rl.seven_day) && (
          <div className="v-card v-limits">
            <div className="v-limits-head"><span>Resets</span><em>Plan limits{rl.updated_at ? ` · ${ago(rl.updated_at)}` : ''}</em></div>
            <LimitBar label="5-hour" w={rl.five_hour} />
            <LimitBar label="7-day" w={rl.seven_day} />
          </div>
        )}
        {data.context_tokens != null && data.day_cap > 0 && (
          <div className="v-card v-ctx">
            <div className="v-ctx-track"><i style={{ width: `${Math.min(100, (data.context_tokens / data.day_cap) * 100)}%` }} /><b style={{ left: `${(data.nightly_threshold / data.day_cap) * 100}%` }} /></div>
            <div className="v-ctx-label">Context {fmtK(data.context_tokens)} / {fmtK(data.day_cap)}</div>
            <div className="v-ctx-meta">
              {data.compacting ? 'Compacting now' : data.last_compact_at ? `Last compacted ${fmtWhenEn(data.last_compact_at).replace('Today ', '')}` : 'Not compacted yet'}
              {data.context_at ? ` · updated ${fmtWhenEn(data.context_at).replace('Today ', '')}` : ''}
            </div>
          </div>
        )}
        <div className="v-utiles">
          <div><b>{today?.calls ?? 0}</b><span>Calls today</span></div>
          <div><b>{hit == null ? '—' : `${hit >= 0.99 && hit < 1 ? (hit * 100).toFixed(1) : Math.round(hit * 100)}%`}</b><span>Cache hit</span></div>
          <div><b>{today?.rewrites ?? 0}</b><span>Rewrites</span></div>
          <div><b>{fmtK(todayW)}</b><span>Weighted</span></div>
        </div>
        <div className="v-card v-uchart">
          <div className="v-uchart-bar">
            <div className="v-useg">
              <button className={range === 'hours' ? 'on' : ''} onClick={() => { setRange('hours'); setSel(null) }}>48 hours</button>
              <button className={range === 'days' ? 'on' : ''} onClick={() => { setRange('days'); setSel(null) }}>30 days</button>
            </div>
            <button className="v-text-btn acc" onClick={() => setTable(t => !t)}>{table ? 'Chart' : 'Table'}</button>
          </div>
          {table ? (
            <div className="v-utable-wrap">
              <table className="v-utable">
                <thead><tr><th>Time</th><th>Calls</th><th>Read</th><th>Write</th><th>Out</th><th>Weighted</th></tr></thead>
                <tbody>{[...rows].reverse().filter(r => r.calls).map(r => { const x = weighted(r, data.weights); return <tr key={r.hour || r.date}><td>{rowLabel(r)}</td><td>{r.calls}</td><td>{fmtK(r.read)}</td><td>{fmtK(r.write)}</td><td>{fmtK(r.output)}</td><td>{fmtK(x.read + x.write + x.io)}</td></tr> })}</tbody>
              </table>
            </div>
          ) : <>
            <div className="v-ulegend">{SERIES.map(([k, t]) => <span key={k}><i style={{ background: COLOR[k] }} />{t}</span>)}</div>
            {row && w && (
              <div className="v-udetail">
                <div><span>{rowLabel(row)}</span><span>Weighted {fmtK(w.read + w.write + w.io)}</span></div>
                <span>Read {fmtK(row.read)} → {fmtK(w.read)} · Write {fmtK(row.write)} → {fmtK(w.write)}</span>
                <span>{row.calls} calls{row.rewrites ? ` · ${row.rewrites} rewrites` : ''}</span>
              </div>
            )}
            <Chart rows={rows} weights={data.weights} sel={s} onSel={setSel} hours={range === 'hours'} />
          </>}
        </div>
        <div className="v-tip mute">Estimated from tokens, weighted as plain input: cache read ×{data.weights.read}, cache write ×{data.weights.write}, output ×{data.weights.output}. Only the Resets card shows the plan percentages.</div>
      </>}
    </SubPage>
  )
}
