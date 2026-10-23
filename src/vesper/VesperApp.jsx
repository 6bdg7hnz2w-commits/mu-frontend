import { useEffect, useState } from 'react'
import { LockScreen, getPasscode } from '../App.jsx'
import { getSkin, setSkin } from '../skin.js'
import './vesper.css'

// ─── Vesper ─────────────────────────────────────────
// 雾蓝皮肤，按 Claude Design 里的 MuApp 画布做。样式变量都带 --v- 前缀，挂在 .vesper 上，不碰 Clawd 的 :root。
// 第一步只有外壳 + More + Setting；Home / Chats / Calendar 和 More 里的各页后面几步接真接口。

// 浅色 / 夜间 / 跟随系统，只管 Vesper；Clawd 一直跟系统走
const MODE_KEY = 'mu_vesper_mode'
const MODES = ['day', 'night', 'auto']
const DARK_MQ = '(prefers-color-scheme: dark)'
function useMode() {
  const [mode, setModeState] = useState(() => {
    try { const v = localStorage.getItem(MODE_KEY); return MODES.includes(v) ? v : 'auto' } catch { return 'auto' }
  })
  const [sysDark, setSysDark] = useState(() => window.matchMedia?.(DARK_MQ).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(DARK_MQ)
    if (!mq) return
    const on = (e) => setSysDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const setMode = (m) => {
    setModeState(m)
    try { localStorage.setItem(MODE_KEY, m) } catch {}
  }
  return [mode, setMode, mode === 'auto' ? (sysDark ? 'night' : 'day') : mode]
}

// html/body 的底色和状态栏颜色跟着 Vesper 走，换回 Clawd 时还原
const PAGE_BG = { day: '#f1f3f7', night: '#0a0c11' }
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Noto+Serif+SC:wght@300;400;500&family=LXGW+WenKai+TC&display=swap'
function usePageChrome(look) {
  useEffect(() => {
    if (document.getElementById('vesper-fonts')) return
    const link = Object.assign(document.createElement('link'), { id: 'vesper-fonts', rel: 'stylesheet', href: FONTS_HREF })
    document.head.appendChild(link)
  }, [])
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean)
    const meta = document.querySelector('meta[name="theme-color"]')
    const prevMeta = meta?.content
    els.forEach(el => { el.style.background = PAGE_BG[look] })
    if (meta) meta.content = PAGE_BG[look]
    return () => {
      els.forEach(el => { el.style.background = '' })
      if (meta && prevMeta != null) meta.content = prevMeta
    }
  }, [look])
}

const svg = (kids, size = 20, sw = 1.6) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{kids}</svg>
)
const V = {
  back: svg(<path d="M14.5 5.5 8 12l6.5 6.5" />, 18),
  chevron: svg(<path d="M9 6l6 6-6 6" />, 14, 2),
  check: svg(<path d="M20 6L9 17l-5-5" />, 12, 3),
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

const TABS = [
  { key: 'home', label: 'Home', icon: svg(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>, 22, 1.3) },
  { key: 'chat', label: 'Chats', icon: svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />, 22, 1.3) },
  { key: 'calendar', label: 'Calendar', icon: svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>, 22, 1.3) },
  { key: 'more', label: 'More', icon: svg(<><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></>, 22, 1.3) },
]

// 还没做好的页：说清楚，并给一个回 Clawd 的出口
function SoonPage({ title }) {
  return (
    <div className="v-page">
      <div className="v-big-title">{title}</div>
      <div className="v-soon">
        <p>Vesper's {title} is still on its way. Clawd has everything for now.</p>
        <button className="v-btn" onClick={() => setSkin('clawd')}>Switch to Clawd</button>
      </div>
    </div>
  )
}

function SubPage({ title, onBack, children }) {
  return (
    <div className="v-sub">
      <div className="v-sub-head">
        <button className="v-chip" onClick={onBack} aria-label="Back">{V.back}</button>
        <div className="v-sub-title">{title}</div>
      </div>
      <div className="v-sub-body">{children}</div>
    </div>
  )
}

const MODE_LABEL = { day: 'Light', night: 'Dark', auto: 'System' }

const MORE_TILES = [
  { key: 'memory', name: 'Memory', icon: V.memory },
  { key: 'album', name: 'Album', icon: V.album },
  { key: 'game', name: 'Game', icon: V.game },
  { key: 'reading', name: 'Reading', icon: V.reading },
  { key: 'mcp', name: 'MCP', icon: V.mcp },
  { key: 'usage', name: 'Usage', icon: V.usage },
]

function MorePage({ mode, onOpenSetting }) {
  return (
    <div className="v-page">
      <div className="v-big-title v-ruled">More</div>
      <div className="v-tiles">
        {MORE_TILES.map(t => (
          <div key={t.key} className="v-tile is-soon">
            <div className="v-tile-icon">{t.icon}</div>
            <div className="v-tile-text">
              <span className="v-tile-name">{t.name}</span>
              <span className="v-tile-sub">Coming soon</span>
            </div>
          </div>
        ))}
      </div>
      <div className="v-row" onClick={onOpenSetting}>
        <div className="v-tile-icon">{V.setting}</div>
        <span className="v-row-name">Setting</span>
        <span className="v-row-sub">Vesper · {MODE_LABEL[mode]}</span>
        <span className="v-row-chev">{V.chevron}</span>
      </div>
    </div>
  )
}

const SKIN_CARDS = [
  { k: 'vesper', n: 'Vesper', no: '01', sub: 'Mist blue · nacreous sky', sw: ['#f1f3f7', '#5f739c', '#c9c3d6', '#1c2232'] },
  { k: 'clawd', n: 'Clawd', no: '02', sub: 'Warm white · terracotta', sw: ['#f4f1ea', '#c96442', '#ebe6dc', '#2b2620'] },
]
const MODE_OPTIONS = [['day', 'Light', V.light], ['night', 'Dark', V.dark], ['auto', 'System', V.system]]

function SettingPage({ mode, setMode, onBack }) {
  const skin = getSkin()
  return (
    <SubPage title="Setting" onBack={onBack}>
      <div className="v-sec">Theme</div>
      <div className="v-skins">
        {SKIN_CARDS.map(sk => (
          <div key={sk.k} className={`v-skin ${skin === sk.k ? 'on' : ''}`} onClick={() => setSkin(sk.k)}>
            <div className="v-skin-preview" style={{ background: sk.sw[0] }}>
              <i style={{ left: 10, top: 12, width: 52, height: 6, borderRadius: 3, background: sk.sw[3], opacity: 0.8 }} />
              <i style={{ left: 10, top: 26, right: 10, height: 34, borderRadius: 8, background: sk.sw[2] }} />
              <i style={{ left: 10, top: 66, width: 60, height: 30, borderRadius: 8, background: '#fff', opacity: 0.85 }} />
              <i style={{ right: 10, top: 66, width: 30, height: 30, borderRadius: 9, background: sk.sw[1] }} />
            </div>
            <div className="v-skin-meta">
              <div className="v-skin-text">
                <span className="v-skin-no">NO. {sk.no}</span>
                <span className="v-skin-name">{sk.n}</span>
                <span className="v-skin-sub">{sk.sub}</span>
              </div>
              {skin === sk.k && <div className="v-skin-check">{V.check}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="v-sec">Appearance</div>
      <div className="v-card v-modes">
        {MODE_OPTIONS.map(([k, label, icon]) => (
          <div key={k} className={`v-mode ${mode === k ? 'on' : ''}`} onClick={() => setMode(k)}>
            {icon}<span>{label}</span>
          </div>
        ))}
      </div>
      <div className="v-tip">System follows your phone — dark mode on the phone turns this dark too. Light and Dark apply to Vesper only; Clawd always follows the phone.</div>
    </SubPage>
  )
}

export default function VesperApp() {
  const [mode, setMode, look] = useMode()
  const [tab, setTab] = useState('home')
  const [moreView, setMoreView] = useState(null)
  const [unlocked, setUnlocked] = useState(() => !!getPasscode())
  const [lockExpired, setLockExpired] = useState(false)
  usePageChrome(look)

  // 和 Clawd 一样：apiFetch 遇到 401 广播 mu-lock，整个回锁屏
  useEffect(() => {
    const onLock = () => { setUnlocked(false); setLockExpired(true) }
    window.addEventListener('mu-lock', onLock)
    return () => window.removeEventListener('mu-lock', onLock)
  }, [])

  // 锁屏先沿用 Clawd 那个，放在 .vesper 外面，样式不会串
  if (!unlocked) return <LockScreen expired={lockExpired} onUnlock={() => setUnlocked(true)} />

  const goTab = (k) => { setTab(k); if (k !== 'more') setMoreView(null) }

  return (
    <div className="vesper" data-look={look}>
      {tab === 'home' && <SoonPage title="Home" />}
      {tab === 'chat' && <SoonPage title="Chats" />}
      {tab === 'calendar' && <SoonPage title="Calendar" />}
      {tab === 'more' && <MorePage mode={mode} onOpenSetting={() => setMoreView('setting')} />}
      {tab === 'more' && moreView === 'setting' && <SettingPage mode={mode} setMode={setMode} onBack={() => setMoreView(null)} />}
      <nav className="v-tabbar">
        {TABS.map(t => (
          <button key={t.key} className={`v-tab ${tab === t.key ? 'on' : ''}`} onClick={() => goTab(t.key)}>
            {t.icon}<span>{t.label}</span><i />
          </button>
        ))}
      </nav>
    </div>
  )
}
