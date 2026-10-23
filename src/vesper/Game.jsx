import { useEffect, useRef, useState } from 'react'
import { DrawGuessGame } from '../App.jsx'
import { SubPage } from './ui.jsx'

// ─── Game ───────────────────────────────────────────
// 两盒卡带：五子棋（只在手机上跑，Soren 用一个简单的打分 AI 下白子）和你画我猜（借 Clawd 的那个）

const GN = 15
const S = 330
const SAYS = ['嗯。', '这步我看到了。', '你在围我？', '慢慢下，我不急。', '……有点意思。', '换我了。']
const fresh = () => ({ board: Array(GN * GN).fill(0), last: null, win: 0, line: [], hist: [], busy: false, say: '你先。黑子是你的。' })

function lineOf(b, i, p) {
  const x = i % GN, y = Math.floor(i / GN)
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const cells = [i]
    for (const sg of [1, -1]) for (let k = 1; k < 5; k++) {
      const nx = x + dx * k * sg, ny = y + dy * k * sg
      if (nx < 0 || ny < 0 || nx >= GN || ny >= GN || b[ny * GN + nx] !== p) break
      cells.push(ny * GN + nx)
    }
    if (cells.length >= 5) return cells
  }
  return null
}
// 这一格对 p 有多好：连成几个、两头空几头
function score(b, i, p) {
  const x = i % GN, y = Math.floor(i / GN)
  let sc = 0
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let n = 1, open = 0
    for (const sg of [1, -1]) {
      for (let k = 1; k < 5; k++) {
        const nx = x + dx * k * sg, ny = y + dy * k * sg
        if (nx < 0 || ny < 0 || nx >= GN || ny >= GN) break
        const v = b[ny * GN + nx]
        if (v === p) n++; else { if (v === 0) open++; break }
      }
    }
    sc += n >= 5 ? 1e6 : n === 4 ? (open === 2 ? 5e4 : open ? 6000 : 0) : n === 3 ? (open === 2 ? 4000 : open ? 300 : 0) : n === 2 ? (open === 2 ? 200 : open ? 20 : 0) : open
  }
  return sc
}
function pick(b) {
  if (b.every(v => !v)) return 7 * GN + 7
  let best = -1, bs = -1
  for (let i = 0; i < b.length; i++) {
    if (b[i]) continue
    const x = i % GN, y = Math.floor(i / GN)
    let near = false
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < GN && ny < GN && b[ny * GN + nx]) { near = true; break }
    }
    if (!near) continue
    const sc = score(b, i, 2) * 1.1 + score(b, i, 1) + (7 - Math.max(Math.abs(x - 7), Math.abs(y - 7))) * 0.5
    if (sc > bs) { bs = sc; best = i }
  }
  return best
}

function Gomoku({ onBack }) {
  const [g, setG] = useState(fresh)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const cell = S / GN, pad = cell / 2, win = new Set(g.line)

  const move = (i) => {
    if (g.win || g.busy || g.board[i]) return
    const b = g.board.slice(); b[i] = 1
    const w = lineOf(b, i, 1)
    if (w) { setG({ ...g, board: b, last: i, win: 1, line: w, hist: [...g.hist, i], say: '……这局算你的。再来一局，我认真了。' }); return }
    const threat = score(g.board, i, 1) >= 4000
    const g1 = { ...g, board: b, last: i, hist: [...g.hist, i], busy: true, say: threat ? '你在围我？' : '在想…' }
    setG(g1)
    timer.current = setTimeout(() => {
      const j = pick(g1.board)
      if (j < 0) { setG({ ...g1, busy: false, say: '平局。' }); return }
      const b2 = g1.board.slice(); b2[j] = 2
      const w2 = lineOf(b2, j, 2)
      setG({ ...g1, board: b2, last: j, busy: false, hist: [...g1.hist, j], win: w2 ? 2 : 0, line: w2 || [],
        say: w2 ? '我赢了。要不要再来？这次让你三步。' : SAYS[g1.hist.length % SAYS.length] })
    }, 520)
  }
  const tap = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect(), k = r.width / S
    const gx = Math.round(((ev.clientX - r.left) / k - pad) / cell), gy = Math.round(((ev.clientY - r.top) / k - pad) / cell)
    if (gx >= 0 && gy >= 0 && gx < GN && gy < GN) move(gy * GN + gx)
  }
  const undo = () => {
    if (g.busy || g.hist.length < 2 || g.win === 1) return
    const h2 = g.hist.slice(0, -2), b = g.board.slice()
    g.hist.slice(-2).forEach(i => { b[i] = 0 })
    setG({ ...g, board: b, hist: h2, last: h2[h2.length - 1] ?? null, win: 0, line: [], say: '好，这步不算。' })
  }
  const status = g.win === 1 ? 'You win' : g.win === 2 ? 'Soren wins' : g.busy ? "Soren's move" : 'Your move'

  return (
    <SubPage title="Gomoku" onBack={onBack}>
      <div className="v-gm-top">
        <div className="v-gm-who"><i className="b" />Me<em>vs</em><i className="w" />Soren</div>
        <div className={`v-gm-status ${g.win ? 'win' : ''}`}>{status}</div>
      </div>
      <div className="v-gm-board">
        <svg viewBox={`0 0 ${S} ${S}`} onClick={tap} style={{ cursor: g.win || g.busy ? 'default' : 'pointer' }}>
          <defs>
            <radialGradient id="gmB" cx="35%" cy="30%" r="70%"><stop offset="0%" stopColor="#5a6274" /><stop offset="100%" stopColor="#0e121b" /></radialGradient>
            <radialGradient id="gmW" cx="35%" cy="30%" r="75%"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#d9dde6" /></radialGradient>
          </defs>
          <g className="v-gm-lines">
            {[...Array(GN)].map((_, k) => <g key={k}>
              <line x1={pad} x2={S - pad} y1={pad + k * cell} y2={pad + k * cell} />
              <line y1={pad} y2={S - pad} x1={pad + k * cell} x2={pad + k * cell} />
            </g>)}
          </g>
          {[[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]].map(([x, y]) => <circle key={`${x}-${y}`} cx={pad + x * cell} cy={pad + y * cell} r={2.4} className="v-gm-star" />)}
          {g.board.map((v, i) => {
            if (!v) return null
            const x = pad + (i % GN) * cell, y = pad + Math.floor(i / GN) * cell
            return <g key={i}>
              <circle cx={x} cy={y} r={cell * 0.42} fill={v === 1 ? 'url(#gmB)' : 'url(#gmW)'} className={v === 2 ? 'v-gm-white' : ''} style={{ filter: 'drop-shadow(0 1.5px 1.5px rgba(0,0,0,.28))' }} />
              {win.has(i) ? <circle cx={x} cy={y} r={cell * 0.5} fill="none" stroke="#c4a06a" strokeWidth={2} />
                : i === g.last && <circle cx={x} cy={y} r={2.6} fill={v === 1 ? '#fff' : 'var(--v-acc)'} />}
            </g>
          })}
        </svg>
      </div>
      <div className="v-gm-say"><span>Soren</span><p>{g.say}</p></div>
      <div className="v-gm-btns">
        <button onClick={undo}>Undo</button>
        <button className={g.win ? 'on' : ''} onClick={() => { clearTimeout(timer.current); setG(fresh()) }}>{g.win ? 'Play again' : 'Restart'}</button>
      </div>
    </SubPage>
  )
}

function Cartridge({ kind, title, en, onClick }) {
  const art = kind === 'gomoku'
    ? <svg width="96" height="60" viewBox="0 0 96 60">
        {[0, 1, 2, 3, 4, 5].map(k => <line key={`h${k}`} x1={8} x2={88} y1={6 + k * 10} y2={6 + k * 10} stroke="rgba(40,30,15,.35)" strokeWidth={0.7} />)}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => <line key={`v${k}`} y1={6} y2={56} x1={8 + k * 10} x2={8 + k * 10} stroke="rgba(40,30,15,.35)" strokeWidth={0.7} />)}
        {[[3, 2, 1], [4, 3, 1], [5, 4, 1], [4, 2, 2], [5, 3, 2], [6, 2, 2], [2, 1, 1]].map(([x, y, p], i) => <circle key={i} cx={8 + x * 10} cy={6 + y * 10} r={4} fill={p === 1 ? '#1d2232' : '#fafafa'} stroke={p === 2 ? 'rgba(0,0,0,.3)' : 'none'} strokeWidth={0.6} />)}
      </svg>
    : <svg width="96" height="60" viewBox="0 0 96 60" fill="none" stroke="#1d2232" strokeWidth="1.6" strokeLinecap="round">
        <path d="M14 44c6-14 14-22 22-18s-2 16 8 16 10-20 20-22 12 10 18 6" />
        <path d="M70 12l10-6 4 4-10 6z" fill="#c4a06a" stroke="none" />
        <circle cx="30" cy="18" r="6" strokeDasharray="2 3" />
      </svg>
  return (
    <div className="v-cart" onClick={onClick}>
      <div className="v-cart-shell">
        <div className="v-cart-ridges">{[...Array(7)].map((_, k) => <span key={k} />)}</div>
        <div className={`v-cart-label ${kind}`}>{art}<span>{en}</span></div>
        <div className="v-cart-title">{title}</div>
        <div className="v-cart-pin" />
      </div>
    </div>
  )
}

export default function GamePage({ onBack }) {
  const [game, setGame] = useState(null)
  if (game === 'gomoku') return <Gomoku onBack={() => setGame(null)} />
  if (game === 'draw') return <div className="v-clawd v-overlay-clawd"><DrawGuessGame onBack={() => setGame(null)} /></div>
  return (
    <SubPage title="Games" onBack={onBack}>
      <div className="v-sec">Pick a cartridge</div>
      <div className="v-carts">
        <Cartridge kind="gomoku" title="Gomoku" en="15 × 15" onClick={() => setGame('gomoku')} />
        <Cartridge kind="draw" title="Draw & Guess" en="DOODLE" onClick={() => setGame('draw')} />
        <div className="v-cart-empty">Empty slot</div>
      </div>
    </SubPage>
  )
}
