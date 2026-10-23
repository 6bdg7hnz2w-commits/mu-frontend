import { useCallback, useEffect, useRef, useState } from 'react'
import { LockScreen, getPasscode, useKeyboardOpen, apiFetch } from '../App.jsx'
import { fmtWhenEn } from '../Usage.jsx'
import { getSkin, setSkin, reloadIfStatusStyleChanged } from '../skin.js'
import { V, SubPage, BG, setTopLook, useTopColor, useEdgeSwipe } from './ui.jsx'
import HomeTab from './Home.jsx'
import CalendarTab from './Calendar.jsx'
import ChatTab from './Chat.jsx'
import UsagePage from './Usage.jsx'
import McpPage from './Mcp.jsx'
import GamePage from './Game.jsx'
import ReadingPage from './Reading.jsx'
import MemoryPage from './Memory.jsx'
import AlbumPage from './Album.jsx'
import './vesper.css'

// ─── Vesper ─────────────────────────────────────────
// 雾蓝皮肤，按 Claude Design 里的 MuApp 画布做。样式变量都带 --v- 前缀，挂在 .vesper 上，不碰 Clawd 的 :root。
// Home / Calendar / More 各页是自己的页面；Chats 借 Clawd 的聊天逻辑，文字换英文、样子照画布

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
    reloadIfStatusStyleChanged()
  }
  return [mode, setMode, mode === 'auto' ? (sysDark ? 'night' : 'day') : mode]
}

// html/body 的底色跟着 Vesper 走，换回 Clawd 时还原；状态栏颜色由各页 useTopColor 报上来（见 ui.jsx）
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Noto+Serif+SC:wght@300;400;500&family=LXGW+WenKai+TC&display=swap'
function usePageChrome(look) {
  useEffect(() => {
    if (document.getElementById('vesper-fonts')) return
    const link = Object.assign(document.createElement('link'), { id: 'vesper-fonts', rel: 'stylesheet', href: FONTS_HREF })
    document.head.appendChild(link)
  }, [])
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const prevMeta = meta?.content
    return () => { if (meta && prevMeta != null) meta.content = prevMeta }
  }, [])
  useTopColor(BG.day, BG.night, 0)
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean)
    els.forEach(el => { el.style.background = BG[look] })
    setTopLook(look)
    return () => els.forEach(el => { el.style.background = '' })
  }, [look])
}

// 键盘弹出时 iOS 不缩页面、而是把整页往上推，顶栏被推出屏幕、输入框和键盘之间空一截。
// 外框高度跟着可见区域走，再把页面滚回顶，输入框就贴着键盘
function useVisibleHeight(ref) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => {
      ref.current?.style.setProperty('--v-vh', `${Math.round(vv.height)}px`)
      if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0)
    }
    on()
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on) }
  }, [ref])
}

const TABS = [
  { key: 'home', label: 'Home', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
  { key: 'chat', label: 'Chats', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
  { key: 'calendar', label: 'Calendar', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
  { key: 'more', label: 'More', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg> },
]

const MODE_LABEL = { day: 'Light', night: 'Dark', auto: 'System' }

const MORE_TILES = [
  { key: 'memory', name: 'Memory', icon: V.memory, sub: "Soren's memory files" },
  { key: 'album', name: 'Album', icon: V.album, sub: 'Photos kept by Soren' },
  { key: 'game', name: 'Game', icon: V.game, sub: 'Gomoku · Draw & Guess' },
  { key: 'reading', name: 'Reading', icon: V.reading, sub: 'Shelf' },
  { key: 'mcp', name: 'MCP', icon: V.mcp, sub: 'Server & tools' },
  { key: 'usage', name: 'Usage', icon: V.usage, sub: 'Limits & tokens' },
]

// 格子上的小字用真数据：几个记忆文件、几张照片、5 小时额度几点恢复（拉不到就用默认那句）
function useTileSubs() {
  const [subs, setSubs] = useState({})
  useEffect(() => {
    let alive = true
    const put = (k, v) => { if (alive) setSubs(s => ({ ...s, [k]: v })) }
    const get = (path) => apiFetch(path).then(r => r.ok ? r.json() : null)
    get('/api/cc/usage?brief=1').then(b => {
      const w = b?.rate_limits?.five_hour
      if (w?.resets_at && Date.parse(w.resets_at) > Date.now()) put('usage', `5-hour limit resets ${fmtWhenEn(w.resets_at).replace('Today ', '')}`)
    }).catch(() => {})
    get('/api/cc/memory').then(d => { if (Array.isArray(d?.files)) put('memory', `${d.files.length} memory files`) }).catch(() => {})
    get('/api/cc/album').then(d => { if (Array.isArray(d?.photos)) put('album', `${d.photos.length} photos kept by Soren`) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return subs
}

function MorePage({ mode, onOpen, onOpenSetting }) {
  const subs = useTileSubs()
  return (
    <div className="v-page">
      <div className="v-big-title v-ruled">More</div>
      <div className="v-tiles">
        {MORE_TILES.map(t => (
          <div key={t.key} className={`v-tile ${t.soon ? 'is-soon' : ''}`} onClick={() => !t.soon && onOpen(t.key)}>
            <div className="v-tile-icon">{t.icon}</div>
            <div className="v-tile-text">
              <span className="v-tile-name">{t.name}</span>
              <span className="v-tile-sub">{subs[t.key] || t.sub}</span>
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
  const [immersive, setImmersive] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [unlocked, setUnlocked] = useState(() => !!getPasscode())
  const [lockExpired, setLockExpired] = useState(false)
  const frame = useRef(null)
  usePageChrome(look)
  useVisibleHeight(frame)
  useKeyboardOpen(setKeyboardOpen)
  const onImmersive = useCallback((v) => setImmersive(v), [])
  // Chats 里 Clawd 自己有左滑返回，这里不再叠一层
  const swipe = useEdgeSwipe(() => { if (tab === 'more' && moreView) setMoreView(null) })

  // 和 Clawd 一样：apiFetch 遇到 401 广播 mu-lock，整个回锁屏
  useEffect(() => {
    const onLock = () => { setUnlocked(false); setLockExpired(true) }
    window.addEventListener('mu-lock', onLock)
    return () => window.removeEventListener('mu-lock', onLock)
  }, [])

  // 锁屏先沿用 Clawd 那个，放在 .vesper 外面，样式不会串
  if (!unlocked) return <LockScreen expired={lockExpired} onUnlock={() => setUnlocked(true)} />

  const goTab = (k) => { setTab(k); if (k !== 'more') setMoreView(null) }
  const tabHidden = immersive || (tab === 'chat' && keyboardOpen)

  return (
    // 输入框获得焦点时浏览器会把外框也滚上去（overflow:hidden 照样能被滚），外框永远钉在顶上
    <div ref={frame} className={`vesper ${tabHidden ? 'tab-hidden' : ''} ${keyboardOpen ? 'kb-open' : ''}`} data-look={look} {...(tab === 'chat' ? {} : swipe)} onScroll={e => { if (e.target === e.currentTarget) e.currentTarget.scrollTop = 0 }}>
      {tab === 'home' && <HomeTab onImmersive={onImmersive} />}
      {tab === 'chat' && <ChatTab onUsage={() => { setTab('more'); setMoreView('usage') }} />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'more' && <MorePage mode={mode} onOpen={setMoreView} onOpenSetting={() => setMoreView('setting')} />}
      {tab === 'more' && moreView === 'setting' && <SettingPage mode={mode} setMode={setMode} onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'usage' && <UsagePage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'mcp' && <McpPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'game' && <GamePage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'memory' && <MemoryPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'album' && <AlbumPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'reading' && <ReadingPage onBack={() => setMoreView(null)} onImmersive={onImmersive} />}
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
