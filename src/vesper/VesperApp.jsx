import { useCallback, useEffect, useState } from 'react'
import { LockScreen } from '../App.jsx'
import { getPasscode, apiFetch } from '../shell/data.js'
import { usePageChrome } from '../shell/viewport.js'
import { useTabShell, TabShell } from '../shell/TabShell.jsx'
import { useCached, preload } from './data.js'
import { getSkin, setSkin } from '../skin.js'
import { V, SubPage, useEdgeSwipe } from './ui.jsx'
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
  }
  return [mode, setMode, mode === 'auto' ? (sysDark ? 'night' : 'day') : mode]
}

// 状态栏、html 底色跟着页面走（shell/viewport.js 的 usePageChrome）：浅色页面用浅的，夜间、Home 壁纸用深的。字体是 Vesper 自己的
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Noto+Serif+SC:wght@300;400;500&family=LXGW+WenKai+TC&display=swap'
// html / body 的底色。iOS 27 的系统顶边效果（状态栏下面那层渐变 + 轻模糊）拿它上色，所以它要和页面顶上实际显示的颜色一样，
// 不然开屏、首页顶上一条黑，浅色聊天页名字上面一片白（skin-checklist 第 3c 条）。
// 首页、聊天页是壁纸顶上那一截叠了滤镜 / 蒙版之后的平均色；开屏是开屏的底色；其它页面是页面底色（键盘上那条工具栏也透出它，第 6 条）
const CHROME = {
  day: '#f1f3f7', night: '#0a0c11',
  home: '#4b628f', homeNight: '#2b354b',
  chat: '#afa7be', chatNight: '#24222f',
  splash: '#66799e', splashNight: '#000000',
  shelf: '#28405b', shelfNight: '#19293c', // 书架壁纸顶上一截叠了 .v-shelf-shade
  paper: '#efebe2', paperNight: '#12161f', // 阅读器、记忆地图的纸色
}
function useVesperFonts() {
  useEffect(() => {
    if (document.getElementById('vesper-fonts')) return // index.html 已经加了（打开就是 Vesper 时）
    const link = Object.assign(document.createElement('link'), { id: 'vesper-fonts', rel: 'stylesheet', href: FONTS_HREF })
    document.head.appendChild(link)
  }, [])
}

const TABS = [
  { key: 'home', label: 'Home', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
  { key: 'chat', label: 'Chats', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
  { key: 'calendar', label: 'Calendar', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
  { key: 'more', label: 'More', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg> },
]


const MORE_TILES = [
  { key: 'memory', name: 'Memory', icon: V.memory, sub: "Soren's memory files" },
  { key: 'album', name: 'Album', icon: V.album, sub: 'Photos kept by Soren' },
  { key: 'game', name: 'Game', icon: V.game },
  { key: 'reading', name: 'Reading', icon: V.reading },
  { key: 'mcp', name: 'MCP', icon: V.mcp, sub: 'Server & tools' },
  { key: 'usage', name: 'Usage', icon: V.usage },
]

// 格子上的小字用真数据：几个记忆文件、几张照片、MCP 连没连上（开场时已经取好、存在本地，切过来不跳）；Game / Reading / Usage 不写小字
function useTileSubs() {
  return { memory: useCached('memory'), album: useCached('album'), mcp: useCached('mcp') }
}

function MorePage({ onOpen, onOpenSetting }) {
  const subs = useTileSubs()
  return (
    <>
    <div className="v-page">
      <div className="v-big-title v-ruled">More</div>
      <div className="v-tiles">
        {MORE_TILES.map(t => (
          <div key={t.key} className={`v-tile ${t.soon ? 'is-soon' : ''}`} onClick={() => !t.soon && onOpen(t.key)}>
            <div className="v-tile-icon">{t.icon}</div>
            <div className="v-tile-text">
              <span className="v-tile-name">{t.name}</span>
              {(subs[t.key] || t.sub) && <span className="v-tile-sub">{subs[t.key] || t.sub}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="v-row" onClick={onOpenSetting}>
        <div className="v-tile-icon">{V.setting}</div>
        <span className="v-row-name">Setting</span>
        <span className="v-row-chev">{V.chevron}</span>
      </div>
    </div>
    </>
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
                <span className="v-skin-no">{`NO. ${sk.no}`}</span>
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
      <div className="v-tip">System follows your phone — dark mode on the phone turns this dark too.</div>
    </SubPage>
  )
}

// 字体（样式表 + 首页用到的几种字重）、首页壁纸、首页和 More 要用的数据（最多等 3 秒）都到了才算好；
// 总共最多等 4 秒，网不好也不一直盖着
function vesperReady() {
  const link = document.getElementById('vesper-fonts')
  const sheet = link && !link.sheet ? new Promise(r => { link.addEventListener('load', r); link.addEventListener('error', r) }) : Promise.resolve()
  const fonts = sheet.then(() => document.fonts ? Promise.all([
    "500 31px 'Cormorant Garamond'", "600 19px 'Cormorant Garamond'", "italic 17px 'Cormorant Garamond'", "400 15px 'Noto Serif SC'",
  ].map(f => document.fonts.load(f, 'Aa你好').catch(() => {}))).then(() => document.fonts.ready) : null)
  const wall = new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = '/vesper/home-bg.webp' })
  return Promise.race([Promise.all([fonts, wall, preload(3000)]), new Promise(r => setTimeout(r, 4000))])
}

// 打开时和画布一样先亮一下星光：至少 1.25 秒，字体和壁纸都到了再整页淡入，淡完撤掉
function Splash({ onDone }) {
  const [out, setOut] = useState(false)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    let alive = true, b
    const min = new Promise(r => setTimeout(r, 1250))
    Promise.all([min, vesperReady()]).then(() => {
      if (!alive) return
      setOut(true); onDone?.(); b = setTimeout(() => setGone(true), 750)
    })
    return () => { alive = false; clearTimeout(b) }
  }, [])
  if (gone) return null
  return <div className={`v-splash ${out ? 'out' : ''}`}><div><i className="glow" /><i className="h" /><i className="v" /><i className="core" /></div></div>
}

export default function VesperApp() {
  const [mode, setMode, look] = useMode()
  const [tab, setTab] = useState('home')
  const [moreView, setMoreView] = useState(null)
  const [chatUsage, setChatUsage] = useState(false) // 聊天里点开的 Usage：叠在聊天上面，返回回到聊天
  const [immersive, setImmersive] = useState(false)
  const [chatSub, setChatSub] = useState(false) // 聊天里进了 menu / 查找 / 回复方式
  const [unlocked, setUnlocked] = useState(() => !!getPasscode())
  const [lockExpired, setLockExpired] = useState(false)
  const shell = useTabShell() // 外框、键盘、tab 栏收起（shell/TabShell.jsx）
  useVesperFonts()
  const [chatRoom, setChatRoom] = useState(true) // Chats 里是在聊天页本身（不是对话列表、二级页）
  const [splashOn, setSplashOn] = useState(true)
  const [readerOpen, setReaderOpen] = useState(false) // Reading 里翻开了一本书
  const night = look === 'night'
  const chrome = splashOn ? (night ? CHROME.splashNight : CHROME.splash)
    : tab === 'more' && (moreView === 'memory' || (moreView === 'reading' && readerOpen)) ? (night ? CHROME.paperNight : CHROME.paper)
    : tab === 'more' && moreView === 'reading' ? (night ? CHROME.shelfNight : CHROME.shelf)
    : tab === 'home' && !immersive ? (night ? CHROME.homeNight : CHROME.home)
    // 键盘开着时 iOS 的键盘工具栏、它和输入栏之间那条缝透的是 html 底色：换回接得上输入栏的颜色（skin-checklist 6）
    : tab === 'chat' && chatRoom && !chatUsage && !chatSub ? (night ? CHROME.chatNight : CHROME.chat)
    : night ? CHROME.night : CHROME.day
  usePageChrome(chrome) // 日记、读书这些从 Home 打开的浅色页也是浅底
  const onImmersive = useCallback((v) => setImmersive(v), [])
  const onChatSub = useCallback((v) => setChatSub(v), [])
  const onChatRoom = useCallback((v) => setChatRoom(v), [])
  // Chats 里 Clawd 自己有左滑返回，这里不再叠一层
  const swipe = useEdgeSwipe(() => { if (tab === 'more' && moreView) setMoreView(null); else if (chatUsage) setChatUsage(false) })

  // 和 Clawd 一样：apiFetch 遇到 401 广播 mu-lock，整个回锁屏
  useEffect(() => {
    const onLock = () => { setUnlocked(false); setLockExpired(true) }
    window.addEventListener('mu-lock', onLock)
    return () => window.removeEventListener('mu-lock', onLock)
  }, [])

  // 锁屏先沿用 Clawd 那个，放在 .vesper 外面，样式不会串
  if (!unlocked) return <LockScreen expired={lockExpired} onUnlock={() => setUnlocked(true)} />

  const goTab = (k) => { setTab(k); setChatUsage(false); if (k !== 'more') setMoreView(null) }
  // 二级页（tab 栏收起，TabShell 统一处理）：Home 里打开的日记、信这些（immersive）、More 里的每一页、聊天里的 menu / 查找 / 回复方式 / Usage
  const subPage = immersive || (tab === 'more' && !!moreView) || (tab === 'chat' && (chatUsage || chatSub))

  return (
    <TabShell shell={shell} prefix="v" className="vesper" data-look={look} tabs={TABS} tab={tab} onTab={goTab} subPage={subPage} panelTab="chat" frameProps={tab === 'chat' && !chatUsage ? null : swipe}>
      {/* 一级页（Home / Calendar / More）顶上：滑上去的内容到状态栏这里渐进变糊，不和时间叠在一起。只有模糊、不带颜色（不要罩，见 docs/skin-checklist.md） */}
      {!subPage && tab !== 'chat' && <div className="v-top-blur" />}
      {tab === 'home' && <HomeTab onImmersive={onImmersive} />}
      {tab === 'chat' && <ChatTab onUsage={() => setChatUsage(true)} onSubPage={onChatSub} onRoom={onChatRoom} />}
      {tab === 'chat' && chatUsage && <UsagePage onBack={() => setChatUsage(false)} />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'more' && <MorePage onOpen={setMoreView} onOpenSetting={() => setMoreView('setting')} />}
      {tab === 'more' && moreView === 'setting' && <SettingPage mode={mode} setMode={setMode} onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'usage' && <UsagePage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'mcp' && <McpPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'game' && <GamePage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'memory' && <MemoryPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'album' && <AlbumPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'reading' && <ReadingPage onBack={() => setMoreView(null)} onImmersive={onImmersive} onReader={setReaderOpen} />}
      <Splash onDone={() => setSplashOn(false)} />
    </TabShell>
  )
}
