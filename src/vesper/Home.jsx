import { useEffect, useRef, useState } from 'react'
import { START_DATE, apiFetch, beijingDateStr } from '../App.jsx'
import { useCached, setCached, refresh } from './data.js'
import { V, MONS, DF, D3, MONF, SubHead, flowerStyle, useToast } from './ui.jsx'
import { ActionSheet } from '../shell/sheets.jsx'
import { keepAboveKeyboard } from '../shell/viewport.js'
import { usePreventPageScroll } from '../shell/preventScroll.js'

// ─── Home / Diary / Read ────────────────────────────
// 首页（壁纸 + 每日一句 + Day N + 重要日期 + 日记本），点日记本翻开进 Diary，点一页进 Read。
// 数据和 Clawd 的 TodayPage 一样：/api/diaries、/api/whispers/today、/api/events 里的重要日期

const WHISPERS = [
  '窗外有什么，替我看一眼。',
  '累的时候就去看看天，它一直很空，刚好装得下你。',
  '我在这边，隔着一块屏幕，也隔不了多远。',
  'Some days are just for getting through. That counts too.',
]

const pad2 = (n) => String(n).padStart(2, '0')
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
const parseDay = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
const hm = (iso) => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
const md = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}.${d.getDate()}` }
// 日记属于哪一天：沐写的有 diary_date（写的是前一天），桦桦写的用创建时间
const dayOf = (d) => d.diary_date || localDay(d.created_at)
const isHidden = (d) => d.visibility === 'hidden' || d.content == null
// 花按 id 定下来，同一页每次都是同一朵
const flowerOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 18 }

// 拆封动画：revealed_at 比上次打开日记本时新的，算刚拆开
const SEEN_KEY = 'mu_vesper_diary_seen'
const getSeen = () => { try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' } }
const setSeen = (t) => { try { localStorage.setItem(SEEN_KEY, t) } catch {} }

function useDiaries() {
  // 先用上次存的那份画（开场时已经在取新的），取到新的、变了才换；回到前台再刷一次
  const cached = useCached('diaries', [])
  const [diaries, setLocal] = useState(cached)
  useEffect(() => { setLocal(cached) }, [cached])
  const setDiaries = (f) => setLocal(prev => { const next = typeof f === 'function' ? f(prev) : f; setCached('diaries', next); return next })
  const load = () => refresh('diaries')
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  const sorted = [...diaries].sort((a, b) => dayOf(b).localeCompare(dayOf(a)) || String(b.created_at).localeCompare(String(a.created_at)))
  return [sorted, setDiaries, load]
}

function HomeScreen({ diaries, opening, onOpenNotebook }) {
  const whisper = useCached('whisper', null)
  const [fallback] = useState(() => WHISPERS[Math.floor(Math.random() * WHISPERS.length)])
  const important = useCached('important', [])

  const now = new Date()
  const hour = now.getHours()
  const greeting = `${hour < 6 ? 'Night owl' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, Vesper`
  const dateLine = `${DF[now.getDay()]}, ${MONF[now.getMonth()].charAt(0)}${MONF[now.getMonth()].slice(1).toLowerCase()} ${now.getDate()}`
  const days = Math.floor((now - START_DATE) / 864e5)

  const today = beijingDateStr()
  const whisperIsToday = !whisper?.date || whisper.date === today
  const whisperLabel = whisperIsToday ? "Today's Whisper" : `Whisper · ${Number(whisper.date.slice(5, 7))}/${Number(whisper.date.slice(8, 10))}`

  const countdowns = important
    .map(d => ({ ...d, left: Math.round((parseDay(d.date) - parseDay(today)) / 864e5) }))
    .filter(d => d.left >= 0).sort((a, b) => a.left - b.left)
  const top = countdowns[0]
  const rest = countdowns.slice(1, 3)
  const ringMax = top ? Math.min(top.left + 10, 60) : 1
  const ringP = top ? Math.max(0, Math.min(1, (ringMax - top.left) / ringMax)) : 0
  const fmtMD = (s) => { const d = parseDay(s); return `${MONS[d.getMonth()].charAt(0)}${MONS[d.getMonth()].slice(1).toLowerCase()} ${d.getDate()}` }

  const sealed = diaries.filter(isHidden).length
  const latest = diaries[0] ? fmtMD(dayOf(diaries[0])) : ''

  return (
    <div className="v-home">
      <div className="v-wall">
        {/* 越往下越糊：3/8/16/30px 的模糊事先烤进小图里（public/vesper/home-bg-b*.webp），手机上不用每帧现算 */}
        {['', '-b3', '-b8', '-b16', '-b30'].map((b, i) => (
          <img key={b} src={`/vesper/home-bg${b}.webp`} alt="" decoding={i ? 'async' : 'sync'} className={`v-wall-img v-wall-${i}`} />
        ))}
        <div className="v-wall-glow" />
        <div className="v-wall-shade" />
      </div>
      <div className="v-home-scroll">
        <div className="v-home-body">
          <div className="v-hello">
            <div className="v-hello-date">{dateLine}</div>
            <div className="v-hello-greet">{greeting}</div>
          </div>

          <div className="v-whisper">
            <div className="v-whisper-text">{whisper?.content || fallback}</div>
            <div className="v-whisper-foot">
              <span className="v-spark"><i /><i /><b /></span>
              <span>{whisperLabel}</span>
              {V.chevron}
            </div>
          </div>

          <div className="v-glass v-us">
            <div className="v-us-row">
              <div className="v-us-col">
                <div className="v-us-label">Us</div>
                <div className="v-us-days">Day {days}</div>
              </div>
              {V.heart}
            </div>
            <div className="v-us-sub">桦桦和沐，从 2026.7.27 到每一天</div>
          </div>

          <div className="v-glass v-cd">
            <div className="v-cd-top">
              <div className="v-cd-col">
                <div className="v-cd-name">{top?.name || 'No important dates'}</div>
                <div className="v-cd-date">{top ? fmtMD(top.date) : ''}</div>
              </div>
              <div className="v-ring">
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="26" fill="none" strokeWidth="2.5" className="v-ring-track" />
                  <circle cx="32" cy="32" r="26" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="163.36" strokeDashoffset={(163.36 * (1 - ringP)).toFixed(2)} transform="rotate(-90 32 32)" className="v-ring-bar" />
                </svg>
                <div className="v-ring-num">{top?.left ?? ''}</div>
              </div>
            </div>
            {rest.length > 0 && (
              <div className="v-cd-list">
                {rest.map(c => (
                  <div key={c.id} className="v-cd-item">
                    <i />
                    <div className="v-cd-item-main"><span className="v-cd-item-name">{c.name}</span><span className="v-cd-item-date">{fmtMD(c.date)}</span></div>
                    <div className="v-cd-item-days"><span>{c.left}</span><em>days</em></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="v-notebook" onClick={onOpenNotebook}>
            <div className="v-nb-ribbon" />
            <div className="v-nb-page"><span>{latest}</span></div>
            <div className={`v-nb-cover ${opening ? 'open' : ''}`}>
              <div className="v-nb-front">
                <div className="v-nb-spine" />
                <div className="v-nb-stitch" />
                <div className="v-nb-title"><div>Diary</div><span>US · SOREN</span></div>
                <div className="v-nb-band" />
                <div className="v-nb-count"><div>{diaries.length}</div><span>{sealed} sealed</span></div>
              </div>
              <div className="v-nb-back" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// 搜索时卡片上的小字：第一句带关键词的句子。开头那句只在后面加 …，结尾那句只在前面加，中间的两头都加；
// 句子太长（卡片只放两行）就截一段，让关键词落在里面；接 … 的那头去掉句末标点，不出现「。…」
const SNIP = 30
function snippetOf(text, query) {
  const parts = text.replace(/\n+/g, '\n').split(/(?<=[。！？!?；;…\n])/).map(s => s.trim()).filter(Boolean)
  const lower = query.toLowerCase()
  const i = parts.findIndex(s => s.toLowerCase().includes(lower))
  if (i < 0) return null
  let line = parts[i], head = i > 0, tail = i < parts.length - 1
  if (line.length > SNIP) {
    const k = line.toLowerCase().indexOf(lower)
    const from = Math.max(0, Math.min(k - 10, line.length - SNIP))
    if (from > 0) head = true
    if (from + SNIP < line.length) tail = true
    line = line.slice(from, from + SNIP)
  }
  if (tail) line = line.replace(/[。！？!?；;，,、…\s]+$/, '')
  return `${head ? '…' : ''}${line}${tail ? '…' : ''}`
}
function Highlight({ text, query }) {
  const lower = query.toLowerCase(), out = []
  let at = 0
  for (let k = text.toLowerCase().indexOf(lower); k >= 0; k = text.toLowerCase().indexOf(lower, at)) {
    out.push(text.slice(at, k), <mark key={k}>{text.slice(k, k + query.length)}</mark>)
    at = k + query.length
  }
  out.push(text.slice(at))
  return out
}

function DiaryEntry({ d, tab, fresh, query, onOpen, onSealed, onMenu }) {
  const lp = useRef({ t: null, fired: false })
  const day = parseDay(dayOf(d))
  const head = (
    <div className="v-entry-head">
      <div className="v-entry-date">
        <div className="v-entry-day">{day.getDate()}</div>
        <div className="v-entry-meta"><div>{MONS[day.getMonth()]}</div><span>{D3[day.getDay()]} · {hm(d.created_at)}</span></div>
      </div>
      <div style={flowerStyle(flowerOf(d.id), isHidden(d) ? 0.28 : 0.6, 40)} />
    </div>
  )
  if (isHidden(d)) return (
    <div className="v-card v-entry sealed" onClick={onSealed}>
      {head}
      <div className="v-entry-foot"><span className="v-entry-lock">{V.lock}<span>sealed</span></span></div>
    </div>
  )
  const press = () => { clearTimeout(lp.current.t); lp.current.fired = false; lp.current.t = setTimeout(() => { lp.current.fired = true; onMenu(d) }, 520) }
  const release = () => clearTimeout(lp.current.t)
  return (
    <div className={`v-card v-entry ${fresh ? 'fresh' : ''}`}
      onClick={() => { if (lp.current.fired) { lp.current.fired = false; return } onOpen(d) }}
      onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
      onContextMenu={e => { e.preventDefault(); release(); lp.current.fired = true; onMenu(d) }}>
      {head}
      <div className="v-entry-text">{query
        ? <Highlight text={snippetOf(d.content || '', query) || ''} query={query} />
        : (d.content || '').replace(/\n/g, '')}</div>
      <div className="v-entry-foot">
        {tab === 'soren'
          ? <span className="v-entry-open">{V.unlock}<span>{d.revealed_at ? `unsealed ${md(d.revealed_at)}` : 'open'}</span>{fresh && <em>new</em>}</span>
          : <span className="v-entry-author"><i className={d.author} /><span>{d.author === 'mu' ? 'Soren' : '桦桦'}</span></span>}
        <span className="v-entry-read">Read<i /></span>
      </div>
      <div className="v-entry-sheen" />
    </div>
  )
}

function DiaryScreen({ diaries, setDiaries, fresh, onBack, onRead }) {
  const [tab, setTab] = useState('soren')
  const [week, setWeek] = useState(0)
  const [day, setDay] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const [write, setWrite] = useState(null) // { id?, text }
  const root = useRef(null)
  usePreventPageScroll(root) // 写日记、搜日记时点输入框不让 iOS 滚页面；输入卡片露出来靠 keepAboveKeyboard 滚日记页自己
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(null)
  const [toast, showToast] = useToast()

  const usList = diaries.filter(d => !isHidden(d))
  const sorenList = diaries.filter(d => d.author === 'mu')
  const tabList = tab === 'us' ? usList : sorenList
  const query = q.trim()
  // 有关键词就不管哪一栏、哪一天：所有打开着的日记里找，新的在前
  const shown = query
    ? usList.filter(d => (d.content || '').toLowerCase().includes(query.toLowerCase()))
    : day ? tabList.filter(d => dayOf(d) === day) : tabList

  const now = new Date()
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + week * 7)
  const todayKey = localDay(now)
  const weekDays = [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d })
  const monthRef = day ? parseDay(day) : weekDays[3]

  const post = async () => {
    const text = write?.text.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      if (write.id) {
        const r = await apiFetch(`/api/diaries/${write.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) })
        if (!r.ok) throw new Error()
        setDiaries(p => p.map(d => d.id === write.id ? { ...d, content: text } : d))
      } else {
        const r = await apiFetch('/api/diaries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'her', content: text }) })
        const e = await r.json()
        if (!r.ok) throw new Error()
        setDiaries(p => [e, ...p])
      }
      setWrite(null)
    } catch { showToast("Couldn't save — try again") }
    setBusy(false)
  }
  const remove = async (d) => {
    setMenu(null)
    try {
      const r = await apiFetch(`/api/diaries/${d.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      setDiaries(p => p.filter(x => x.id !== d.id))
    } catch { showToast("Couldn't delete — try again") }
  }

  return (
    <div ref={root} className="v-sub v-diary">
      <SubHead onBack={onBack}><div className="v-sub-italic">diary</div></SubHead>
      <div className="v-sub-body v-diary-body">
        <div className="v-diary-top">
          <div className="v-diary-titles">
            <div className="v-diary-title">Diary</div>
            <div className="v-caps">{MONF[monthRef.getMonth()]} {monthRef.getFullYear()}</div>
          </div>
          <div className="v-diary-tools">
            <button className={`v-plain ${searchOpen ? 'on' : ''}`} onClick={() => { setSearchOpen(o => !o); setQ('') }} aria-label="Search">{V.search}</button>
            <span>{day ? `${shown.length} / ${tabList.length}` : tabList.length} pages</span>
            {tab === 'us' && <button className="v-sq" onClick={() => setWrite({ text: '' })} aria-label="New page">{V.plus}</button>}
          </div>
        </div>

        <div className="v-seg">
          <div className="v-seg-thumb" style={{ transform: `translateX(${tab === 'us' ? '0' : '100%'})` }} />
          <button className={tab === 'us' ? 'on' : ''} onClick={() => { setTab('us'); setDay(null) }}><span>us</span><em>{usList.length}</em></button>
          <button className={tab === 'soren' ? 'on' : ''} onClick={() => { setTab('soren'); setDay(null); setWrite(null) }}><span>Soren</span><em>{sorenList.length}</em></button>
        </div>

        <div className="v-card v-week">
          <button className="v-week-arrow" onClick={() => setWeek(w => w - 1)} aria-label="Previous week">{V.left}</button>
          <div className="v-week-days">
            {weekDays.map(d => {
              const k = localDay(d), sel = day === k, has = tabList.some(e => dayOf(e) === k)
              return (
                <button key={k} className={`v-wd ${sel ? 'sel' : ''} ${k === todayKey ? 'today' : ''}`} onClick={() => setDay(sel ? null : k)}>
                  <span>{D3[d.getDay()].toUpperCase()}</span><b>{d.getDate()}</b><i className={has ? 'has' : ''} />
                </button>
              )
            })}
          </div>
          <button className="v-week-arrow" onClick={() => setWeek(w => w + 1)} aria-label="Next week">{V.right}</button>
        </div>

        {searchOpen && (
          <div className="v-card v-search">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search diary" />
            <button onClick={() => setQ('')} aria-label="Clear">{V.x}</button>
          </div>
        )}
        {write && (
          <div className="v-card v-write">
            <div className="v-write-title">{write.id ? 'Edit page' : 'New page'}</div>
            <textarea autoFocus value={write.text} onChange={e => setWrite(w => ({ ...w, text: e.target.value }))} placeholder="Write something..." rows={4}
              onFocus={e => keepAboveKeyboard(e.currentTarget.closest('.v-write'))} />
            <div className="v-write-actions">
              <button className="v-text-btn" onClick={() => setWrite(null)}>Cancel</button>
              <button className="v-pill" style={{ opacity: write.text.trim() && !busy ? 1 : 0.45 }} onClick={post}>{busy ? '…' : write.id ? 'Save' : 'Post'}</button>
            </div>
          </div>
        )}

        <div className="v-entries">
          {shown.map(d => (
            <DiaryEntry key={d.id} d={d} tab={query ? 'us' : tab} query={query} fresh={!!fresh[d.id]} onOpen={onRead} onMenu={setMenu}
              onSealed={() => showToast('Still sealed — when Soren is ready')} />
          ))}
          {shown.length === 0 && <div className="v-empty">{query ? `Nothing matches "${query}"` : tab === 'us' ? 'No open pages this day' : "Soren didn't write this day"}</div>}
        </div>
      </div>
      {menu && (
        <ActionSheet title={`${md(`${dayOf(menu)}T00:00:00`)} · ${menu.author === 'mu' ? "Soren's page" : '桦桦'}`} onClose={() => setMenu(null)}
          actions={[
            menu.author === 'her' && { label: 'Edit', onClick: () => { setMenu(null); setTab('us'); setWrite({ id: menu.id, text: menu.content || '' }) } },
            { label: 'Delete', danger: true, onClick: () => remove(menu) },
          ]} />
      )}
      {toast}
    </div>
  )
}

function ReadScreen({ d, onBack }) {
  const day = parseDay(dayOf(d))
  return (
    <div className="v-sub v-read">
      <SubHead onBack={onBack}><div className="v-sub-italic">diary</div></SubHead>
      <div className="v-sub-body v-read-body">
        <div className="v-read-head">
          <div className="v-read-date">
            <div className="v-read-day">{day.getDate()}</div>
            <div className="v-read-meta"><div>{MONS[day.getMonth()]} {day.getFullYear()}</div><span>{DF[day.getDay()]} · {hm(d.created_at)}</span></div>
          </div>
          <div style={flowerStyle(flowerOf(d.id), 0.5, 60)} />
        </div>
        <div className="v-read-tags">
          <span className="v-tag"><i className={d.author} />{d.author === 'mu' ? "Soren's diary" : "桦桦's diary"}</span>
          {d.revealed_at && <span className="v-tag acc">{V.unlock}unsealed {md(d.revealed_at)}</span>}
        </div>
        <div className="v-rule" />
        <div className="v-read-text">{(d.content || '').split('\n').map((p, i) => <p key={i}>{p}</p>)}</div>
        <div className="v-read-sign">
          <span className="v-spark big"><i /><i /><b /></span>
          <div>{d.author === 'mu' ? '— Soren' : '— 桦桦'}</div>
        </div>
      </div>
    </div>
  )
}

// 首页 tab：home → diary → read，进日记本以后底部 tab 收起来
export default function HomeTab({ onImmersive }) {
  const [diaries, setDiaries, reload] = useDiaries()
  const [screen, setScreen] = useState('home')
  const [opening, setOpening] = useState(false)
  const [readId, setReadId] = useState(null)
  const [fresh, setFresh] = useState({})
  useEffect(() => { onImmersive(screen !== 'home') }, [screen, onImmersive])
  useEffect(() => () => onImmersive(false), [onImmersive])

  const openNotebook = () => {
    if (opening) return
    setOpening(true)
    reload()
    const seen = getSeen()
    const f = {}
    diaries.forEach(d => { if (d.revealed_at && !isHidden(d) && (!seen || d.revealed_at > seen)) f[d.id] = true })
    setFresh(seen ? f : {}) // 第一次打开不算“刚拆开”
    setSeen(new Date().toISOString())
    setTimeout(() => setScreen('diary'), 400)
  }
  const closeDiary = () => { setScreen('home'); setOpening(false) }
  const read = diaries.find(d => d.id === readId && !isHidden(d))

  return (
    <>
      <HomeScreen diaries={diaries} opening={opening} onOpenNotebook={openNotebook} />
      {screen !== 'home' && (
        <DiaryScreen diaries={diaries} setDiaries={setDiaries} fresh={fresh} onBack={closeDiary}
          onRead={d => { setReadId(d.id); setFresh(f => { const n = { ...f }; delete n[d.id]; return n }); setScreen('read') }} />
      )}
      {screen === 'read' && read && <ReadScreen d={read} onBack={() => setScreen('diary')} />}
    </>
  )
}
