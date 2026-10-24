import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CcLimitedNotice, useCcUsageBrief } from '../../Usage'
import { loadDraftFiles, saveDraftFiles } from '../../draftFiles.js'
import { usePreventPageScroll } from '../preventScroll.js'
import { I, useChatSwipeBack, useSwipeBack } from '../../App.jsx'
import { API, CC_SESSION, SH_TZ, apiFetch, getDraft, getPasscode, lockApp, setDraftStorage } from '../data.js'
import { VoiceAwareContent, estimateVoiceDurations, useVoicePlayer } from './voice.jsx'
import { ChatHeader } from './ChatHeader.jsx'
import { Composer, useVoiceRecorder } from './Composer.jsx'
import { CcTurn, CcUserMsg } from './Turn.jsx'
import { useStickToBottom } from './useStickToBottom.js'
import { ImageLightbox } from '../ImageLightbox.jsx'
import { kbDebugOn, kbLog } from '../kbDebug.js'

// ─── 聊天页（沐 / CC）────────────────────────────────
// Clawd 和 Vesper 共用这一份（Vesper 外面包 CcLang.Provider value="en"）。从 App.jsx 原样搬过来，逻辑没改；
// 语音在 voice.jsx，markdown 和复制在 markdown.jsx。用到的接口、图标、草稿、左滑返回还在 App.jsx，从那里拿（循环 import，只在函数里用，模块顶层不碰）

// 上传前把图片压缩到 webp（不支持时退回 jpeg），一张照片大概能压到100-300KB
function compressImage(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width))
        width = maxWidth
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(webpBlob => {
        if (webpBlob && webpBlob.type === 'image/webp') return resolve(webpBlob)
        canvas.toBlob(jpegBlob => jpegBlob ? resolve(jpegBlob) : reject(new Error('compression failed')), 'image/jpeg', quality)
      }, 'image/webp', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image load failed')) }
    img.src = objectUrl
  })
}
// ─── 沐 (CC) ─────────────────────────────────────────
// 经后端 /api/cc/* 转发到 VPS 上的 Claude Code。浏览器只持有 APP 口令（apiFetch 带上），bridge token 只在后端。
// 聊天记录现在存在 VPS（bridge 的 inbox/outbox），前端只在内存里留"发送中/发送失败"的临时消息。
// 聊天这一套界面文字默认中文（Clawd）；Vesper 借用时外面包一层 CcLang.Provider value="en"，整套换英文
export const CcLang = createContext('zh')
export function useCcSay() { const en = useContext(CcLang) === 'en'; return (zh, enText) => en ? enText : zh }

// 服务器上的一条记录 → 页面上的消息。系统事件（沐那轮没回上来）不画成气泡，只用来在她那条下面挂提示
function ccFromServer(m) {
  const seq = Number.isSafeInteger(m.seq) ? { seq: m.seq } : {}
  // 他调过的工具：排进他那一轮里，几个挨着的合成一行"用了 N 个工具"
  if (m.role === 'system' && m.kind === 'tool') return { key: m.id, role: 'system', kind: 'tool', tool: m.tool, sum: m.sum || '', ok: m.ok !== false, time: m.time, ...seq, ...(typeof m.pid === 'string' ? { pid: m.pid } : {}) }
  if (m.role === 'system') return { key: m.id, role: 'system', kind: m.kind, replyTo: m.reply_to, time: m.time, ...seq }
  return {
    key: m.id, role: m.role === 'user' ? 'user' : 'assistant', text: m.text || '', time: m.time, ...seq,
    ...(m.late && Number.isSafeInteger(m.display_before) ? { late: true, displayBefore: m.display_before } : {}),
    ...(typeof m.pid === 'string' ? { pid: m.pid } : {}),
    ...(m.edited_at ? { editedAt: m.edited_at } : {}),
    ...(m.via === 'app' ? { viaApp: true } : {}), // 她在官方 Claude App（Remote Control）里直接跟他说的，bridge 认出来补记的
    ...(m.role === 'user' && typeof m.client_id === 'string' ? { clientId: m.client_id } : {}), // 前端发的：认出对应的临时消息
    // 切到 API 时后端调模型回的：记下是哪个模型，有思考过程就带上（块里折叠显示，复制不带）
    ...(m.role === 'assistant' && m.via === 'api' ? { viaApi: true, model: typeof m.model === 'string' ? m.model : '' } : {}),
    ...(m.role === 'assistant' && typeof m.thinking === 'string' && m.thinking.trim() ? { thinking: m.thinking } : {}),
    ...(m.images?.length ? { images: m.images.map(path => ({ path })) } : {}),
    ...(m.files?.length ? { files: m.files.map(f => ({ path: f.path, name: f.name, size: f.size })) } : {}),
    ...(m.voices?.length ? { voices: m.voices.map(v => ({ path: v.path, ...ccVoiceView(v) })) } : {}),
  }
}
// 一条语音（bridge /listen 回的、或者 history 里的）：ears 转出来的字、语气、和她平时比偏了多少、时长
function ccVoiceView(v) {
  return {
    text: typeof v.text === 'string' ? v.text : '',
    emotion: typeof v.emotion === 'string' ? v.emotion : '',
    hint: typeof v.hint === 'string' ? v.hint : '',
    relative: v.relative && typeof v.relative === 'object' ? v.relative : {},
    ...(Number.isFinite(v.duration) ? { duration: v.duration } : {}),
    ...(v.learning ? { learning: true } : {}),
  }
}
// 兜底：发出后这么久没回、也没收到"没回上来"的事件（bridge 挂了之类），就停三个点说"他好像卡住了"。
// 2026-09-27 ~ 10-10 共 269 次"她发 → 他回"：中位 4 秒，p99 27 秒，最慢 34 秒，取 120 秒
const CC_STUCK_MS = 120 * 1000
// 她哪几条"没回上来"还没解决：key → 那个系统事件。之后沐又回过话就都算解决了（history 按先后排好）
// partial：她那条之后、断掉之前他已经说了几句（"话没说完就断了"）
function ccUnresolvedFailures(history) {
  const out = new Map()
  let spoke = false
  for (const m of history) {
    if (m.role === 'user') spoke = false
    else if (m.role === 'assistant') { out.clear(); spoke = true }
    else if (m.role === 'system' && m.kind === 'reply_failed' && m.replyTo) out.set(m.replyTo, { ...m, partial: spoke })
  }
  return out
}
// 先后：两条都有 bridge 给的序号就比序号（同一秒的几条也排得对），否则比时间（旧记录、发送中的本地消息）
// 晚到、补上的话带 displayBefore：排在那个序号那条的前面（几条补在同一处时按各自序号排）
const ccPos = m => (m.displayBefore != null ? m.displayBefore - 0.5 : m.seq)
const ccOrder = (a, b) => (a.seq != null && b.seq != null ? (ccPos(a) - ccPos(b)) || (a.seq - b.seq) : new Date(a.time) - new Date(b.time))
// 他同一轮（bridge 给的 pid）里的几段话合成一块显示；没有 pid 的旧记录，挨着的、前后不超过 3 分钟的算一轮
const CC_TURN_GAP_MS = 3 * 60 * 1000
export const ccIsTool = m => m.role === 'system' && m.kind === 'tool'
const ccIsHis = m => m.role === 'assistant' || ccIsTool(m) // 算进他那一块的：他的话和他调的工具
// 往上加载前记下的锚点：屏幕顶上那一带的消息行，和它离列表顶的距离。
// 跳过列表第一行：更早的话插进来时可能和它是同一轮，并进这一行、把它的顶往上撑；第一行后面那行的位置只跟插进来的总高度有关
function ccListAnchor(el) {
  if (!el) return null
  const lt = el.getBoundingClientRect().top
  const rows = [...el.querySelectorAll(':scope > [data-mids]')]
  const row = rows.slice(1).find(r => r.getBoundingClientRect().bottom > lt) || rows[0]
  return row ? { mid: row.dataset.mids.split(' ')[0], top: row.getBoundingClientRect().top - lt } : null
}

function ccRows(messages) {
  const rows = []
  const seen = new Map() // pid → 出现过几块（同一轮被她的消息隔开时，块的 key 不撞）
  for (const m of messages) {
    const prev = rows[rows.length - 1]
    if (ccIsHis(m) && prev?.turn) {
      const last = prev.items[prev.items.length - 1]
      const same = m.pid || last.pid ? m.pid === last.pid : Math.abs(new Date(m.time) - new Date(last.time)) <= CC_TURN_GAP_MS
      if (same) { prev.items.push(m); continue }
    }
    if (ccIsHis(m)) {
      const n = m.pid ? (seen.get(m.pid) || 0) : 0
      if (m.pid) seen.set(m.pid, n + 1)
      rows.push({ turn: true, key: m.pid ? `turn-${m.pid}-${n}` : `turn-${m.key}`, items: [m] })
    } else rows.push({ turn: false, key: m.key, m })
  }
  return rows
}

// 他边写边到的新段落：整段从透明渐变到完全显示、往上浮 6px，不遮罩、不逐字。字是一到就完整写进页面的（能复制、能长按选字）。
// 时长固定 CC_REVEAL_MS，想快想慢改这个数
const CC_REVEAL_MS = 350
const ccRevealed = new Set() // 已经浮现过的：块重新挂载（前面插进来补上的话）时不再播一遍
export const ccReduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
// 新到的东西播一次淡入：key 记进 ccRevealed，之后重新挂载不再播
function useCcReveal(key, live) {
  const [anim, setAnim] = useState(() => !!live && !ccRevealed.has(key) && !ccReduceMotion())
  useEffect(() => {
    ccRevealed.add(key)
    if (!anim) return
    const t = setTimeout(() => setAnim(false), CC_REVEAL_MS + 300) // 动画事件没来（切走页面之类）也一定去掉
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return [anim ? ' cc-reveal' : '', e => { if (e.target === e.currentTarget) setAnim(false) }]
}
// 他的一轮的气泡：新的一轮整个气泡（底色带字）一起淡入；第一段跟着气泡出现，自己不再播
export function CcTurnBody({ rowKey, live, children }) {
  const [cls, onEnd] = useCcReveal(`turn:${rowKey}`, live)
  return <div className={`cc-turn-body${cls}`} onAnimationEnd={onEnd}>{children}</div>
}
export function CcPiece({ m, player, showTranscript, first }) {
  const say = useCcSay()
  const [cls, onEnd] = useCcReveal(m.key, m.live && !first)
  return (
    <div className={`cc-piece${cls}`} onAnimationEnd={onEnd}>
      {m.thinking && <CcThinking text={m.thinking} />}
      <VoiceAwareContent raw={m.text} msgKey={m.key} player={player} showTranscript={showTranscript} flat />
      {m.late && <div className="cc-late">{say('补上的', 'Late')}</div>}
    </div>
  )
}
// 他调的工具：一个就直接写"读了 xx"；挨着的几个合成"用了 N 个工具"，点开一行一个。照 Claude App，小字、默认收起
const CC_TOOL_VERB = {
  Read: '读了', Edit: '改了', MultiEdit: '改了', Write: '写了', NotebookEdit: '改了', Bash: '跑了',
  WebSearch: '搜了', WebFetch: '看了网页', Grep: '搜了', Glob: '找了', ToolSearch: '找了工具', TodoWrite: '记了待办', Task: '派了个帮手', Agent: '派了个帮手',
}
const CC_TOOL_VERB_EN = {
  Read: 'Read', Edit: 'Edited', MultiEdit: 'Edited', Write: 'Wrote', NotebookEdit: 'Edited', Bash: 'Ran',
  WebSearch: 'Searched', WebFetch: 'Opened', Grep: 'Searched', Glob: 'Found', ToolSearch: 'Looked up tools', TodoWrite: 'Noted todos', Task: 'Sent a helper', Agent: 'Sent a helper',
}
function ccToolLabel(t, say) {
  const verb = say(CC_TOOL_VERB[t.tool], CC_TOOL_VERB_EN[t.tool]) || say(`用了 ${t.tool}`, `Used ${t.tool}`)
  return <><span>{verb}</span>{t.sum && <code className="cc-tool-sum">{t.sum}</code>}{!t.ok && <span className="cc-tool-fail">{say('没成功', 'failed')}</span>}</>
}
export function CcTools({ tools }) {
  const say = useCcSay()
  const [open, setOpen] = useState(false)
  if (tools.length === 1) return <div className="cc-tools"><div className="cc-tool-line">{ccToolLabel(tools[0], say)}</div></div>
  const failed = tools.filter(t => !t.ok).length
  return (
    <div className={`cc-tools${open ? ' open' : ''}`}>
      <button className="cc-thinking-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span>{say(`用了 ${tools.length} 个工具`, `Used ${tools.length} tools`)}{failed ? say(`（${failed} 个没成功）`, ` (${failed} failed)`) : ''}</span>{I.chevron}
      </button>
      {open && <div className="cc-tools-body">{tools.map(t => <div key={t.key} className="cc-tool-line">{ccToolLabel(t, say)}</div>)}</div>}
    </div>
  )
}
// 一块里的东西按先后分组：挨着的工具合成一组，话一段一个
export function ccTurnParts(items) {
  const parts = []
  for (const it of items) {
    const prev = parts[parts.length - 1]
    if (ccIsTool(it)) {
      if (prev?.tools) prev.tools.push(it)
      else parts.push({ key: `tools-${it.key}`, tools: [it] })
    } else parts.push({ key: it.key, m: it })
  }
  return parts
}

// API 回的那段的思考过程：照 Claude App，默认收起，点"思考过程"展开/收起；展开后小字、保留换行，太长在框里滚
function CcThinking({ text }) {
  const say = useCcSay()
  const [open, setOpen] = useState(false)
  return (
    <div className={`cc-thinking${open ? ' open' : ''}`}>
      <button className="cc-thinking-head" onClick={() => setOpen(v => !v)} aria-expanded={open}><span>{say('思考过程', 'Thinking')}</span>{I.chevron}</button>
      {open && <div className="cc-thinking-body">{text}</div>}
    </div>
  )
}

// ─── 回复方式：CC / API ───────────────────────────────
// 盖在聊天页上面的整页（聊天页不卸载，SSE 不断）。开关和模型都以后端 /api/cc/brain 为准，目录来自 /api/cc/api-models
// 聊天页标题下面那行：API 模式显示"API · Opus 4.6 · K · thinking"，目录里找不到就只显示模型名
function ccBrainLabel(brain) {
  if (brain?.target !== 'api') return null
  if (brain.family?.name && brain.option?.label) return `API · ${brain.family.name} · ${brain.option.label}`
  return brain.model ? `API · ${brain.model}` : 'API'
}
const ccSeries = (f) => [...new Set((f.options || []).map(o => o.series).filter(Boolean))].join(' · ')
const ccClip = (s, n) => { const a = [...(s || '')]; return a.length > n ? `${a.slice(0, n).join('')}…` : a.join('') }
// 选模型、测试都要发 JSON；401 时 apiFetch 已经让整个 App 回锁屏，这里只报错
async function ccPostJson(path, body) {
  const res = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.status === 401) throw new Error('unauthorized')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// 回复方式现在是哪个：聊天页顶上的状态行、⋮ 那页、回复方式页都用
async function fetchCcBrain() {
  const res = await apiFetch(`/api/cc/brain`)
  if (res.status === 401) throw new Error('unauthorized')
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}

// ⋮ → 回复方式：自己拉一次现在的状态再交给 CcBrainPage
export function CcBrainScreen({ onBack }) {
  const [brain, setBrain] = useState(null)
  const [brainError, setBrainError] = useState('') // 拉不到时的原因（bridge 连不上之类），页上显示
  useEffect(() => {
    let alive = true
    fetchCcBrain().then(b => { if (alive) setBrain(b) }).catch(err => { if (alive && err.message !== 'unauthorized') setBrainError(err.message) })
    return () => { alive = false }
  }, [])
  return <CcBrainPage brain={brain} brainError={brainError} onChange={setBrain} onClose={onBack} />
}

// ⋮ 那页：离开聊天页，三个入口各自又是一整页
export function CcMenuPage({ onBack, onOpen }) {
  const say = useCcSay()
  const swipe = useSwipeBack(onBack)
  const [brain, setBrain] = useState(null)
  useEffect(() => {
    let alive = true
    fetchCcBrain().then(b => { if (alive) setBrain(b) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return (
    <div className="more-sub-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={onBack} aria-label={say('返回聊天', 'Back to chat')}>{I.back}</button><h1>{say('聊天信息', 'Chat Info')}</h1></div>
      <div className="card settings-card">
        <div className="setting-item" onClick={() => onOpen('search')}><span>{say('查找聊天记录', 'Search Chat')}</span>{I.chevron}</div>
        <div className="setting-item" onClick={() => onOpen('brain')}><span>{say('回复方式', 'Reply Mode')}</span>{brain && <span className="setting-value">{brain.target === 'api' ? 'API' : 'CC'}</span>}{I.chevron}</div>
        <div className="setting-item" onClick={() => onOpen('usage')}><span>Usage</span>{I.chevron}</div>
      </div>
    </div>
  )
}

// 搜索结果的时间：今年的不写年份
function fmtSearchTime(t, en) {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  if (en) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: SH_TZ, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]))
    const y = new Intl.DateTimeFormat('en-CA', { timeZone: SH_TZ, year: 'numeric' }).format(new Date())
    return `${p.month} ${p.day}${p.year === y ? '' : `, ${p.year}`} ${p.hour}:${p.minute}`
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: SH_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]))
  const thisYear = new Intl.DateTimeFormat('en-CA', { timeZone: SH_TZ, year: 'numeric' }).format(new Date())
  return `${p.year === thisYear ? '' : `${p.year}年`}${p.month}月${p.day}日 ${p.hour}:${p.minute}`
}
// 摘要里把搜的词标出来（不分大小写）
function ccHighlight(text, terms) {
  const ws = (terms || []).filter(Boolean)
  if (!ws.length) return text
  const re = new RegExp(`(${ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : part)
}
const CC_HIT_FROM = { image: '图片里的字', voice: '语音', file: '文件' }
const CC_HIT_FROM_EN = { image: 'Text in image', voice: 'Voice', file: 'File' }

// 查找聊天记录：搜双方的话、语音转写、文件名、图片里的字（bridge 每次全读一遍比对），从新到旧。
// 点一条跳回聊天页、停在那条。搜过的词和结果留在 saved 里，从聊天页再进来还在
export function CcSearchPage({ saved, onBack, onPick }) {
  const say = useCcSay()
  const swipe = useSwipeBack(onBack)
  const [q, setQ] = useState(saved.current.q)
  const [res, setRes] = useState(saved.current.res) // { q, terms, results, hasMore }；null = 还没搜
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const reqRef = useRef(0) // 只认最后一次请求的结果
  useEffect(() => { saved.current = { ...saved.current, q, res } }, [q, res, saved])
  useLayoutEffect(() => { if (listRef.current) listRef.current.scrollTop = saved.current.scrollTop || 0 }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (query, before) => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ q: query, limit: '30' })
      if (before) qs.set('before', before)
      const r = await apiFetch(`/api/cc/search?${qs}`)
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      if (id !== reqRef.current) return
      setRes(prev => {
        const old = before && prev?.q === query ? prev.results : []
        const seen = new Set(old.map(x => x.id))
        return { q: query, terms: data.terms || [], results: [...old, ...(data.results || []).filter(x => !seen.has(x.id))], hasMore: !!data.has_more }
      })
    } catch (err) {
      if (id === reqRef.current) setError(err.message === 'unauthorized' ? '' : say('搜不了，过一会儿再试', "Can't search right now — try again later"))
    }
    if (id === reqRef.current) setLoading(false)
  }, [])

  // 停手 300ms 再搜；清空就清掉结果
  useEffect(() => {
    const query = q.trim()
    if (query === (res?.q ?? '')) return
    if (!query) { reqRef.current++; setRes(null); setLoading(false); setError(''); return }
    const t = setTimeout(() => run(query), 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = (e) => {
    const el = e.currentTarget
    saved.current.scrollTop = el.scrollTop
    if (!loading && res?.hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 300) run(res.q, res.results[res.results.length - 1].time)
  }

  return (
    <div className="more-sub-page cc-search-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={onBack} aria-label={say('返回', 'Back')}>{I.back}</button><h1>{say('查找聊天记录', 'Search Chat')}</h1></div>
      <div className="cc-search-box">
        {I.search}
        <input type="search" enterKeyHint="search" autoFocus={!q} value={q} onChange={e => setQ(e.target.value)} placeholder={say('搜说过的话、图片里的字', 'Words, or text in photos')} maxLength={100} />
        {q && <button className="icon-btn" onClick={() => setQ('')} aria-label={say('清空', 'Clear')}>{I.close}</button>}
      </div>
      <div className="cc-search-results" ref={listRef} onScroll={onScroll}>
        {res?.results.map(r => (
          <div key={r.id} className="cc-search-hit" role="button" tabIndex={0} onClick={() => onPick(r)}>
            {r.hit.image && <CcImage img={{ path: r.hit.image }} onOpen={() => onPick(r)} />}
            <span className="cc-search-hit-main">
              <span className="cc-search-hit-top">
                <span className="cc-search-who">{r.role === 'user' ? say('我', 'Me') : say('沐', 'Soren')}</span>
                {CC_HIT_FROM[r.hit.in] && <span className="cc-search-from">{say(CC_HIT_FROM[r.hit.in], CC_HIT_FROM_EN[r.hit.in])}</span>}
                <span className="cc-search-time">{fmtSearchTime(r.time, say(false, true))}</span>
              </span>
              <span className="cc-search-snippet">{ccHighlight(r.hit.snippet, res.terms)}</span>
            </span>
          </div>
        ))}
        {error && <div className="empty-state">{error}</div>}
        {loading && <div className="empty-state">{say('搜索中…', 'Searching…')}</div>}
        {!loading && !error && res && !res.results.length && <div className="empty-state">{say(`没有找到「${res.q}」`, `Nothing found for "${res.q}"`)}</div>}
        {!loading && !error && res?.results.length > 0 && !res.hasMore && <div className="cc-search-end">{say('没有更早的了', 'Nothing earlier')}</div>}
        {!res && !loading && <div className="cc-search-end">{say('空格隔开几个词，要都出现才算', 'Separate words with spaces — all must match')}</div>}
      </div>
    </div>
  )
}

function CcBrainPage({ brain, brainError, onChange, onClose }) {
  const say = useCcSay()
  const [catalog, setCatalog] = useState(null) // /api/cc/api-models：{ default, families }
  const [catalogError, setCatalogError] = useState(false)
  const [famKey, setFamKey] = useState(null) // 点进去的那个系列（第二层），null = 系列列表
  const [want, setWant] = useState(null) // 正在切过去的 target：开关先滑过去，失败再滑回来
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [test, setTest] = useState(null) // null / { running } / { ok, ms, text, error }
  const fam = famKey ? catalog?.families?.find(f => f.key === famKey) : null
  const back = () => fam ? setFamKey(null) : onClose()
  const swipe = useSwipeBack(back)

  useEffect(() => {
    let alive = true
    apiFetch(`/api/cc/api-models`)
      .then(async res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then(d => { if (alive) setCatalog(d) })
      .catch(() => { if (alive) setCatalogError(true) })
    return () => { alive = false }
  }, [])

  const supported = brain?.supported !== false
  const isApi = brain?.target === 'api'
  const shown = want || (isApi ? 'api' : 'cc')
  const locked = !brain || !supported || busy

  // 切开关、选模型都走这里：用后端返回的状态，出错把原话显示出来
  const save = async (body) => {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      onChange(await ccPostJson(`/api/cc/brain`, body))
      return true
    } catch (err) {
      if (err.message !== 'unauthorized' && err.message !== 'locked') setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const setTarget = async (target) => {
    if (locked || shown === target) return
    setWant(target)
    await save({ target })
    setWant(null)
  }
  const pick = async (o) => {
    if (!o.ready || busy) return
    if (await save({ target: 'api', model: o.model, group: o.group })) setFamKey(null)
  }
  // 测的是现在选中的那个；结果记着是哪个模型的，测的时候换了模型就不显示旧结果
  const testKey = `${brain?.group}|${brain?.model}`
  const runTest = async () => {
    if (!brain?.model || test?.running) return
    const key = testKey
    setTest({ running: true, key })
    try {
      setTest({ ...(await ccPostJson(`/api/cc/api-test`, { model: brain.model, group: brain.group })), key })
    } catch (err) {
      setTest(err.message === 'unauthorized' || err.message === 'locked' ? null : { ok: false, error: err.message, key })
    }
  }

  const famSelected = (f) => brain?.family ? brain.family.key === f.key : (f.options || []).some(o => o.model === brain?.model && o.group === brain?.group)

  return (
    <div className="cc-brain-page" {...swipe}>
      <div className="chatroom-header">
        <button className="icon-btn" onClick={back} aria-label={say('返回', 'Back')}>{I.back}</button>
        <div className="chatroom-title"><div className="chatroom-name">{fam ? fam.name : say('回复方式', 'Reply Mode')}</div></div>
      </div>
      <div className="cc-brain-scroll">
        {fam ? (
          <div className="card settings-card">
            {(fam.options || []).map(o => {
              const on = isApi && o.model === brain?.model && o.group === brain?.group
              return (
                <button key={o.id || `${o.group}|${o.model}`} className={`cc-brain-row${o.ready ? '' : ' off'}`} onClick={() => pick(o)} disabled={!o.ready || busy}>
                  <span className="cc-brain-row-main">
                    <span className="cc-brain-row-name">{o.label}</span>
                    {o.desc && <span className="cc-brain-row-sub">{o.desc}</span>}
                    <span className="cc-brain-row-model">{o.model}</span>
                  </span>
                  {!o.ready ? <span className="cc-brain-row-note">{say('没配 key', 'No key')}</span> : on && <span className="cc-brain-check">{I.check}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <>
            <div className={`cc-brain-switch${shown === 'api' ? ' api' : ''}${!brain || !supported ? ' off' : ''}`} role="radiogroup" aria-label={say('回复方式', 'Reply mode')}>
              <span className="cc-brain-thumb" aria-hidden="true" />
              <button role="radio" aria-checked={shown === 'cc'} onClick={() => setTarget('cc')} disabled={locked}>CC</button>
              <button role="radio" aria-checked={shown === 'api'} onClick={() => setTarget('api')} disabled={locked}>API</button>
            </div>
            <div className="cc-brain-hint">{!brain ? (brainError ? say(`拿不到现在的状态（${brainError}），过一会儿再进来试试`, `Can't read the current mode (${brainError}) — try again later`) : say('还没拿到现在的状态…', 'Reading the current mode…')) : isApi ? say('沐用下面选的模型回你，没有工具，只能说话', 'Soren replies with the model below — no tools, just talk') : say('沐在 VPS 上的 Claude Code 里回你', 'Soren replies from Claude Code on the VPS')}</div>
            {brain && !supported && <div className="cc-brain-hint">{say('bridge 还没更新到能切换的版本，现在只能用 CC', "The bridge can't switch yet — CC only for now")}</div>}
          </>
        )}
        {error && <div className="cc-brain-error" role="alert" onClick={() => setError('')}>{error}</div>}

        {!fam && isApi && (
          <>
            <div className="card-title-outer">{say('模型', 'Model')}</div>
            {!catalog && <div className="empty-state-sm">{catalogError ? say('拉不到模型列表，过一会儿再试', "Can't load models — try again later") : 'Loading…'}</div>}
            {catalog?.families?.length > 0 && (
              <div className="card settings-card">
                {catalog.families.map(f => (
                  <button key={f.key} className="cc-brain-row" onClick={() => setFamKey(f.key)}>
                    <span className="cc-brain-row-main">
                      <span className="cc-brain-row-name">{f.name}</span>
                      {ccSeries(f) && <span className="cc-brain-row-sub">{ccSeries(f)}</span>}
                    </span>
                    {famSelected(f) && <span className="cc-brain-check">{I.check}</span>}
                    <span className="cc-brain-chevron">{I.chevron}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="cc-brain-test">
              <button className="cc-brain-test-btn" onClick={runTest} disabled={!brain?.model || !!test?.running}>{test?.running ? say('测试中…', 'Testing…') : say('测试一下', 'Test')}</button>
              {test && !test.running && test.key === testKey && (
                <div className={`cc-brain-test-result${test.ok ? ' ok' : ''}`}>
                  {test.ok ? `✓ ${((test.ms || 0) / 1000).toFixed(1)}${say(' 秒', 's')} · ${ccClip(test.text, 40)}` : `✗ ${test.error || say('没通', 'failed')}`}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// 每条消息一个 client_id，重发时带同一个，bridge 据此去重，沐不会收到两条
const ccClientId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

// 自己发的文字原地改：和原话一样（只差首尾空格也算）就当取消，不发请求；不能改成空的
export function CcEditBox({ text, onSave, onCancel }) {
  const say = useCcSay()
  const [value, setValue] = useState(text)
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)
  useLayoutEffect(() => { const ta = ref.current; if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px' } }, [value])
  useEffect(() => { const ta = ref.current; if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) } }, [])
  const next = value.trim()
  const save = async () => {
    if (next === text.trim()) return onCancel()
    if (!next || saving) return
    setSaving(true)
    if (!(await onSave(next))) setSaving(false)
  }
  return (
    <div className="cc-edit">
      <textarea ref={ref} value={value} onChange={e => setValue(e.target.value)} rows={1} disabled={saving} />
      <div className="cc-edit-actions">
        <button className="cc-edit-cancel" onClick={onCancel} disabled={saving}>{say('取消', 'Cancel')}</button>
        <button className="cc-edit-save" onClick={save} disabled={!next || saving}>{saving ? say('保存中…', 'Saving…') : say('确认', 'Save')}</button>
      </div>
    </div>
  )
}
const CC_PAGE = 30
// 图片 + 文件一次最多几个、文件能选哪些类型、单个多大：都以 /api/cc/file-types 为准
// （白名单唯一来源是 VPS 上的 /opt/mu-bridge/file_types.json，前端不写死）。拿不到时图片照常能发，按 20 个算
const CC_MAX_ITEMS_FALLBACK = 20
const ccExt = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : '' }
export const fmtFileSize = (n) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
// 带口令取回 bridge 上的图或文件（<img>/<a> 带不了 Authorization），blob 地址按 path 缓存在内存里。
// 聊天里的图要缩略图（thumb：bridge 做的 360×360 webp，十几 KB），点开大图才要原图；内存里缩略图的 key 是 `${path}#thumb`。
// 图还存进浏览器的 Cache Storage：文件名是 uuid、内容永远不变，存一次下次打开 App 直接读，不用再绕 Render 和梯子。
// iPhone 好几天不打开可能被系统清掉，读不到、存不进（无痕模式、非 https）都当没有，照常走网络
export const ccImageCache = new Map()
const CC_IMG_CACHE = 'cc-images-v1'
const ccImgKey = (path, thumb) => `/cc-img/${path.split('/').slice(-2).join('/')}${thumb ? '?thumb=1' : ''}`
async function ccImgCacheGet(path, thumb) {
  try {
    const r = await (await caches.open(CC_IMG_CACHE)).match(ccImgKey(path, thumb))
    return r ? await r.blob() : null
  } catch { return null }
}
async function ccImgCachePut(path, thumb, blob) {
  try { await (await caches.open(CC_IMG_CACHE)).put(ccImgKey(path, thumb), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } })) } catch {}
}
export async function fetchCcImage(path, { thumb = false } = {}) {
  const memKey = thumb ? `${path}#thumb` : path
  if (ccImageCache.has(memKey)) return ccImageCache.get(memKey)
  if (thumb && ccImageCache.has(path)) return ccImageCache.get(path) // 刚发的图：内存里有本地原图，直接用
  const image = /\.(jpg|png|webp|heic)$/i.test(path)
  let blob = image ? await ccImgCacheGet(path, thumb) || (thumb ? await ccImgCacheGet(path, false) : null) : null
  if (!blob) {
    const [date, file] = path.split('/').slice(-2)
    const res = await apiFetch(`/api/cc/uploads/${encodeURIComponent(date)}/${encodeURIComponent(file)}${thumb ? '?thumb=1' : ''}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    blob = await res.blob()
    // 缩略图只存真的缩略图（webp）：bridge 做不出来、或者后端还没更新时回的是原图，别把原图当缩略图永久存下
    if (image && (!thumb || blob.type === 'image/webp')) ccImgCachePut(path, thumb, blob)
  }
  const url = URL.createObjectURL(blob)
  ccImageCache.set(memKey, url)
  return url
}
// 上传失败时把后端的提示（"不支持 .docx 文件"、"文件不能超过 20MB"）带出来。
// 用 XHR 不用 fetch：fetch 拿不到上传进度，聊天里每张图上要画传了多少（onProgress 给 0~1）
function ccUploadForm(form, onProgress) {
  const passcode = getPasscode()
  if (!passcode) { lockApp(); return Promise.reject(new Error('unauthorized')) }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API}/api/cc/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${passcode}`)
    xhr.upload.onprogress = e => { if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => {
      if (xhr.status === 401) { lockApp(); return reject(new Error('unauthorized')) }
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(data.error || `HTTP ${xhr.status}`))
      resolve(data)
    }
    xhr.onerror = xhr.onabort = () => reject(new Error('HTTP 0')) // 断网：不弹提示，那张图上会显示重试
    xhr.send(form)
  })
}
async function uploadCcImage(blob, onProgress) {
  const form = new FormData()
  form.append('image', blob, blob.type === 'image/webp' ? 'image.webp' : 'image.jpg')
  return (await ccUploadForm(form, onProgress)).path
}
async function uploadCcFile(file, onProgress) {
  const form = new FormData()
  form.append('name', file.name) // 原文件名单独放一个字段：multipart 的 filename 遇到中文各家浏览器编码不一
  form.append('file', file, file.name)
  return (await ccUploadForm(form, onProgress)).path
}
// 刚发出去还在传的图 / 文件上盖一层：一圈进度；这张传失败了换成重试按钮，点了只重传这一张
export function CcUpMark({ st, onRetry }) {
  if (!st) return null
  if (st.failed) return (
    <button className="cc-up failed" onClick={e => { e.stopPropagation(); onRetry() }} aria-label="Retry">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
    </button>
  )
  const r = 13, c = 2 * Math.PI * r
  return (
    <div className="cc-up" aria-label={`${Math.round(st.pct * 100)}%`}>
      <svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r={r} className="track" /><circle cx="17" cy="17" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - st.pct)} /></svg>
    </div>
  )
}
// 打开/下载文件。手机上用 <a download>（iOS 会直接预览，能分享/存储）；电脑上新开标签页看，看不了的浏览器会自己下载
function saveBlobUrl(url, name) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}
const isMobileUa = () => /iPhone|iPad|Android/i.test(navigator.userAgent)

const CC_FILE_ICON = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
const CC_DOWNLOAD_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
const CC_OFFICE_EXTS = new Set(['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'])
export function CcFileIcon({ name }) {
  return <span className="cc-file-icon">{CC_FILE_ICON}<span className="cc-file-ext">{ccExt(name).slice(0, 4).toUpperCase()}</span></span>
}

// 聊天里自己发的文件：类型图标 + 原文件名 + 大小，点一下打开，右边按钮下载。bridge 只留 7 天，过期了灰掉
export function CcFile({ file }) {
  const say = useCcSay()
  const [state, setState] = useState('idle') // idle | loading | gone
  const getUrl = async () => file.localUrl || await fetchCcImage(file.path)
  const open = async (download) => {
    if (state !== 'idle') return
    // 电脑上要先同步开窗，等拿到文件再跳，不然会被当成弹窗拦掉；Word/Excel/PPT 浏览器打不开，直接下载
    const office = CC_OFFICE_EXTS.has(ccExt(file.name))
    const win = !download && !office && !isMobileUa() ? window.open('', '_blank') : null
    setState('loading')
    try {
      const url = await getUrl()
      if (win) {
        // 剩下的除了 pdf 都是文本：按纯文本打开，免得 csv/代码文件在新标签里被当成下载
        if (ccExt(file.name) === 'pdf') win.location.href = url
        else win.location.href = URL.createObjectURL(new Blob([await (await fetch(url)).blob()], { type: 'text/plain; charset=utf-8' }))
      } else saveBlobUrl(url, file.name)
      setState('idle')
    } catch (err) {
      win?.close()
      setState(err.message === 'HTTP 404' ? 'gone' : 'idle')
    }
  }
  return (
    <div className={`bubble cc-file${state === 'gone' ? ' cc-file-gone' : ''}`} onClick={() => open(false)} role="button" title={file.name}>
      <CcFileIcon name={file.name} />
      <span className="cc-file-info">
        <span className="cc-file-name">{file.name}</span>
        <span className="cc-file-size">{state === 'gone' ? say('文件已过期', 'Expired') : state === 'loading' ? say('打开中…', 'Opening…') : fmtFileSize(file.size || 0)}</span>
      </span>
      {state !== 'gone' && <button className="cc-file-dl" onClick={e => { e.stopPropagation(); open(true) }} aria-label="Download">{CC_DOWNLOAD_ICON}</button>}
    </div>
  )
}

// 聊天里自己发的图：刚发的用本地预览，刷新后的历史按 path 向后端取；bridge 只留 7 天，过期了显示占位
// 聊天里显示缩略图；点开交给 ImageLightbox 去取原图（刚发的图本地就有原图，直接用）
export function CcImage({ img, onOpen }) {
  const say = useCcSay()
  const [url, setUrl] = useState(img.localUrl || (img.path && (ccImageCache.get(`${img.path}#thumb`) || ccImageCache.get(img.path))) || null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (url || !img.path) return
    let alive = true
    fetchCcImage(img.path, { thumb: true }).then(u => { if (alive) setUrl(u) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [img.path, url])
  if (failed) return <div className="cc-thumb cc-thumb-gone">{say('图片已过期', 'Image expired')}</div>
  if (!url) return <div className="cc-thumb cc-thumb-loading" />
  return <img src={url} alt="" className="cc-thumb" data-lb={img.path || img.localUrl} onClick={() => onOpen(img)} />
}
// 按住说话：录音交给后端 /api/cc/listen（→ bridge → VPS 本机的 ears 转写 + 听语气），回 { path, text, emotion, … }
// 声纹锁认不出是她（422）、太短（400）：这段不发，err.drop 让发送那边直接撤掉临时消息
async function listenCcVoice(blob, duration) {
  const form = new FormData()
  form.append('duration', String(Math.round(duration * 10) / 10))
  form.append('audio', blob, /mp4/.test(blob.type) ? 'voice.m4a' : /ogg/.test(blob.type) ? 'voice.ogg' : 'voice.webm')
  const res = await apiFetch(`/api/cc/listen`, { method: 'POST', body: form })
  if (res.status === 401) throw new Error('unauthorized')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { drop: res.status === 400 || res.status === 422 })
  return data
}
const CC_PLAY_ICON = <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>
const CC_PAUSE_ICON = <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>

// 她发的语音：点一下放 / 停，下面是 ears 转出来的字和语气（和她平时比偏了多少）
// 录音先取好放着，点的那一下同步 play()，iPhone 才不会因为"不是用户点的"拦掉
let ccVoiceNow = null // 同一时间只放一条
export function CcVoice({ v }) {
  const say = useCcSay()
  const [url, setUrl] = useState(v.localUrl || (v.path && ccImageCache.get(v.path)) || null)
  const [state, setState] = useState('idle') // idle | playing | gone
  const [progress, setProgress] = useState(0)
  const audioRef = useRef(null)
  useEffect(() => {
    if (url || !v.path) return
    let alive = true
    fetchCcImage(v.path).then(u => { if (alive) setUrl(u) }).catch(err => { if (alive && err.message === 'HTTP 404') setState('gone') })
    return () => { alive = false }
  }, [v.path, url])
  useEffect(() => () => audioRef.current?.pause(), [])
  const toggle = () => {
    if (!url || state === 'gone') return
    const a = audioRef.current || (audioRef.current = new Audio(url))
    if (!a.paused) { a.pause(); return }
    if (ccVoiceNow && ccVoiceNow !== a) ccVoiceNow.pause()
    ccVoiceNow = a
    a.ontimeupdate = () => {
      const total = isFinite(a.duration) && a.duration > 0 ? a.duration : v.duration
      setProgress(total ? Math.min(a.currentTime / total, 1) : 0)
    }
    a.onplay = () => setState('playing')
    a.onpause = () => setState(s => s === 'gone' ? s : 'idle')
    a.onended = () => { setProgress(0); a.currentTime = 0 }
    a.play().catch(() => setState('idle'))
  }
  const dots = useMemo(() => {
    let h = 0
    for (const c of v.path || v.localUrl || '') h = (h * 31 + c.charCodeAt(0)) >>> 0
    const n = Math.max(6, Math.min(24, Math.round(4 + (v.duration || 2) * 1.5)))
    return Array.from({ length: n }, (_, i) => 4 + ((h >>> (i % 24)) + i * 7) % 11)
  }, [v.path, v.localUrl, v.duration])
  const lit = state === 'playing' || progress > 0 ? Math.round(progress * dots.length) : 0
  const rel = Object.entries(v.relative || {}).map(([k, d]) => `${k}${d}`).join('、')
  return (
    <div className="cc-voice">
      <div className={`cc-voice-bar${state === 'gone' ? ' gone' : ''}${!url ? ' loading' : ''}`} onClick={toggle} role="button" aria-label={state === 'playing' ? say('暂停', 'Pause') : say('播放语音', 'Play voice')}>
        <span className="cc-voice-play">{state === 'playing' ? CC_PAUSE_ICON : CC_PLAY_ICON}</span>
        <span className="cc-voice-wave">{dots.map((h, i) => <i key={i} className={i < lit ? 'on' : ''} style={{ height: h }} />)}</span>
        <span className="cc-voice-dur">{state === 'gone' ? say('已过期', 'Expired') : v.duration ? `${Math.max(1, Math.round(v.duration))}"` : ''}</span>
      </div>
      {v.listening
        ? <div className="cc-voice-text cc-voice-dim">{say('正在听…', 'Listening…')}</div>
        : v.text && <div className="cc-voice-text">{v.text}</div>}
      {!v.listening && v.emotion && <div className="cc-voice-tone" title={v.hint || ''}>{v.emotion}{rel ? ` · ${rel}` : v.learning ? say(' · 还在认识你的声音', ' · still learning your voice') : ''}</div>}
    </div>
  )
}

export function getCcLast() {
  try { return JSON.parse(localStorage.getItem('cc_last') || 'null') } catch { return null }
}
function setCcLastStorage(m) {
  try { localStorage.setItem('cc_last', JSON.stringify({ text: m.text || (m.images?.length ? '[图片]' : m.files?.length ? '[文件]' : m.voices?.length ? '[语音]' : ''), time: m.time })) } catch {}
}
// 最近三十轮存在本机：进聊天页先直接画出来，再拉 /history 对一遍（以服务器为准）。
// 存的是 ccFromServer 之后的样子，格式改了就换 key（_v2…），旧的自然作废
export const CC_CACHE_KEY = 'cc_history_v1'
const CC_CACHE_TURNS = 30 // 按她发的消息数轮：往回数到她第三十条为止（10/11~18 平均一轮 3.6 条，30 轮约 100 条、30KB）
const CC_CACHE_MAX = 100 // 不超过 bridge /history 一次最多给的条数：打开时一次拉回来就能把缓存整段对完
function getCcCache() {
  try {
    const v = JSON.parse(localStorage.getItem(CC_CACHE_KEY))
    return Array.isArray(v) ? v.filter(m => m && typeof m.key === 'string' && m.time).sort(ccOrder) : []
  } catch { return [] }
}
function setCcCacheStorage(history) {
  let start = history.length, users = 0
  while (start > 0 && history.length - start < CC_CACHE_MAX) {
    if (history[start - 1].role === 'user' && ++users > CC_CACHE_TURNS) break
    start--
  }
  // 从她的一条开始存，开头不留半轮（只有他的回复、没有她那条）
  const firstUser = history.findIndex((m, i) => i >= start && m.role === 'user')
  if (firstUser > start) start = firstUser
  // live（正在浮现）不存，不然每次打开都重播一遍
  const out = history.slice(start).map(({ live: _live, ...m }) => m)
  try { localStorage.setItem(CC_CACHE_KEY, JSON.stringify(out)) } catch {}
}

export function CCChatPage({ onBack, onMenu, jumpTo, slideIn, onUnder }) {
  const say = useCcSay()
  // App 没解锁根本不会渲染到这里；口令失效时 apiFetch 收到 401 会让整个 App 回锁屏
  const passcode = getPasscode()
  // 服务器上的记录（双方），按时间；先用本机缓存的最近十轮垫着（从搜索跳过来的不垫，等那一段拉回来）
  const [history, setHistory] = useState(() => jumpTo ? [] : getCcCache())
  const [temp, setTemp] = useState([]) // 发送中/发送失败的本地消息
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState('connecting')
  // 等沐回复：waitSince 是开始等的时间；超过 CC_STUCK_MS 还没回就 stuck（三个点停下、提示卡住，但还在轮询）
  const [waitSince, setWaitSince] = useState(null)
  const [stuck, setStuck] = useState(false)
  const waiting = waitSince !== null && !stuck
  const startWaiting = () => { setWaitSince(Date.now()); setStuck(false) }
  const stopWaiting = useCallback(() => { setWaitSince(null); setStuck(false) }, [])
  // bridge 推的"正在输入"：{ on, reason }；null = 还没收到（旧 bridge 不推），只靠上面本地的 waiting
  // 亮着就显示三个点；它说灭了：这一轮结束（[SILENT] 收尾也算）就停止等待，3 分钟没动静（timeout）就提示卡住
  const [serverTyping, setServerTyping] = useState(null)
  const onTyping = useCallback((ev) => {
    // at：这次开始"正在输入"的时刻，用 bridge 给的 since（和他每段话的时间是同一个钟），刷新后也对得上
    const since = Date.parse(ev.since)
    setServerTyping(prev => ({ on: !!ev.on, reason: ev.reason || null, at: ev.on ? (Number.isFinite(since) ? since : prev?.on ? prev.at : Date.now()) : null }))
    if (ev.on) return
    if (ev.reason === 'timeout') { setWaitSince(null); setStuck(true) } else stopWaiting()
  }, [stopWaiting])
  const typingNow = waiting || !!serverTyping?.on
  // bridge 推的"正在压缩"：压缩期间她发的消息 bridge 先攒着，压完再交给他；这段时间不算他卡住
  const [compacting, setCompacting] = useState(false)
  // 上下文进度条、额度几点恢复：他每回完一轮（正在输入灭了）、压缩开始/结束时重拉
  // 回复方式（/api/cc/brain）：{ supported, target, model, group, option, family }；null = 还没拉到。顶上状态行用；切换在 ⋮ → 回复方式
  const [brain, setBrain] = useState(null)
  // 从"查找聊天记录"点回来（jumpTo）：先只拉那条前后各 30 条，和最新的接不上（detached）；
  // 往下翻接着拉更新的，翻到最新就接回去。这期间新来的消息先不接（中间会空一截），只在右下角箭头上记个数
  const [detached, setDetached] = useState(!!jumpTo)
  const detachedRef = useRef(!!jumpTo)
  const [hasNewer, setHasNewer] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const countedRef = useRef(new Set()) // 箭头上已经数过的（SSE 和轮询可能送来同一条）
  const [flashKey, setFlashKey] = useState(null) // 跳过去的那条闪一下
  const [farFromBottom, setFarFromBottom] = useState(false) // 离底部超过一屏：显示向下箭头
  const usageBrief = useCcUsageBrief(apiFetch, `${!!serverTyping?.on}-${compacting}`)
  const onCompacting = useCallback((ev) => {
    setCompacting(!!ev.on)
    if (!ev.on) setStuck(s => { if (s) setWaitSince(Date.now()); return false })
  }, [])
  const [editingKey, setEditingKey] = useState(null) // 正在原地改的那条
  const [calledAgain, setCalledAgain] = useState(() => new Set()) // 点过"再叫他一下"的 reply_failed 事件
  const [input, setInput] = useState(() => getDraft(CC_SESSION.id)) // 没发出去的字留作草稿，下次进来还在
  const [pending, setPending] = useState([]) // 待发送的图 { key, kind: 'image', blob, previewUrl } 和文件 { key, kind: 'file', file }
  const [fileTypes, setFileTypes] = useState(null) // /api/cc/file-types：{ max_bytes, max_items, types: [{ ext }] }
  const [notice, setNotice] = useState('') // 选文件时的提示（超数量、超大小、类型不支持）
  const [lightbox, setLightbox] = useState(null) // { items, index }：点开的那组图和从第几张开始
  const [attachOpen, setAttachOpen] = useState(false) // "+" 展开：照片 / 文件
  const [emojiOpen, setEmojiOpen] = useState(false) // 表情包面板：表情包还在做，先是个空面板
  const textareaRef = useRef(null)
  // 按住说话、语音 / 键盘模式（Composer.jsx）；sendVoice 在下面，用的时候才取
  const rec = useVoiceRecorder({ passcode, textareaRef, onVoice: (blob, duration) => sendVoice(blob, duration), onNotice: setNotice })
  const messagesEndRef = useRef(null)
  const listRef = useRef(null)
  const scrollModeRef = useRef('bottom') // bottom：滚到底；keep：往上加载旧消息，位置交给 olderAnchorRef；stay：不动
  const olderAnchorRef = useRef(null) // 往上加载前屏幕上那条消息：{ mid, top }，插进去之后按它补位
  const settlingOlderRef = useRef(false) // 刚补完位、下一帧复核前：这期间的滚动事件不触发再往上加载
  const voice = useVoicePlayer()
  const { fetchDurationEstimate } = voice
  const [transcripts, setTranscripts] = useState({})

  const roomRef = useRef(null)
  const lockOut = lockApp

  useEffect(() => { setDraftStorage(CC_SESSION.id, input) }, [input])
  // 没发出去的图和文件也留作草稿（IndexedDB）：进来先读回来，读完之后每次变动都存一份
  const draftLoadedRef = useRef(false)
  useEffect(() => {
    let alive = true
    loadDraftFiles(CC_SESSION.id).then(saved => {
      if (!alive) return
      draftLoadedRef.current = true
      if (!saved.length) return
      const back = saved.map(p => p.kind === 'image' ? { ...p, previewUrl: URL.createObjectURL(p.blob) } : p)
      setPending(prev => [...back, ...prev.filter(p => !back.some(b => b.key === p.key))])
    })
    return () => { alive = false }
  }, [])
  useEffect(() => { if (draftLoadedRef.current) saveDraftFiles(CC_SESSION.id, pending) }, [pending])
  useLayoutEffect(() => { const ta = textareaRef.current; if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' } }, [input, passcode, rec.voiceMode])

  // 按 id 合并进历史（SSE 推来的、轮询拉到的、翻页拉到的可能重复）；没有新消息就什么都不动，轮询才不会每次都触发滚动
  // 同一个 id 更正过（edited_at 更新）的新版本要盖掉旧的；只是更正旧消息时不滚动
  const knownRef = useRef(null) // key → edited_at（没改过是 ''）；缓存里的算已知
  if (knownRef.current === null) knownRef.current = new Map(history.map(m => [m.key, m.editedAt || '']))
  const mergeHistory = useCallback((incoming, mode) => {
    if (detachedRef.current && mode === 'bottom') {
      // 正在看搜出来的那一段：手上这段里的照常更新，新来的只在箭头上记个数
      const later = incoming.filter(m => !knownRef.current.has(m.key) && !countedRef.current.has(m.key) && (m.role === 'user' || m.role === 'assistant'))
      later.forEach(m => countedRef.current.add(m.key))
      if (later.length) setNewCount(c => c + later.length)
      incoming = incoming.filter(m => knownRef.current.has(m.key))
    }
    const fresh = incoming.filter(m => { const v = knownRef.current.get(m.key); return v === undefined || (m.editedAt || '') > v })
    if (!fresh.length) return
    const onlyUpdates = fresh.every(m => knownRef.current.has(m.key))
    fresh.forEach(m => knownRef.current.set(m.key, m.editedAt || ''))
    scrollModeRef.current = onlyUpdates ? 'stay' : mode
    setHistory(prev => {
      const byKey = new Map(prev.map(m => [m.key, m]))
      fresh.forEach(m => byKey.set(m.key, m))
      return [...byKey.values()].sort(ccOrder)
    })
    fresh.forEach(m => { if (m.role === 'assistant') estimateVoiceDurations(m.key, m.text, fetchDurationEstimate) })
    // 沐回了，或者 bridge 说他这轮没回上来，都不用再转三个点；她那条被更正不算
    if (fresh.some(m => m.role === 'assistant' || m.kind === 'reply_failed')) stopWaiting()
  }, [fetchDurationEstimate, stopWaiting])

  // params：before（往上翻）、around（搜索跳过来）、after（往下翻）
  const fetchHistory = useCallback(async (before, limit = CC_PAGE, params = {}) => {
    const qs = new URLSearchParams({ limit: String(limit), system: '1', tools: '1', ...params })
    if (before) qs.set('before', before)
    const res = await apiFetch(`/api/cc/history?${qs}`)
    if (res.status === 401) { lockOut(); throw new Error('unauthorized') }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
    return res.json()
  }, [passcode])

  // 补拉一次最近的历史（轮询兜底、回到前台、SSE 重连后都用它），按 id 去重。
  // 切到后台时 SSE 会断，这段时间她在官方 App 里聊的、他回的都只能靠这里补：一次拉 CC_CACHE_MAX 条，
  // 这一页最早那条（同一时刻的几条）手上一条都没有，说明中间断了一截（10/19 早上 35 分钟来了 43 条，以前只拉 30 条，前面十几条就丢了）。
  // 补不上就把手上更早的扔掉，往上翻从这一页最早一条接着拉，不留洞。手上有就是连着的，照常合并
  const pollOnce = useCallback(async () => {
    if (detachedRef.current) return // 看搜出来的那一段时不补拉最新的，回到最新时再补
    try {
      const data = await fetchHistory(undefined, CC_CACHE_MAX)
      const incoming = (data.messages || []).map(ccFromServer)
      const times = incoming.map(m => Date.parse(m.time)).filter(Number.isFinite)
      if (data.has_more && times.length) {
        const from = Math.min(...times)
        const keep = new Set(incoming.map(m => m.key))
        const to = Math.max(...times)
        const head = new Set(incoming.filter(m => Date.parse(m.time) === from).map(m => m.key))
        // 比这页最新一条还晚的（等这页回来时 SSE 刚推来的）留着
        const drop = m => !keep.has(m.key) && !(Date.parse(m.time) > to)
        setHistory(prev => {
          if (!prev.length || prev.some(m => head.has(m.key))) return prev
          prev.filter(drop).forEach(m => knownRef.current.delete(m.key))
          return prev.filter(m => !drop(m))
        })
        setHasMore(true) // 服务器上还有更早的：往上翻能接着拉（没断档时多拉一次空页也无妨）
      }
      mergeHistory(incoming, 'bottom')
    } catch {}
  }, [fetchHistory, mergeHistory])
  const pollOnceRef = useRef(pollOnce)
  useEffect(() => { pollOnceRef.current = pollOnce }, [pollOnce])

  // 用 fetch 读 SSE（EventSource 不能带 Authorization 头）。SSE 只推新消息，旧的走 /history。
  // 手机锁屏/切后台时连接会悄悄死掉（读不到数据也不报错），所以：
  // - 15 秒一次的心跳超过 40 秒没收到任何字节，就当连接已死，主动断开重连
  // - 回到前台（visibilitychange）、网络恢复（online）时立刻重连并补拉一次历史
  useEffect(() => {
    if (!passcode) return
    let cancelled = false
    let retryTimer = null
    let attempt = null // 当前这次连接的 AbortController；被新连接顶替时旧的循环不再重试
    let lastByte = Date.now()

    const handleLine = (line) => {
      line = line.trim()
      if (!line || line.startsWith(':') || line.startsWith('event:') || line.startsWith('id:') || line.startsWith('retry:')) return
      if (line.startsWith('data:')) line = line.slice(5).trim()
      let ev
      try { ev = JSON.parse(line) } catch { return }
      if (ev && ev.type === 'typing') return onTyping(ev)
      if (ev && ev.type === 'compacting') return onCompacting(ev)
      if (!ev || !ev.id || (typeof ev.text !== 'string' && ev.role !== 'system')) return
      const m = ccFromServer(ev)
      // 实时新到的他的话才浮现；补上的、她自己的、切到后台时到的都直接显示
      if (m.role === 'assistant' && !m.late && document.visibilityState === 'visible') m.live = true
      mergeHistory([m], 'bottom')
    }

    const connect = async () => {
      if (cancelled) return
      clearTimeout(retryTimer)
      if (attempt) attempt.abort()
      const ctl = new AbortController()
      attempt = ctl
      lastByte = Date.now()
      setStatus('connecting')
      try {
        const res = await apiFetch(`/api/cc/events`, { signal: ctl.signal })
        if (res.status === 401) { cancelled = true; lockOut(); return }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        lastByte = Date.now()
        setStatus('live')
        pollOnceRef.current() // 每次连上都补拉一次：SSE 重连不回放，断线期间错过的消息只能从历史里补
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          lastByte = Date.now()
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop()
          lines.forEach(handleLine)
        }
      } catch {}
      if (cancelled || ctl !== attempt) return
      setStatus('offline')
      retryTimer = setTimeout(connect, 3000)
    }

    const wake = () => { connect(); pollOnceRef.current() }
    const onVisible = () => { if (document.visibilityState === 'visible') wake() }
    const watchdog = setInterval(() => {
      if (attempt && !attempt.signal.aborted && Date.now() - lastByte > 40000) attempt.abort()
    }, 10000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', wake)
    window.addEventListener('pageshow', onVisible)

    connect()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(watchdog)
      if (attempt) attempt.abort()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', wake)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [passcode, mergeHistory, onTyping, onCompacting])

  // SSE 没连上（连接中/断线）时每 5 秒轮询一次历史，连上后停止
  useEffect(() => {
    if (!passcode || status === 'live') return
    const iv = setInterval(() => pollOnceRef.current(), 5000)
    return () => clearInterval(iv)
  }, [passcode, status])

  // 发送后 60 秒内 SSE 还没送来回复，就算 SSE 显示连着也开始每 5 秒轮询，直到回复出现（显示"卡住了"之后也继续）
  useEffect(() => {
    if (!passcode || waitSince === null) return
    let iv = null
    const t = setTimeout(() => {
      pollOnceRef.current()
      iv = setInterval(() => pollOnceRef.current(), 5000)
    }, 60000)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [passcode, waitSince])

  // 兜底超时：等了 CC_STUCK_MS 还没动静就停三个点；回复后来又到了，stopWaiting 会把提示一起撤掉
  useEffect(() => {
    if (waitSince === null) return
    const t = setTimeout(() => setStuck(true), Math.max(waitSince + CC_STUCK_MS - Date.now(), 0))
    return () => clearTimeout(t)
  }, [waitSince])

  // 打开会话：拉最近 CC_CACHE_MAX 条，和缓存整段对账，以服务器为准：
  // 缓存里有、这页里没有的都去掉——被 bridge 删掉的，和比这页最早一条还早的（关着的时候来了很多新话，
  // 缓存和这页之间可能断了一截；去掉以后往上翻从这页最早一条接着拉，就不会漏）。
  // 比这页最新一条还晚的不动（等这页回来的时候 SSE 可能已经推来了新的）
  const openLatest = useCallback(async (alive = () => true) => {
    try {
      const data = await fetchHistory(undefined, CC_CACHE_MAX)
      if (!alive()) return
      const incoming = (data.messages || []).map(ccFromServer)
      const times = incoming.map(m => Date.parse(m.time)).filter(Number.isFinite)
      if (times.length) {
        const to = Math.max(...times)
        const keep = new Set(incoming.map(m => m.key))
        const stale = m => !keep.has(m.key) && !(Date.parse(m.time) > to)
        setHistory(prev => {
          if (!prev.some(stale)) return prev
          prev.filter(stale).forEach(m => knownRef.current.delete(m.key))
          return prev.filter(m => !stale(m))
        })
      }
      mergeHistory(incoming, 'bottom')
      setHasMore(!!data.has_more)
    } catch {}
  }, [fetchHistory, mergeHistory])

  // 搜索跳过来：拉那条前后各 30 条换掉手上的，滚到那条让它闪一下。那条没了（404）就照常打开最新的
  const [jumping, setJumping] = useState(!!jumpTo)
  const attach = useCallback(() => {
    detachedRef.current = false
    setDetached(false)
    setHasNewer(false)
    setNewCount(0)
    countedRef.current.clear()
  }, [])
  // 换回最新的：先用本机缓存垫着，再对一遍服务器
  const showLatest = useCallback((alive) => {
    attach()
    setFlashKey(null)
    const cache = getCcCache()
    knownRef.current = new Map(cache.map(m => [m.key, m.editedAt || '']))
    scrollModeRef.current = 'bottom'
    setHistory(cache)
    openLatest(alive)
  }, [attach, openLatest])
  const openAround = useCallback(async (id, alive) => {
    try {
      const data = await fetchHistory(undefined, 60, { around: id })
      if (!alive()) return
      const incoming = (data.messages || []).map(ccFromServer).sort(ccOrder)
      knownRef.current = new Map(incoming.map(m => [m.key, m.editedAt || '']))
      incoming.forEach(m => { if (m.role === 'assistant') estimateVoiceDurations(m.key, m.text, fetchDurationEstimate) })
      scrollModeRef.current = 'jump'
      setFlashKey(id)
      setHistory(incoming)
      setHasMore(!!data.has_more)
      if (data.has_newer) setHasNewer(true)
      else attach() // 这一段就到最新了
    } catch (err) {
      if (!alive()) return
      if (err.status === 404) setNotice(say('那条消息找不到了', "That message can't be found"))
      showLatest(alive)
    }
    setJumping(false)
  }, [fetchHistory, fetchDurationEstimate, attach, showLatest])

  useEffect(() => {
    if (!passcode) return
    let alive = true
    if (jumpTo) openAround(jumpTo.id, () => alive)
    else openLatest(() => alive)
    return () => { alive = false }
  }, [passcode]) // eslint-disable-line react-hooks/exhaustive-deps -- 只在打开时跑一次；jumpTo 每次跳都会重新挂载这一页

  // 往下翻（只在 detached 时）：从手上最晚那条接着拉更新的，到头就接回最新
  const loadNewer = async () => {
    if (loadingNewer || !detachedRef.current || !hasNewer || !history.length) return
    setLoadingNewer(true)
    try {
      const last = history.reduce((a, m) => (Date.parse(m.time) > Date.parse(a.time) ? m : a))
      const data = await fetchHistory(undefined, CC_PAGE, { after: last.time })
      mergeHistory((data.messages || []).map(ccFromServer), 'stay')
      if (!data.has_newer) { attach(); pollOnceRef.current() }
    } catch {}
    setLoadingNewer(false)
  }

  // 向下箭头：看搜出来的那一段时换回最新的；平时平滑滚到底
  const goLatest = () => {
    if (detachedRef.current) showLatest()
    else messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }

  // 英文版（Vesper）点输入框、收起键盘时都回到最底下；键盘起落要一会儿，高度变完再补两次
  // 键盘、表情包面板、加号面板三选一。点开面板先收起键盘，面板占键盘的位置（Vesper 里面板高度 = 上次键盘的高度）；
  // 点输入框弹键盘时，面板等键盘真的升上来那一下再收，输入框一直在同一个高度，不会先掉下去再被顶上来
  const panelOpen = emojiOpen || attachOpen
  const closePanels = () => { setEmojiOpen(false); setAttachOpen(false) }
  const togglePanel = (which) => {
    textareaRef.current?.blur()
    setEmojiOpen(which === 'emoji' ? o => !o : false)
    setAttachOpen(which === 'attach' ? o => !o : false)
  }
  const onInputFocus = () => {
    if (Date.now() - swipeBlurAt.current < 600) { // 在 focus 事件里同步 blur 有的浏览器不认，下一帧再补一次
      const ta = textareaRef.current
      ta?.blur(); requestAnimationFrame(() => { if (document.activeElement === ta) ta.blur() })
      return
    }
    if (panelOpen) {
      const vv = window.visualViewport
      const h0 = vv?.height ?? 0
      let done = false
      const finish = () => { if (done) return; done = true; vv?.removeEventListener('resize', onVv); closePanels() }
      const onVv = () => { if (vv.height < h0 - 100) finish() }
      vv?.addEventListener('resize', onVv)
      setTimeout(finish, 600) // 外接键盘、电脑上不会有这一下
    }
    stickBottom()
  }
  // 点输入框不让 iOS 去滚页面：Vesper 里由 usePreventPageScroll 统一接管（自己 focus({ preventScroll })、光标放到末尾）
  usePreventPageScroll(roomRef)
  // 在消息列表上手指往下拖（像 iOS 原生的拖动收键盘）：和点空白处一样，收起键盘和面板。
  // 手指一开始往上推（往新消息那边滚）就不算；只认一根手指、竖着的拖
  const listSwipe = useRef(null)
  const swipeBlurAt = useRef(0) // 下拖刚收了键盘：这之后一小会儿里冒出来的 focus 不是她点的（列表在动、iOS 自己聚焦回去），再收一次，键盘不弹回
  const onListTouchStart = (e) => { const t = e.touches[0]; listSwipe.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, done: false } : null }
  const onListTouchMove = (e) => {
    const sw = listSwipe.current, t = e.touches[0]
    if (!sw || sw.done || !t) return
    const dx = t.clientX - sw.x, dy = t.clientY - sw.y
    if (dy < -10 || e.touches.length > 1) { sw.done = true; return }
    // 往下 10px 就收：不 preventDefault，列表照常滚、松手后的惯性也不断；一次拖动只收一次
    if (dy > 10 && dy > Math.abs(dx) * 1.5) {
      sw.done = true
      if (document.activeElement === textareaRef.current) { swipeBlurAt.current = Date.now(); textareaRef.current.blur() }
      if (panelOpen) closePanels()
    }
  }
  // 侧滑返回：大图、录音、改消息、任何弹窗或底部面板开着时不许；键盘、表情面板、加号面板开着可以，退之前先收起
  useChatSwipeBack(roomRef, {
    onBack,
    blocked: () => !!lightbox || !!rec.recording || !!editingKey || !!document.querySelector('.modal-overlay,.v-modal,.v-bsheet,.image-lightbox-overlay'),
    beforeBack: () => { textareaRef.current?.blur(); closePanels() },
    onUnder, slideIn,
  })
  // Vesper 要知道面板开着：和键盘一样收起底部 tab 栏
  useEffect(() => { window.dispatchEvent(new CustomEvent('cc-panel', { detail: panelOpen })) }, [panelOpen])
  useEffect(() => () => window.dispatchEvent(new CustomEvent('cc-panel', { detail: false })), [])
  // 消息列表贴底（useStickToBottom.js）；stickBottom：英文版（Vesper）点输入框、收起键盘时回到最底下
  const stickBottom = useStickToBottom(listRef, detachedRef, say(false, true))

  // 缓存里垫上的他的话：语音段的时长也要估（mergeHistory 只估新来的）
  useEffect(() => {
    history.forEach(m => { if (m.role === 'assistant') estimateVoiceDurations(m.key, m.text, fetchDurationEstimate) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (!detachedRef.current) setCcCacheStorage(history) }, [history, detached]) // 搜出来的那一段不进缓存

  // 往上滑到顶加载更早的 30 条，保持当前位置不跳（坑见 docs/skin-checklist.md 第 18b 条）
  // 锚点在数据回来、插进去之前那一刻记（不是开始加载时）：等请求的时候手指和惯性还在滑，那段距离也要算上。
  // 插入、顶上 Loading 那格拿掉、hasMore 变化都在同一次渲染里，下面的 layout effect 在画出来之前按锚点补回去
  const loadOlder = async () => {
    if (loadingMore || !hasMore || !history.length) return
    setLoadingMore(true)
    let data = null
    try { data = await fetchHistory(history[0].time) } catch {}
    olderAnchorRef.current = ccListAnchor(listRef.current)
    if (data) {
      mergeHistory((data.messages || []).map(ccFromServer), 'keep')
      setHasMore(!!data.has_more)
    }
    setLoadingMore(false)
  }

  // 服务器那条已经到了（SSE 往往比 /api/cc/send 的回应先到）：同一个 client_id 的临时消息就不再显示，不然会闪一下两条
  const messages = useMemo(() => {
    const arrived = new Set(history.map(m => m.clientId).filter(Boolean))
    return [...history.filter(m => m.role !== 'system' || ccIsTool(m)), ...temp.filter(m => !arrived.has(m.clientId))].sort(ccOrder)
  }, [history, temp])
  const rows = useMemo(() => ccRows(messages), [messages])
  // 点开聊天里的一张图：聊天里所有的图按顺序排成一组，左右滑着看
  const openChatImage = (img) => {
    const items = rows.flatMap(r => r.m?.images || []).map(im => ({ path: im.localUrl ? null : im.path, localUrl: im.localUrl, lb: im.path || im.localUrl }))
    const all = rows.flatMap(r => r.m?.images || [])
    setLightbox({ items, index: Math.max(all.indexOf(img), 0) })
  }
  const openPendingImage = (p) => {
    const imgs = pending.filter(x => x.kind === 'image')
    setLightbox({ items: imgs.map(x => ({ localUrl: x.previewUrl, lb: x.previewUrl })), index: Math.max(imgs.indexOf(p), 0) })
  }
  // 正在说的那一块：还亮着"正在输入"，而且列表最后一行就是他的一块（她发完还没回时最后一行是她的，三个点单独一行）
  // 再加一道保险：这块的第一段得是"正在输入"亮起之后才到的，免得把上一轮已经说完的那块当成正在说
  const lastRow = rows[rows.length - 1]
  const typingAt = serverTyping?.on ? serverTyping.at : waitSince ?? Infinity
  const liveTurnKey = typingNow && !detached && lastRow?.turn && lastRow.items.some(it => it.live || new Date(it.time) >= typingAt - 2000) ? lastRow.key : null
  useEffect(() => { const last = messages.findLast(m => !ccIsTool(m)); if (last && !detachedRef.current) setCcLastStorage(last) }, [messages, detached])
  const failures = useMemo(() => ccUnresolvedFailures(history), [history])
  const lastUserKey = useMemo(() => messages.findLast(m => m.role === 'user')?.key, [messages])
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (scrollModeRef.current === 'keep') scrollModeRef.current = 'stay' // 补位在下面；之后的更新（他回话、三个点）不再动位置
    else if (scrollModeRef.current === 'jump') {
      // 搜索跳过来：那条放到中间，之后的更新不再动位置
      const target = flashKey && el.querySelector(`[data-mids~="${CSS.escape(flashKey)}"]`)
      if (target) target.scrollIntoView({ block: 'center' })
      if (messages.length) scrollModeRef.current = 'stay'
    } else if (scrollModeRef.current !== 'stay') messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, typingNow, flashKey])
  // 往上加载完：锚点那条回到原来离列表顶的距离。不靠 overflow-anchor（Safari 不支持），每次渲染完、画出来之前对一下
  useLayoutEffect(() => {
    const a = olderAnchorRef.current, el = listRef.current
    if (!a || !el) return
    olderAnchorRef.current = null
    const row = a.mid && el.querySelector(`[data-mids~="${CSS.escape(a.mid)}"]`)
    if (!row) return
    const top = () => row.getBoundingClientRect().top - el.getBoundingClientRect().top
    const before = el.scrollTop, d = top() - a.top
    // 甩到顶时 iOS 在回弹（scrollTop 是负的）：这时改 scrollTop，下一帧会被回弹动画盖回负数，屏幕闪到刚插进来的最老那几条，
    // 那一帧 scrollTop < 80 还会再拉一页（真机读数：drift 0/7571/0）。先 overflow hidden 把回弹停掉再设，下一帧放开。
    // 停掉回弹那一下 scrollTop 不再是负的，所以按 before + d 直接设绝对值，不用 +=
    const bounce = before < 0
    settlingOlderRef.current = true
    if (bounce) el.style.overflowY = 'hidden'
    if (d) el.scrollTop = before + d
    const now = Math.round(top() - a.top), after = Math.round(el.scrollTop)
    requestAnimationFrame(() => {
      if (bounce) el.style.overflowY = ''
      // 复核一次：还被别的（惯性滚动）吃掉了就再补一次
      const f1 = top() - a.top
      if (Math.abs(f1) > 2) el.scrollTop += f1
      settlingOlderRef.current = false
      // 键盘调试读数开着时记一行：补完当帧、下一帧（复核前）、300ms 后锚点还差几 px
      if (kbDebugOn()) setTimeout(() => kbLog(`older: moved ${Math.round(d)}px · scrollTop ${Math.round(before)}→${after}${bounce ? ' · bounce' : ''}${Math.abs(f1) > 2 ? ' · refix' : ''} · drift ${now}/${Math.round(f1)}/${Math.round(top() - a.top)}px`), 300)
    })
  })
  useEffect(() => {
    if (!flashKey) return
    const t = setTimeout(() => setFlashKey(null), 2400)
    return () => clearTimeout(t)
  }, [flashKey])
  const onListScroll = (e) => {
    const el = e.currentTarget
    const toBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (el.scrollTop < 80 && !settlingOlderRef.current) loadOlder()
    if (toBottom < 200) loadNewer()
    setFarFromBottom(toBottom > el.clientHeight)
  }

  // 回复方式：进来拉一次（顶上状态行显示是 CC 还是哪个模型）；在 ⋮ → 回复方式里改完回来会重新挂载这一页，再拉一次
  useEffect(() => {
    if (!passcode) return
    let alive = true
    fetchCcBrain().then(b => { if (alive) setBrain(b) }).catch(() => {})
    return () => { alive = false }
  }, [passcode])

  // 文件白名单：拿不到就不让选文件，发图不受影响
  useEffect(() => {
    if (!passcode) return
    let alive = true
    apiFetch(`/api/cc/file-types`).then(r => r.ok ? r.json() : null).then(t => { if (alive && t?.types) setFileTypes(t) }).catch(() => {})
    return () => { alive = false }
  }, [passcode])
  const maxItems = fileTypes?.max_items || CC_MAX_ITEMS_FALLBACK
  const maxBytes = fileTypes?.max_bytes || 0
  const allowedExts = useMemo(() => new Set((fileTypes?.types || []).map(t => t.ext)), [fileTypes])
  const fileAccept = useMemo(() => [...allowedExts].map(e => `.${e}`).join(','), [allowedExts])
  const full = pending.length >= maxItems

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(t)
  }, [notice])
  // 一次合计最多 maxItems 个：多选超了只收前面的，并提示
  const takeRoom = (list) => {
    const room = Math.max(maxItems - pending.length, 0)
    if (list.length > room) setNotice(say(`图片和文件一次最多 ${maxItems} 个，多出的 ${list.length - room} 个没加上`, `Up to ${maxItems} photos and files at a time — ${list.length - room} left out`))
    return list.slice(0, room)
  }

  const handleImageSelect = async (e) => {
    const files = takeRoom(Array.from(e.target.files || []))
    e.target.value = ''
    const added = []
    for (const file of files) {
      try {
        const blob = await compressImage(file, 1200, 0.8)
        added.push({ key: `img-${Date.now()}-${added.length}`, kind: 'image', blob, previewUrl: URL.createObjectURL(blob) })
      } catch {}
    }
    setPending(prev => [...prev, ...added].slice(0, maxItems))
  }
  // 选的时候就把类型、大小、数量卡住，不等上传失败
  const handleFileSelect = (e) => {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    const problems = []
    const ok = picked.filter(f => {
      if (!allowedExts.has(ccExt(f.name))) { problems.push(say(`${f.name}：沐读不了这种文件`, `${f.name}: Soren can't read this type`)); return false }
      if (f.size > maxBytes) { problems.push(say(`${f.name}：${fmtFileSize(f.size)}，超过 ${Math.round(maxBytes / 1024 / 1024)}MB`, `${f.name}: ${fmtFileSize(f.size)}, over ${Math.round(maxBytes / 1024 / 1024)}MB`)); return false }
      if (!f.size) { problems.push(say(`${f.name}：是空文件`, `${f.name}: empty file`)); return false }
      return true
    })
    const added = takeRoom(ok).map((file, i) => ({ key: `file-${Date.now()}-${i}`, kind: 'file', file }))
    if (problems.length) setNotice(problems.join('；'))
    setPending(prev => [...prev, ...added].slice(0, maxItems))
  }
  const removePending = (key) => setPending(prev => {
    const gone = prev.find(p => p.key === key)
    if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
    return prev.filter(p => p.key !== key)
  })

  // 临时消息自己带着原始附件（items）和 client_id，失败了点一下能原样重发；已经传上去的附件记下 path，重发时不再传
  const uploadedRef = useRef(new Map()) // 附件 key → 已上传的 path
  const sendMessage = () => {
    const text = input.trim()
    if (!text && !pending.length) return
    const items = pending.map(p => p.kind === 'file' ? { ...p, localUrl: URL.createObjectURL(p.file) } : p)
    const imgs = items.filter(p => p.kind === 'image')
    const docs = items.filter(p => p.kind === 'file')
    const msg = {
      key: `me-${Date.now()}`, local: true, clientId: ccClientId(), items, role: 'user', text, time: new Date().toISOString(),
      ...(imgs.length ? { images: imgs.map(p => ({ key: p.key, localUrl: p.previewUrl })) } : {}),
      ...(docs.length ? { files: docs.map(p => ({ key: p.key, name: p.file.name, size: p.file.size, localUrl: p.localUrl })) } : {}),
    }
    if (detachedRef.current) showLatest() // 正在看搜出来的那一段：发的时候先回到最新
    scrollModeRef.current = 'bottom'
    setTemp(prev => [...prev, msg])
    setInput('')
    setPending([])
    deliver(msg)
  }
  // only：点了某一张图上的重试，只重传这一张，别的失败的不动（全传上去了才真的发出去）
  const deliver = async (msg, only) => {
    setTemp(prev => prev.map(m => m.key === msg.key ? { ...m, failed: false } : m))
    startWaiting()
    // 每张图 / 每个文件的上传状态记在临时消息的 up 上：{ pct } 正在传，{ failed } 这张没传上，null 传完了
    const setUp = (key, st) => setTemp(prev => prev.map(m => m.key === msg.key ? { ...m, up: { ...m.up, [key]: st } } : m))
    try {
      // 一个一个排队传，不并发：后端是整份读进内存再转给 VPS，一起传会把 Render 的内存顶满。
      // 一张失败了接着传后面的，最后再一起算：有没传上的就停在这儿，等点那一张重试
      const sent = []
      let firstErr = null, waiting = false
      for (const p of msg.items) {
        let path = uploadedRef.current.get(p.key)
        if (!path && only && p.key !== only && msg.up?.[p.key]?.failed) { waiting = true; continue }
        if (!path && p.kind === 'voice') {
          // 先交给 ears 听：转出来的字、语气记在附件上（重发时不用再听一遍），临时消息上马上显示
          p.heard = await listenCcVoice(p.blob, p.duration)
          setTemp(prev => prev.map(m => m.key === msg.key ? { ...m, voices: m.voices.map(v => v.key === p.key ? { ...v, ...ccVoiceView(p.heard), duration: p.duration, listening: false } : v) } : m))
          path = p.heard.path
          uploadedRef.current.set(p.key, path)
          ccImageCache.set(path, p.localUrl)
        }
        if (!path) {
          setUp(p.key, { pct: 0 })
          let last = 0
          const onProgress = f => { if (f - last >= 0.05 || f === 1) { last = f; setUp(p.key, { pct: Math.min(f, 0.95) }) } } // 到 100% 还要等后端转给 VPS，留一点等回话
          try {
            path = p.kind === 'image' ? await uploadCcImage(p.blob, onProgress) : await uploadCcFile(p.file, onProgress)
          } catch (err) {
            if (err.message === 'unauthorized') throw err
            setUp(p.key, { failed: true })
            firstErr = firstErr || err
            continue
          }
          setUp(p.key, null)
          uploadedRef.current.set(p.key, path)
          ccImageCache.set(path, p.previewUrl || p.localUrl) // 刚发的直接用本地预览，不用再向服务器取
          if (p.kind === 'image') ccImgCachePut(path, false, p.blob) // 下次打开 App 也不用下载自己发的图
        }
        sent.push({ p, path })
      }
      if (firstErr) throw firstErr
      if (waiting) { stopWaiting(); setTemp(prev => prev.map(m => m.key === msg.key ? { ...m, failed: true } : m)); return }
      const paths = sent.filter(s => s.p.kind === 'image').map(s => s.path)
      const files = sent.filter(s => s.p.kind === 'file')
      const voices = sent.filter(s => s.p.kind === 'voice')
      const body = { text: msg.text, kind: 'chat', client_id: msg.clientId, ...(paths.length ? { images: paths } : {}), ...(files.length ? { files: files.map(s => s.path) } : {}), ...(voices.length ? { voices: voices.map(s => s.path) } : {}) }
      const res = await apiFetch(`/api/cc/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (res.status === 401) throw new Error('unauthorized')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      // 发送成功：临时消息换成服务器记录（SSE 可能已经先推来了，按 id 合并不会重复）
      if (data.id) mergeHistory([{
        key: data.id, role: 'user', text: msg.text, time: data.time || msg.time, ...(Number.isSafeInteger(data.seq) ? { seq: data.seq } : {}),
        ...(paths.length ? { images: paths.map(path => ({ path })) } : {}),
        ...(files.length ? { files: files.map(s => ({ path: s.path, name: s.p.file.name, size: s.p.file.size })) } : {}),
        ...(voices.length ? { voices: voices.map(s => ({ path: s.path, ...ccVoiceView(s.p.heard || {}), duration: s.p.duration })) } : {}),
      }], 'bottom')
      msg.items.forEach(p => uploadedRef.current.delete(p.key))
      setTemp(prev => prev.filter(m => m.key !== msg.key))
    } catch (err) {
      if (err.message === 'unauthorized') lockOut()
      else if (!/^HTTP \d+$/.test(err.message)) setNotice(err.message)
      stopWaiting()
      // 语音没认出是她 / 太短：这段不算发过，直接撤掉，提示留着
      if (err.drop) discardFailed(msg)
      else setTemp(prev => prev.map(m => m.key === msg.key ? { ...m, failed: true } : m))
    }
  }

  // 按住说话录完的一段：和打字一样先放临时消息再 deliver（录音本身在 Composer.jsx 的 useVoiceRecorder）
  const sendVoice = (blob, duration) => {
    const localUrl = URL.createObjectURL(blob)
    const item = { key: `voice-${Date.now()}`, kind: 'voice', blob, duration, localUrl }
    const msg = { key: `me-${Date.now()}`, local: true, clientId: ccClientId(), items: [item], role: 'user', text: '', time: new Date().toISOString(), voices: [{ key: item.key, localUrl, duration, listening: true }] }
    if (detachedRef.current) showLatest()
    scrollModeRef.current = 'bottom'
    setTemp(prev => [...prev, msg])
    deliver(msg)
  }
  const discardFailed = (msg) => {
    msg.items.forEach(p => { uploadedRef.current.delete(p.key); URL.revokeObjectURL(p.previewUrl || p.localUrl) })
    setTemp(prev => prev.filter(m => m.key !== msg.key))
  }
  // 离开页面时，发送失败的文字、图和文件放回草稿，不会就这么丢了
  const tempRef = useRef(temp)
  useEffect(() => { tempRef.current = temp }, [temp])
  const pendingRef = useRef(pending)
  useEffect(() => { pendingRef.current = pending }, [pending])
  useEffect(() => () => {
    const failed = tempRef.current.filter(m => m.failed)
    const lost = failed.filter(m => m.text).map(m => m.text)
    if (lost.length) setDraftStorage(CC_SESSION.id, [...lost, getDraft(CC_SESSION.id)].filter(Boolean).join('\n'))
    const lostItems = failed.flatMap(m => m.items || [])
    if (lostItems.length && draftLoadedRef.current) saveDraftFiles(CC_SESSION.id, [...lostItems, ...pendingRef.current])
  }, [])

  // 沐这轮没回上来：把她那条再交给他一次（bridge 不会新增她的消息）
  const callAgain = async (msg, failure) => {
    setCalledAgain(prev => new Set(prev).add(failure.key))
    scrollModeRef.current = 'bottom'
    startWaiting()
    try {
      const res = await apiFetch(`/api/cc/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: msg.key }) })
      if (res.status === 401) return lockOut()
      if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`) // 409：他已经回了或者已经叫过了
    } catch {
      setCalledAgain(prev => { const next = new Set(prev); next.delete(failure.key); return next })
      stopWaiting()
      setNotice(say('没叫到他，等一下再试', "Couldn't reach him — try again soon"))
    }
  }

  // 更正她发过的文字；成功返回 true，编辑框收起
  const saveEdit = async (msg, text) => {
    try {
      const res = await apiFetch(`/api/cc/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: msg.key, text }) })
      if (res.status === 401) { lockOut(); return false }
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (data.message) mergeHistory([ccFromServer(data.message)], 'stay')
        setEditingKey(null)
        return true
      }
      setNotice(res.status === 404 ? say('找不到这条消息了', "That message can't be found") : say('没改成，再试一次', "Couldn't edit — try again"))
    } catch {
      setNotice(say('没改成，再试一次', "Couldn't edit — try again"))
    }
    return false
  }

  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)
  const handleKeyDown = (e) => { if (isMobile) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); sendMessage() } }
  const statusLabel = { connecting: 'Connecting…', live: ccBrainLabel(brain) || 'Claude Code', offline: 'Offline · reconnecting' }[status]

  return (
    <>
    <div className="chatroom cc-room" ref={roomRef}>
      <ChatHeader onBack={onBack} onMenu={onMenu} passcode={passcode} status={status} statusLabel={statusLabel} />

      <CcLimitedNotice brief={usageBrief} en={say(false, true)} />
      {compacting && <div className="cc-compacting" role="status" aria-label={say('正在压缩', 'Compacting')}>compacting<span className="cc-compacting-dot">.</span><span className="cc-compacting-dot">.</span><span className="cc-compacting-dot">.</span></div>}
      <div className="messages" ref={listRef} onScroll={onListScroll} onClick={closePanels} onTouchStart={onListTouchStart} onTouchMove={onListTouchMove}>
        {/* 还有更早的就一直占着这一格（高度固定），加载时只换里面的字，出现、消失都不推动下面的消息 */}
        {hasMore && messages.length > 0 && <div className="cc-older">{loadingMore ? 'Loading…' : ''}</div>}
        {messages.length === 0 && <div className="empty-state">{jumping ? 'Loading…' : passcode ? 'Start chatting' : ''}</div>}
        {rows.map(row => {
          if (row.turn) return <CcTurn key={row.key} row={row} live={liveTurnKey === row.key} flash={row.items.some(it => it.key === flashKey)} open={!!transcripts[row.key]} player={voice} onToggleTranscript={() => setTranscripts(prev => ({ ...prev, [row.key]: !prev[row.key] }))} />
          const m = row.m
          const failure = failures.get(m.key)
          const showFailure = failure && !calledAgain.has(failure.key)
          return <CcUserMsg key={m.key} m={m} flash={m.key === flashKey} failure={showFailure ? failure : null} editing={editingKey === m.key}
            stuckNote={!showFailure && stuck && !compacting && !serverTyping?.on && m.key === lastUserKey}
            onOpenImage={openChatImage} onRetry={deliver} onDiscard={discardFailed} onEdit={setEditingKey} onSaveEdit={saveEdit} onCancelEdit={() => setEditingKey(null)} onCallAgain={callAgain} />
        })}
        {loadingNewer && <div className="empty-state">Loading…</div>}
        {typingNow && !liveTurnKey && !detached && <div className="msg assistant cc-typing" aria-label={say('正在输入', 'Typing')}><span className="cc-typing-dot" /><span className="cc-typing-dot" /><span className="cc-typing-dot" /></div>}
        <div ref={messagesEndRef} />
      </div>

      {/* 向下箭头：离底部超过一屏、或者正在看搜出来的那一段时出现；那段时间新来的条数标在上面 */}
      {(farFromBottom || detached) && (
        <div className="cc-jump-wrap">
          <button className="cc-jump-btn" onClick={goLatest} aria-label={say('回到最新', 'Jump to latest')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
            {newCount > 0 && <span className="cc-jump-badge">{newCount > 99 ? '99+' : newCount}</span>}
          </button>
        </div>
      )}

      <Composer passcode={passcode} rec={rec} notice={notice} onClearNotice={() => setNotice('')}
        pending={pending} onReorderPending={setPending} onOpenPending={openPendingImage} onRemovePending={removePending}
        textareaRef={textareaRef} input={input} onInput={setInput} onKeyDown={handleKeyDown} onFocus={onInputFocus} onBlur={stickBottom} onTextTouchStart={() => { swipeBlurAt.current = 0 }}
        emojiOpen={emojiOpen} attachOpen={attachOpen} onTogglePanel={togglePanel} onCloseAttach={() => setAttachOpen(false)}
        full={full} fileAccept={fileAccept} filesReady={!!fileTypes} onPickFiles={handleFileSelect} onPickImages={handleImageSelect} onSend={sendMessage} />

      {lightbox && <ImageLightbox items={lightbox.items} index={lightbox.index} onClose={() => setLightbox(null)} />}

    </div>
    </>
  )
}
