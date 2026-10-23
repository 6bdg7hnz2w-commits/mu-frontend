import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../App.jsx'
import { useTopColor } from './ui.jsx'

// ─── Memory ─────────────────────────────────────────
// 沐的记忆文件画成一张等高线地图：一个文件一站，从最新的往下走到最早的，红线走到选中的那一站。
// 数据：/api/cc/memory（bridge 直接只读 沐 的 memory 文件夹），App 里只能看不能改；最新的在最上面

const VB = 390 // 画布按 390 宽设计，横坐标按实际宽度等比放
const XS = [84, 272, 128, 300, 92, 256, 120, 292]
const STEP = 150, FIRST_Y = 330
const HILLS = [[318, 150, 7], [-10, 470, 8], [360, 640, 6], [150, 860, 9], [380, 1110, 7], [40, 1300, 6], [230, 1420, 5]]

const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const f1 = (n) => Math.round(n * 10) / 10
function smooth(pts, closed, from, to) {
  const n = pts.length, at = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]
  const last = closed ? n : n - 1, a = from || 0, b = to === undefined ? last : to
  let d = `M${f1(at(a)[0])},${f1(at(a)[1])}`
  for (let i = a; i < b; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`
  }
  return closed ? d + 'Z' : d
}
const md = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}.${d.getDate()}` }
const ymd = (iso) => { const d = new Date(iso); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` }

// 等高线：一组山头按地图高度往下重复铺
function contours(height, sx) {
  const r = rng(7), out = []
  for (let base = 0, block = 0; base < height; base += 1400, block++) {
    HILLS.forEach(([cx, cy, n], hi) => {
      if (base + cy - 200 > height) return
      const ph = [r() * 6.28, r() * 6.28, r() * 6.28], am = [0.16 + r() * 0.1, 0.08 + r() * 0.06, 0.04 + r() * 0.03]
      for (let k = 0; k < n; k++) {
        const rad = 16 + k * (20 + r() * 4), pts = []
        for (let j = 0; j < 40; j++) {
          const a = j / 40 * Math.PI * 2
          const rr = rad * (1 + am[0] * Math.sin(2 * a + ph[0] + k * 0.12) + am[1] * Math.sin(3 * a + ph[1] - k * 0.1) + am[2] * Math.sin(5 * a + ph[2]))
          pts.push([(cx + rr * Math.cos(a) * 1.25) * sx, base + cy + rr * Math.sin(a)])
        }
        out.push(<path key={`c${block}-${hi}-${k}`} d={smooth(pts, true)} className={`v-map-contour ${k % 4 === 3 ? 'bold' : ''}`} />)
      }
    })
  }
  return out
}

function Tear({ width }) {
  const r = rng(11), fib = [], navy = []
  for (let x = -10; x <= width + 10; x += 9 + r() * 10) { fib.push([x, 14 + r() * 16]); navy.push([x, 22 + r() * 22]) }
  const poly = (pts, base) => 'M' + pts.map(p => `${f1(p[0])},${f1(p[1])}`).join('L') + `L${width + 10},${base}L-10,${base}Z`
  const lx = width - 128
  return (
    <svg width={width} height={260} className="v-map-tear">
      <path d={`M${lx},44C${lx},-8 ${lx + 110},-8 ${lx + 110},44Z`} className="v-map-lake" />
      <path d={poly(fib, 260)} className="v-map-fiber" />
      <path d={poly(navy, 260)} className="v-map-navy" />
    </svg>
  )
}

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(VB)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// 记忆文件是 markdown：# 标题略过（上面已经有），## 小节、- 列表、普通段落
function Body({ text }) {
  return text.split('\n').map((l, i) => l.startsWith('# ') ? null
    : l.startsWith('## ') || l.startsWith('### ') ? <div key={i} className="v-mem-h2">{l.replace(/^#+\s*/, '').toUpperCase()}</div>
    : /^\s*[-*] /.test(l) ? <div key={i} className="v-mem-li"><span>·</span><span>{l.replace(/^\s*[-*] /, '')}</span></div>
    : l.trim() ? <div key={i} className="v-mem-p">{l}</div> : <div key={i} className="v-mem-gap" />)
}

export default function MemoryPage({ onBack }) {
  const [files, setFiles] = useState(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState(null)
  const [open, setOpen] = useState(false)
  const [ref, W] = useWidth()
  useTopColor('#efebe2', '#12161f', 2) // 地图纸的颜色
  useEffect(() => {
    apiFetch('/api/cc/memory').then(async r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => { const list = Array.isArray(d?.files) ? d.files : []; setFiles(list.slice().reverse()); setSel(0) })
      .catch(() => setError("Couldn't reach Soren's memory — try again later"))
  }, [])

  const sx = W / VB
  const list = files || []
  const pts = list.map((_, i) => [XS[i % XS.length] * sx, FIRST_Y + i * STEP])
  const tearY = (pts.length ? pts[pts.length - 1][1] : FIRST_Y) + 130
  const mapH = tearY + 260
  const path = [[-20, 236]].concat(pts).concat([[W / 2, tearY + 10]])
  const bits = useMemo(() => contours(tearY, sx), [tearY, sx])
  const doc = sel != null ? list[sel] : null
  const sp = sel != null ? pts[sel] : null
  const right = sp && sp[0] < W / 2
  const excerpt = doc ? doc.body.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.replace(/^\s*[-*] /, '')).join(' ').slice(0, 42) + '…' : ''

  return (
    <div className="v-map">
      <div className="v-map-head">
        <button className="v-rd-btn" onClick={onBack} aria-label="Back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14.5 5.5 8 12l6.5 6.5" /></svg></button>
      </div>
      <div className="v-map-topfade" />
      <div className="v-map-stamp">
        <svg width="30" height="18" viewBox="0 0 30 18"><path d="M1,17L10,5L15,11L20,3L29,17Z" className="ink" /><path d="M18,6L20,3L22,6Z" className="paper" /></svg>
        <b>S</b><span>EST. 2026</span>
      </div>
      <div className="v-map-scroll" ref={ref}>
        <div className="v-map-sheet" style={{ height: files ? mapH : '100%' }}>
          {files && (
            <svg width={W} height={tearY + 40} className="v-map-svg">
              {[...Array(Math.floor(W / 78))].map((_, k) => <line key={`gx${k}`} x1={(k + 1) * 78} x2={(k + 1) * 78} y1={0} y2={tearY} className="v-map-grid" />)}
              {[...Array(Math.floor(tearY / 78))].map((_, k) => <line key={`gy${k}`} x1={0} x2={W} y1={(k + 1) * 78} y2={(k + 1) * 78} className="v-map-grid" />)}
              {bits}
              {[560, 1160, 1760, 2360, 2960].filter(y => y < tearY - 60).map(y => <path key={`rv${y}`} d={smooth([[-20, y], [80 * sx, y + 30], [190 * sx, y - 10], [290 * sx, y + 26], [W + 20, y - 6]], false)} className="v-map-river" />)}
              {list.length > 0 && <>
                <path d={smooth(path, false)} className="v-map-route" />
                <path d={smooth(path, false, 0, sel + 1)} className="v-map-walked" />
              </>}
              {list.map((f, i) => {
                const [x, y] = pts[i], on = i === sel, past = i < sel, lab = x < W / 2
                return (
                  <g key={f.name} onClick={() => setSel(i)} className="v-map-node">
                    <circle cx={x} cy={y} r={22} fill="transparent" />
                    {on && <circle cx={x} cy={y} r={14} className="v-map-ring" />}
                    <circle cx={x} cy={y} r={on ? 8 : 6.5} className={`v-map-dot ${on ? 'on' : ''}`} />
                    <text x={x} y={y - 22} textAnchor="middle" className={`v-map-date ${past || on ? 'done' : ''}`}>{md(f.mtime)}</text>
                    <text x={lab ? x + 18 : x - 18} y={y + 26} textAnchor={lab ? 'start' : 'end'} className="v-map-file">{f.name.toUpperCase()}</text>
                  </g>
                )
              })}
            </svg>
          )}
          <div className="v-map-title">
            <div className="v-map-kicker">SHEET 01 · SCALE 1 : 1 DAY</div>
            <div className="v-map-big">THE ROUTE<br />SO FAR</div>
            <div className="v-map-sub">{error || (files ? `Soren's memory · ${list.length} file${list.length === 1 ? '' : 's'}` : 'Unfolding the map…')}</div>
          </div>
          <svg width="64" height="64" viewBox="-32 -32 64 64" className="v-map-compass">
            <circle r={28} className="line" /><circle r={22} className="line dot" />
            <path d="M0,-26L4,0L0,26L-4,0Z" className="mute" /><path d="M0,-26L4,0L-4,0Z" className="ink" /><path d="M-24,0L0,3L24,0L0,-3Z" className="mute faint" />
            <text y={-30} textAnchor="middle">N</text>
          </svg>
          {doc && sp && (
            <div key={sel} className="v-map-pop" onClick={() => setOpen(true)} style={{ top: sp[1] - 64, left: right ? sp[0] + 28 : Math.max(8, sp[0] - 238) }}>
              <div className="v-map-pop-meta">{ymd(doc.mtime)} · {(doc.size / 1024).toFixed(1)} KB</div>
              <div className="v-map-pop-title">{doc.title}</div>
              <div className="v-map-pop-text">{excerpt}</div>
              <div className="v-map-pop-more">READ IN FULL →</div>
            </div>
          )}
          {files && <>
            <div style={{ position: 'absolute', left: 0, top: tearY }}><Tear width={W} /></div>
            <div className="v-map-end" style={{ top: tearY + 66 }}>LAST STOP — NEXT PAGE UNWRITTEN</div>
          </>}
        </div>
      </div>
      {open && doc && (
        <div className="v-map-reader-wrap" onClick={() => setOpen(false)}>
          <div className="v-map-reader" onClick={e => e.stopPropagation()}>
            <div className="v-map-reader-head">
              <div><div className="v-map-pop-meta">{doc.name.toUpperCase()} · {ymd(doc.mtime)}</div><div className="v-map-reader-title">{doc.title}</div></div>
              <button onClick={() => setOpen(false)} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
            </div>
            <div className="v-map-reader-body"><Body text={doc.body} /></div>
          </div>
        </div>
      )}
    </div>
  )
}
