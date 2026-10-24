import { useEffect, useRef, useState } from 'react'

// ─── Vesper 共用的小零件：图标、日期常量、二级页顶栏、提示条、底部菜单 ──

export const MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const MONF = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
export const DF = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const D3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const svg = (kids, size = 20, sw = 1.6) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{kids}</svg>
)
export const V = {
  back: svg(<path d="M14.5 5.5 8 12l6.5 6.5" />, 18),
  chevron: svg(<path d="M9 6l6 6-6 6" />, 14, 2),
  left: svg(<path d="M15 6l-6 6 6 6" />, 14, 1.8),
  right: svg(<path d="M9 6l6 6-6 6" />, 14, 1.8),
  check: svg(<path d="M20 6L9 17l-5-5" />, 12, 3),
  tick: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, 12, 2.6),
  plus: svg(<path d="M12 5v14M5 12h14" />, 15, 1.9),
  x: svg(<path d="M18 6L6 18M6 6l12 12" />, 12, 3),
  search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>, 19, 1.5),
  lock: svg(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, 15, 1.5),
  unlock: svg(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.6-1.7" /></>, 14, 1.5),
  heart: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--v-acc)" strokeWidth="1.4" style={{ marginBottom: 6 }}><path d="M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" /></svg>,
  heartFill: <svg width="8" height="8" viewBox="0 0 24 24"><path fill="#c4a06a" d="M12 21s-9-5.6-9-12.2A5 5 0 0 1 12 5.6a5 5 0 0 1 9 3.2C21 15.4 12 21 12 21z" /></svg>,
  send: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>,
  memory: svg(<><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14" /><path d="M15 6v14" /></>),
  album: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5-9 8" /></>),
  reading: svg(<><path d="M4 4h4v16H4z" /><path d="M8 6h4v14H8z" /><path d="M14.2 5.3l3.6-1 4 15.2-3.6 1z" /></>),
  game: svg(<><path d="M5 3h11l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><rect x="8" y="9" width="8" height="6" rx="1" /><path d="M9 3v3M12 3v3M15 3v3" /></>),
  mcp: svg(<><path d="M9 2v5M15 2v5" /><path d="M6 7h12v4a6 6 0 0 1-12 0z" /><path d="M12 17v5" /></>),
  usage: svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  setting: svg(<><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>),
  light: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  dark: svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  system: svg(<><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M12 2v20" /><path d="M6 12h6" /></>),
}

// 日记的花：public/vesper/flowers/f0..f17.png 当遮罩，颜色跟主题色走
export const flowerStyle = (i, opacity, size) => ({
  width: size, height: size, flex: 'none', background: 'var(--v-acc)', opacity,
  WebkitMaskImage: `url(/vesper/flowers/f${i}.png)`, maskImage: `url(/vesper/flowers/f${i}.png)`,
  WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center', maskPosition: 'center', transition: 'opacity .8s ease',
})


// 从左边缘往右划回上一页：找最上面那页的返回键按一下（各页的返回键都带 aria-label="Back"）
export function useEdgeSwipe(fallback) {
  const t = useRef(null)
  return {
    onTouchStart: (e) => { const p = e.touches[0]; t.current = p.clientX < 28 ? { x: p.clientX, y: p.clientY } : null },
    onTouchEnd: (e) => {
      const s = t.current; t.current = null
      if (!s) return
      const p = e.changedTouches[0], dx = p.clientX - s.x, dy = Math.abs(p.clientY - s.y)
      if (dx < 70 || dy > dx * 0.7 || e.target.closest?.('.v-clawd')) return
      // 一次只退一层：DOM 里最后一个返回键/关闭层就是最上面那层
      const backs = e.currentTarget.querySelectorAll('[aria-label="Back"],[data-back]')
      if (backs.length) backs[backs.length - 1].click(); else fallback?.()
    },
  }
}

export function SubHead({ title, onBack, children }) {
  return (
    <div className="v-sub-head">
      <button className="v-chip" onClick={onBack} aria-label="Back">{V.back}</button>
      {children ?? <div className="v-sub-title">{title}</div>}
    </div>
  )
}

export function SubPage({ title, onBack, children }) {
  return (
    <div className="v-sub">
      <SubHead title={title} onBack={onBack} />
      <div className="v-sub-body">{children}</div>
    </div>
  )
}

// 底部一条轻提示，2.4 秒后自己消失
export function useToast() {
  const [text, setText] = useState('')
  const [on, setOn] = useState(false)
  const t = useRef(null)
  const show = (s) => { clearTimeout(t.current); setText(s); setOn(true); t.current = setTimeout(() => setOn(false), 2400) }
  return [<div key="toast" className={`v-toast ${on ? 'on' : ''}`}>{text}</div>, show]
}


// iOS 那种从底部弹出的操作菜单；actions 里的 false 会被跳过
export function ActionSheet({ title, actions, onClose }) {
  return (
    <div className="v-sheet" data-back onClick={onClose}>
      <div className="v-sheet-card" onClick={e => e.stopPropagation()}>
        {title && <div className="v-sheet-title">{title}</div>}
        {actions.filter(Boolean).map(a => (
          <button key={a.label} className={a.danger ? 'danger' : ''} onClick={a.onClick}>{a.label}</button>
        ))}
      </div>
      <button className="v-sheet-cancel" onClick={onClose}>Cancel</button>
    </div>
  )
}
