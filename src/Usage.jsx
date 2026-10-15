// 沐 (CC) 的额度消耗：聊天页顶上一条（上下文多大、额度几点恢复），More 里的 Usage 页看完整的
// 数据来自 /api/cc/usage（bridge 按 usage.jsonl 统计：每次 API 调用的缓存读、缓存写、输入、输出）
// 都是按 token 估算的消耗，不是订阅页上"用了百分之几"的那个数
import { useState, useEffect, useRef, useCallback } from 'react'

const SERIES = [
  { key: 'read', label: '读缓存' },
  { key: 'write', label: '写缓存' },
  { key: 'io', label: '输入输出' },
]

function fmtK(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)}k`
  return String(Math.round(n))
}

const fmtWhen = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const same = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d) === today
  return same ? `${p.hour}:${p.minute}` : `${p.month}月${p.day}日 ${p.hour}:${p.minute}`
}

// 折算成"相当于多少普通输入 token"，分三段
function weighted(b, w) {
  return { read: b.read * w.read, write: b.write * w.write, io: b.input * w.input + b.output * w.output }
}

// ─── 聊天页：上下文进度条 + 额度恢复时间 ─────────────────
// refreshKey 变了就重拉（他回完一轮、压缩完）；另外每 5 分钟拉一次
export function useCcUsageBrief(apiFetch, refreshKey) {
  const [brief, setBrief] = useState(null)
  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/cc/usage?brief=1')
      if (res.ok) setBrief(await res.json())
    } catch {}
  }, [apiFetch])
  useEffect(() => { load() }, [load, refreshKey])
  useEffect(() => { const t = setInterval(load, 5 * 60 * 1000); return () => clearInterval(t) }, [load])
  return brief
}

// 额度用完的提示：直接显示在聊天页顶上（关系到他为什么不回），不收进菜单
export function CcLimitedNotice({ brief }) {
  if (!brief?.limited_until) return null
  return <div className="cc-usage-limited" role="status">额度用完 · {fmtWhen(brief.limited_until)} 恢复</div>
}

// 上下文条：收在聊天页右上角 ⋮ → Usage 里
export function CcUsageStrip({ brief }) {
  if (!brief || brief.context_tokens == null) return <div className="cc-usage-empty">还没有数据，沐回完下一轮就有</div>
  const { context_tokens: ctx, day_cap: cap, nightly_threshold: night } = brief
  return (
    <div className="cc-usage-strip">
      {ctx != null && cap > 0 && (
        <div className="cc-usage-ctx" title={`上下文 ${ctx}，超过 ${night} 每晚压缩，超过 ${cap} 白天也压`}>
          <div className="cc-usage-track" role="progressbar" aria-label="上下文" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={ctx}>
            <div className="cc-usage-fill" style={{ width: `${Math.min(100, (ctx / cap) * 100)}%` }} />
            <div className="cc-usage-tick" style={{ left: `${(night / cap) * 100}%` }} />
          </div>
          <span className="cc-usage-label">上下文 {fmtK(ctx)} / {fmtK(cap)}</span>
        </div>
      )}
    </div>
  )
}

// ─── Usage 页 ─────────────────────────────────────────
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

function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

// 只有顶上那段是圆角（4px），底边贴着基线是方的
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function StackedColumns({ rows, weights, labelOf, tickEvery, selected, onSelect }) {
  const [ref, width] = useWidth()
  const H = 180, top = 8, bottom = 22, left = 34
  const plotH = H - top - bottom
  const data = rows.map(r => weighted(r, weights))
  const max = niceMax(Math.max(...data.map(d => d.read + d.write + d.io), 0))
  const plotW = Math.max(0, width - left)
  const slot = rows.length ? plotW / rows.length : 0
  const barW = Math.max(2, Math.min(24, slot - 2))
  const y = v => top + plotH - (v / max) * plotH
  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - box.left - left) / slot)
    if (i >= 0 && i < rows.length) onSelect(i)
  }
  return (
    <div ref={ref} className="usage-chart">
      {width > 0 && (
        <svg width={width} height={H} onPointerMove={pick} onPointerDown={pick} role="img" aria-label="每段时间折算的消耗，按读缓存、写缓存、输入输出堆叠">
          {[0, 0.5, 1].map(f => (
            <g key={f}>
              <line x1={left} x2={width} y1={y(max * f)} y2={y(max * f)} className="usage-grid" />
              <text x={left - 6} y={y(max * f) + 4} className="usage-axis" textAnchor="end">{fmtK(max * f)}</text>
            </g>
          ))}
          {selected != null && <rect x={left + selected * slot} y={top} width={slot} height={plotH} className="usage-hover" />}
          {data.map((d, i) => {
            const x = left + i * slot + (slot - barW) / 2
            let acc = 0
            const segs = SERIES.map(s => ({ key: s.key, v: d[s.key] })).filter(s => s.v > 0)
            return (
              <g key={i}>
                {segs.map((s, j) => {
                  const y0 = y(acc), y1 = y(acc + s.v)
                  acc += s.v
                  const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0)) // 段与段之间留 2px 底色缝
                  if (h <= 0) return null
                  const last = j === segs.length - 1
                  return last
                    ? <path key={s.key} d={topRounded(x, y1, barW, h, 4)} className={`usage-seg usage-seg-${s.key}`} />
                    : <rect key={s.key} x={x} y={y1} width={barW} height={h} className={`usage-seg usage-seg-${s.key}`} />
                })}
              </g>
            )
          })}
          {rows.map((r, i) => i % tickEvery === 0 && (
            <text key={i} x={left + i * slot + slot / 2} y={H - 6} className="usage-axis" textAnchor="middle">{labelOf(r)}</text>
          ))}
        </svg>
      )}
    </div>
  )
}

const hourLabel = r => `${Number(r.hour.slice(11, 13))}时`
const dayLabel = r => `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`
const rowTitle = (r) => r.hour ? `${Number(r.hour.slice(5, 7))}月${Number(r.hour.slice(8, 10))}日 ${Number(r.hour.slice(11, 13))}:00` : `${Number(r.date.slice(5, 7))}月${Number(r.date.slice(8, 10))}日`

function Detail({ row, weights }) {
  if (!row) return null
  const w = weighted(row, weights)
  const total = w.read + w.write + w.io
  return (
    <div className="usage-detail">
      <div className="usage-detail-head"><span>{rowTitle(row)}</span><span>折算 {fmtK(total)}</span></div>
      <div className="usage-detail-rows">
        <span><i className="usage-key usage-seg-read" />读缓存 {fmtK(row.read)} → {fmtK(w.read)}</span>
        <span><i className="usage-key usage-seg-write" />写缓存 {fmtK(row.write)} → {fmtK(w.write)}</span>
        <span><i className="usage-key usage-seg-io" />输入 {fmtK(row.input)} · 输出 {fmtK(row.output)} → {fmtK(w.io)}</span>
        <span>调用 {row.calls} 次{row.rewrites ? ` · 整段重写 ${row.rewrites} 次（${fmtK(row.rewrite_tokens)}）` : ''}</span>
      </div>
    </div>
  )
}

export function UsagePage({ apiFetch, onBack, backIcon, swipe }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState('hours')
  const [selected, setSelected] = useState(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    let alive = true
    apiFetch('/api/cc/usage?days=30&hours=48')
      .then(async res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then(d => { if (alive) setData(d) })
      .catch(() => { if (alive) setError('拉不到数据，过一会儿再试') })
    return () => { alive = false }
  }, [apiFetch])

  const rows = data ? (range === 'hours' ? data.hours : data.days) : []
  useEffect(() => { setSelected(rows.length ? rows.length - 1 : null) }, [range, rows.length])

  const today = data?.days?.[data.days.length - 1]
  const hit = today && today.read + today.write > 0 ? today.read / (today.read + today.write) : null
  const todayCost = today && data ? Object.values(weighted(today, data.weights)).reduce((a, b) => a + b, 0) : null

  return (
    <div className="more-sub-page usage-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={onBack}>{backIcon}</button><h1>Usage</h1></div>
      {error && <div className="card usage-note">{error}</div>}
      {!data && !error && <div className="empty-state">Loading…</div>}
      {data && <>
        <div className="card">
          <CcUsageStrip brief={data} />
          <div className="usage-meta">
            {data.compacting ? '正在压缩' : data.last_compact_at ? `上次压缩 ${fmtWhen(data.last_compact_at)}` : '还没自动压缩过'}
            {data.context_at ? ` · 上下文更新于 ${fmtWhen(data.context_at)}` : ''}
          </div>
        </div>

        <div className="usage-tiles">
          <div className="usage-tile"><div className="usage-tile-num">{today?.calls ?? 0}</div><div className="usage-tile-label">今天调用</div></div>
          <div className="usage-tile"><div className="usage-tile-num">{hit == null ? '—' : `${hit >= 0.99 && hit < 1 ? (hit * 100).toFixed(1) : Math.round(hit * 100)}%`}</div><div className="usage-tile-label">缓存命中</div></div>
          <div className="usage-tile"><div className="usage-tile-num">{today?.rewrites ?? 0}</div><div className="usage-tile-label">整段重写</div></div>
          <div className="usage-tile"><div className="usage-tile-num">{fmtK(todayCost)}</div><div className="usage-tile-label">今天折算</div></div>
        </div>

        <div className="card">
          <div className="usage-toolbar">
            <div className="usage-seg-ctl" role="tablist">
              <button role="tab" aria-selected={range === 'hours'} className={range === 'hours' ? 'on' : ''} onClick={() => setRange('hours')}>48 小时</button>
              <button role="tab" aria-selected={range === 'days'} className={range === 'days' ? 'on' : ''} onClick={() => setRange('days')}>30 天</button>
            </div>
            <button className="usage-link" onClick={() => setShowTable(v => !v)}>{showTable ? '看图' : '表格'}</button>
          </div>
          {!showTable && <div className="usage-legend">
            {SERIES.map(s => <span key={s.key}><i className={`usage-key usage-seg-${s.key}`} />{s.label}</span>)}
          </div>}
          {showTable
            ? <UsageTable rows={rows} weights={data.weights} />
            : <>
                <Detail row={rows[selected]} weights={data.weights} />
                <StackedColumns rows={rows} weights={data.weights} selected={selected} onSelect={setSelected}
                  labelOf={range === 'hours' ? hourLabel : dayLabel} tickEvery={range === 'hours' ? 6 : 5} />
              </>}
        </div>

        <div className="usage-note">
          按 token 估算，换算成"相当于多少普通输入"：读缓存 ×{data.weights.read}、写缓存 ×{data.weights.write}、输出 ×{data.weights.output}。
          不是订阅页上的百分比。一次写缓存超过 {fmtK(data.rewrite_min)} 算整段重写（缓存过期或压缩后重建）。
          {data.first ? ` 记录从 ${fmtWhen(data.first)} 开始。` : ''}
        </div>
      </>}
    </div>
  )
}

function UsageTable({ rows, weights }) {
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead><tr><th>时间</th><th>调用</th><th>读</th><th>写</th><th>输出</th><th>重写</th><th>折算</th></tr></thead>
        <tbody>
          {[...rows].reverse().filter(r => r.calls).map(r => {
            const w = weighted(r, weights)
            return <tr key={r.hour || r.date}><td>{rowTitle(r)}</td><td>{r.calls}</td><td>{fmtK(r.read)}</td><td>{fmtK(r.write)}</td><td>{fmtK(r.output)}</td><td>{r.rewrites || ''}</td><td>{fmtK(w.read + w.write + w.io)}</td></tr>
          })}
        </tbody>
      </table>
    </div>
  )
}
