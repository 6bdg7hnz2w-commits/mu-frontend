import { useState } from 'react'
import { DrawGuessGame } from '../App.jsx'
import { SubPage } from './ui.jsx'

// ─── Game ───────────────────────────────────────────
// 一盒卡带：你画我猜（借 Clawd 的那个，保持中文）

function Cartridge({ kind, title, en, onClick }) {
  const art = (
    <svg width="96" height="60" viewBox="0 0 96 60" fill="none" stroke="#1d2232" strokeWidth="1.6" strokeLinecap="round">
      <path d="M14 44c6-14 14-22 22-18s-2 16 8 16 10-20 20-22 12 10 18 6" />
      <path d="M70 12l10-6 4 4-10 6z" fill="#c4a06a" stroke="none" />
      <circle cx="30" cy="18" r="6" strokeDasharray="2 3" />
    </svg>
  )
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
  if (game === 'draw') return <div className="v-clawd v-overlay-clawd"><DrawGuessGame onBack={() => setGame(null)} /></div>
  return (
    <SubPage title="Games" onBack={onBack}>
      <div className="v-sec">Pick a cartridge</div>
      <div className="v-carts">
        <Cartridge kind="draw" title="Draw & Guess" en="DOODLE" onClick={() => setGame('draw')} />
        <div className="v-cart-empty">Empty slot</div>
      </div>
    </SubPage>
  )
}
