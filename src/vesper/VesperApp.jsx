import { useCallback, useEffect, useRef, useState } from 'react'
import { LockScreen, getPasscode, useKeyboardOpen, apiFetch } from '../App.jsx'
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
import { installKbDebug, kbNote } from './kbDebug.js'
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

// 状态栏是透明的（index.html），页面画到最上面。html / body / theme-color 跟着页面走：
// 键盘上面那条工具栏是半透明的，透出来的就是 html 的底色，浅色页面得是浅的，深色（夜间、Home 壁纸）才用深的。换回 Clawd 时还原
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Noto+Serif+SC:wght@300;400;500&family=LXGW+WenKai+TC&display=swap'
const CHROME = { night: '#0a0c11', home: '#000000', day: '#f1f3f7' }
function usePageChrome(color) {
  useEffect(() => {
    if (document.getElementById('vesper-fonts')) return // index.html 已经加了（打开就是 Vesper 时）
    const link = Object.assign(document.createElement('link'), { id: 'vesper-fonts', rel: 'stylesheet', href: FONTS_HREF })
    document.head.appendChild(link)
  }, [])
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const prevMeta = meta?.content
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean)
    document.getElementById('vesper-top')?.remove() // index.html 开屏前垫的黑，React 接手后交给这里
    return () => {
      if (meta && prevMeta != null) meta.content = prevMeta
      els.forEach(el => { el.style.background = ''; el.style.colorScheme = '' })
    }
  }, [])
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = color
    const scheme = color === CHROME.day ? 'light' : 'dark'
    ;[document.documentElement, document.body, document.getElementById('root')].filter(Boolean).forEach(el => { el.style.background = color; el.style.colorScheme = scheme })
  }, [color])
}

// 键盘弹出时 iOS 不缩页面、而是把整页往上推，顶栏被推出屏幕、输入框和键盘之间空一截。
// 外框高度跟着可见区域走，再把页面滚回顶，输入框就贴着键盘
function useVisibleHeight(ref) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    // 文档本身钉死不滚（vesper.css 的 html.v-lock）：iOS 弹键盘时会去滚整个文档露出输入框，
    // 再叠上我们按 visualViewport 改高度，就是顶栏先被挤到屏幕中间再回来、收起时列表先掉下去再弹回
    const root = document.documentElement
    root.classList.add('v-lock')
    const css = (k, v) => v == null ? ref.current?.style.removeProperty(k) : ref.current?.style.setProperty(k, v)
    // gap：没键盘时 html 比 visualViewport 高出的那截（主屏幕模式下是状态栏那么高，见 index.css）；
    // kbMax：键盘整个升起来时的高度（不含 gap）。键盘起落途中外框高度在这两头之间按比例走，输入栏一直贴着键盘顶
    let gap = null, kbMax = 0, raf = 0
    // settled：不是在键盘动画途中逐帧读的。只有这时才记 gap、键盘高度（动画途中的高度是一半，存了面板会画错）
    const on = (settled) => {
      // 文档被滚了就拉回去；visualViewport 自己在 layout viewport 里偏开了（offsetTop），外框往下挪同样多。
      // 和高度在同一个回调里一起改：外框永远正好盖住看得见的那块，顶栏、背景不动，不出空白帧
      if (window.scrollY || root.scrollTop) window.scrollTo(0, 0)
      css('--v-vtop', `${Math.max(0, Math.round(vv.offsetTop))}px`)
      // 主屏幕模式下 innerHeight 也会跟着键盘变小，拿它比较不出键盘；html 的高度不随键盘变，用它
      const full = root.getBoundingClientRect().height, h = vv.height
      css('--v-full', `${Math.round(full)}px`) // 整个屏幕的高度：聊天背景按它铺，不跟键盘、面板变
      root.style.setProperty('--v-doc', `${Math.round(full)}px`) // 钉死的 body 的高度（fixed 的 100% 是少算了状态栏的那个视口）
      if (settled && h >= full - 150) gap = full - h
      const kb = full - (gap ?? 0) - h // 现在露出来的键盘有多高
      if (kb > 8) {
        if (settled && h < full - 150) {
          kbMax = kb
          // 键盘的高度留着（收起后也不清）：聊天的表情、加号面板照这个高度画，占键盘的位置，切换时输入框不动
          css('--v-kb', `${Math.round(full - h)}px`)
          try { localStorage.setItem('v_kb_h', String(Math.round(full - h))) } catch {}
        }
        css('--v-vh', `${Math.round(h + (gap ?? 0) * (1 - Math.min(1, kb / Math.max(kbMax, kb))))}px`)
      } else css('--v-vh', null)
    }
    // 键盘起落时 iOS 不是每帧都发 resize，常常只在开头结尾各发一下，中间输入栏就卡着不动、底下空一大块。
    // 输入框一得到 / 失去焦点就每帧读一次 visualViewport，连着 8 帧没变（或者 1 秒）算停了，最后按停稳的记一次
    // iOS 26：收起键盘后 visualViewport.offsetTop 有时回不到 0（外框跟着它整个往下偏）。社区的办法是等一下再上下推 1px 让它归位，
    // 见 Apple 论坛 thread 800125 / WebKit 254861。推之前之后的值记进调试读数（kbDebug），看真机上管不管用
    const nudge = () => {
      if (vv.offsetTop < 1 || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return
      const before = Math.round(vv.offsetTop)
      window.scrollBy(0, -1); window.scrollBy(0, 1)
      on(true)
      kbNote(`nudge top ${before}→${Math.round(vv.offsetTop)}`)
    }
    const follow = (e) => {
      if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
      cancelAnimationFrame(raf)
      const closing = e.type === 'focusout'
      if (closing) setTimeout(nudge, 100)
      let last = -1, still = 0
      const t0 = performance.now()
      const tick = (now) => {
        on(false)
        still = vv.height === last ? still + 1 : 0
        last = vv.height
        if (still >= 8 || now - t0 > 1000) { raf = 0; on(true); if (closing) nudge(); return }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    try { const kb = Number(localStorage.getItem('v_kb_h')); if (kb > 150) { css('--v-kb', `${kb}px`); kbMax = kb } } catch {}
    on(true)
    if (gap != null) kbMax = Math.max(0, kbMax - gap)
    const ev = () => on(!raf)
    vv.addEventListener('resize', ev)
    vv.addEventListener('scroll', ev)
    window.addEventListener('scroll', ev)
    document.addEventListener('focusin', follow)
    document.addEventListener('focusout', follow)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', ev); vv.removeEventListener('scroll', ev); window.removeEventListener('scroll', ev)
      document.removeEventListener('focusin', follow); document.removeEventListener('focusout', follow)
      root.classList.remove('v-lock')
    }
  }, [ref])
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
function Splash() {
  const [out, setOut] = useState(false)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    let alive = true, b
    const min = new Promise(r => setTimeout(r, 1250))
    Promise.all([min, vesperReady()]).then(() => {
      if (!alive) return
      setOut(true); b = setTimeout(() => setGone(true), 750)
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
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false) // 聊天的表情 / 加号面板开着：和键盘一样收起 tab 栏
  useEffect(() => {
    const on = (e) => setPanelOpen(!!e.detail)
    window.addEventListener('cc-panel', on)
    return () => window.removeEventListener('cc-panel', on)
  }, [])
  const [unlocked, setUnlocked] = useState(() => !!getPasscode())
  const [lockExpired, setLockExpired] = useState(false)
  const frame = useRef(null)
  usePageChrome(look === 'night' ? CHROME.night : tab === 'home' && !immersive ? CHROME.home : CHROME.day) // 日记、读书这些从 Home 打开的浅色页也是浅底
  useVisibleHeight(frame)
  useKeyboardOpen(setKeyboardOpen)
  useEffect(() => installKbDebug(), []) // 临时：键盘调试读数，平时不显示
  const onImmersive = useCallback((v) => setImmersive(v), [])
  const onChatSub = useCallback((v) => setChatSub(v), [])
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
  // 底部 tab 只在一级页（Home、Chats、Calendar、More）显示；带返回键的二级页一律收起，在这里统一判断，页面自己不管：
  // Home 里打开的日记、信这些（immersive）、More 里的每一页、聊天里的 menu / 查找 / 回复方式 / Usage。
  // 另外键盘弹出、聊天面板打开时也收起。收起 / 回来都是 tab 栏自己往下滑出、滑回
  const subPage = immersive || (tab === 'more' && !!moreView) || (tab === 'chat' && (chatUsage || chatSub))
  const tabHidden = subPage || keyboardOpen || (tab === 'chat' && panelOpen)

  return (
    // 输入框获得焦点时浏览器会把外框也滚上去（overflow:hidden 照样能被滚），外框永远钉在顶上
    <div ref={frame} className={`vesper ${tabHidden ? 'tab-hidden' : ''} ${keyboardOpen ? 'kb-open' : ''}`} data-look={look} {...(tab === 'chat' && !chatUsage ? {} : swipe)} onScroll={e => { if (e.target === e.currentTarget) e.currentTarget.scrollTop = 0 }}>
      {tab === 'home' && <HomeTab onImmersive={onImmersive} />}
      {tab === 'chat' && <ChatTab onUsage={() => setChatUsage(true)} onSubPage={onChatSub} />}
      {tab === 'chat' && chatUsage && <UsagePage onBack={() => setChatUsage(false)} />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'more' && <MorePage onOpen={setMoreView} onOpenSetting={() => setMoreView('setting')} />}
      {tab === 'more' && moreView === 'setting' && <SettingPage mode={mode} setMode={setMode} onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'usage' && <UsagePage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'mcp' && <McpPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'game' && <GamePage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'memory' && <MemoryPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'album' && <AlbumPage onBack={() => setMoreView(null)} />}
      {tab === 'more' && moreView === 'reading' && <ReadingPage onBack={() => setMoreView(null)} onImmersive={onImmersive} />}
      <Splash />
      {/* 浮在底下的圆玻璃；选中那格垫一块会滑动的小玻璃 */}
      <nav className="v-tabbar">
        <i className="v-tab-pill" style={{ transform: `translateX(${TABS.findIndex(t => t.key === tab) * 100}%)` }} />
        {TABS.map(t => (
          <button key={t.key} className={`v-tab ${tab === t.key ? 'on' : ''}`} onClick={() => goTab(t.key)}>
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
