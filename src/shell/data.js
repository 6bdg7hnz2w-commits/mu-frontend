import { CC_CACHE_KEY } from './chat/CcChat.jsx'

// ─── 皮肤共用的数据和工具 ─────────────────────────
// 接口（口令、apiFetch / apiJson、MCP）、本地缓存（草稿、每日一句、重要日期）、日期工具。Clawd（App.jsx）和 Vesper 都从这里拿，换皮肤不换逻辑。
// 和 chat/CcChat.jsx 是循环 import：CC_CACHE_KEY 只在 lockApp 里用，模块顶层别碰

// 后端地址：构建时用 VITE_API_URL 覆盖；默认走自己的域名（旧的 mu-backend-l0uw.onrender.com 过渡期也还能用）
const API = import.meta.env.VITE_API_URL || 'https://api.mu0727.com'
const START_DATE = new Date('2026-07-27')

// ─── APP 口令 ──────────────────────────────────────
// 所有 /api 请求都走 apiFetch，统一带 APP 口令。口令存在 localStorage 的 cc_passcode 里
// （沿用沐聊天页原来的 key，以前在那儿解锁过的设备不用重输）。
// 没口令或后端回 401 就清掉口令、广播 mu-lock，App 收到后整个切回锁屏。
function getPasscode() {
  try { return localStorage.getItem('cc_passcode') || '' } catch { return '' }
}
function setPasscodeStorage(code) {
  try { if (code) localStorage.setItem('cc_passcode', code); else localStorage.removeItem('cc_passcode') } catch {}
}
function lockApp() {
  setPasscodeStorage('')
  try { localStorage.removeItem(CC_CACHE_KEY) } catch {} // 锁上了就别在本机留聊天记录
  window.dispatchEvent(new Event('mu-lock'))
}
async function apiFetch(path, opts = {}) {
  const passcode = getPasscode()
  if (!passcode) { lockApp(); throw Object.assign(new Error('locked'), { status: 0 }) }
  const res = await fetch(`${API}${path}`, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${passcode}` } })
  if (res.status === 401) lockApp()
  return res
}

// ─── Avatar helpers (localStorage) — session list avatar ──
// ─── Draft helpers ──────────────────────────────────
function getDraft(sessionId) {
  try { return localStorage.getItem(`draft_${sessionId}`) || '' } catch { return '' }
}
function setDraftStorage(sessionId, text) {
  try { if (text) localStorage.setItem(`draft_${sessionId}`, text); else localStorage.removeItem(`draft_${sessionId}`) } catch {}
}

// ─── MCP server URL (localStorage) ──────────────────
function getMcpUrl() {
  try { return localStorage.getItem('mcp_server_url') || '' } catch { return '' }
}
function setMcpUrlStorage(url) {
  try { if (url) localStorage.setItem('mcp_server_url', url); else localStorage.removeItem('mcp_server_url') } catch {}
}
// Minimal MCP (Model Context Protocol) JSON-RPC call over Streamable HTTP.
// Servers may reply as plain JSON or as an SSE "data: {...}" frame — handle both.
async function mcpRequest(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || {} }),
  })
  const raw = await res.text()
  let payload
  try { payload = JSON.parse(raw) } catch {
    const m = raw.match(/data:\s*(\{[\s\S]*\})/)
    if (!m) throw new Error(`Invalid response from MCP server (HTTP ${res.status})`)
    payload = JSON.parse(m[1])
  }
  if (!res.ok) throw new Error(payload?.error?.message || `HTTP ${res.status}`)
  if (payload.error) throw new Error(payload.error.message || 'MCP server returned an error')
  return payload.result
}

// ─── Important dates (localStorage，旧数据) ─────────
// 现在存在数据库 events 里（见下面的 ensureImportantMigrated）；这里只读，用来迁移和没解锁时兜底。
// 浏览器里没存过就是空的：以前这里会退回三条写死的默认值，换设备/清数据后迁移又把它们传上去，删掉的生日会自己回来
function getImportantDates() {
  try {
    const d = JSON.parse(localStorage.getItem('important_dates'))
    return Array.isArray(d) ? d : []
  } catch { return [] }
}

// ─── Calendar events（/api/events）──
// 时间一律按 Asia/Shanghai 理解和显示
const SH_TZ = 'Asia/Shanghai'
const pad2 = (n) => String(n).padStart(2, '0')
const addDaysStr = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const daysBetweenStr = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
const shDateOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: SH_TZ }).format(new Date(iso))
const shTimeOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: SH_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
function eventFirstDay(e) { return e.all_day ? e.start_date : shDateOf(e.starts_at) }
function eventLastDay(e) {
  if (e.all_day) return e.end_date || e.start_date
  const first = shDateOf(e.starts_at)
  if (!e.ends_at || Date.parse(e.ends_at) <= Date.parse(e.starts_at)) return first
  const last = shDateOf(e.ends_at)
  // 正好 0 点结束的不算占了下一天
  return last > first && shTimeOf(e.ends_at) === '00:00' ? addDaysStr(last, -1) : last
}

// JSON 接口的简便写法：非 2xx 抛错，错误上带 status
async function apiJson(method, path, body) {
  const res = await apiFetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status })
  return data
}
function eventsErrorText(e) {
  if (e?.message === 'locked' || e?.status === 401) return '口令失效了，重新解锁后再试'
  if (e?.status === 400 || e?.status === 403) return `没保存上：${e.message}`
  return '没保存上，稍后再试'
}

// 数据库里 kind=important 的一条 → 旧的重要日期格式（日历的重要日期卡片和弹窗沿用它）
// 重复的由后端展开，date 用系列原始日期（编辑时改的是整个系列），shownOn 是这次显示在哪天
function importantFromEvent(e) {
  return { id: e.series_id ?? e.id, name: e.title, date: e.series_start_date ?? eventFirstDay(e), shownOn: eventFirstDay(e), recurring: e.repeat === 'none' ? false : e.repeat }
}

// 重要日期搬家：浏览器里真存过的 important_dates（没存过就什么都不传），
// 数据库里还没有的（同名同日期，或 external_id=legacy:<原 id> 已存在）上传一次；全部成功才记"已迁移"，原数据不删
const IMPORTANT_MIGRATED_KEY = 'important_dates_migrated'
let importantMigration = null
function ensureImportantMigrated() {
  try { if (localStorage.getItem(IMPORTANT_MIGRATED_KEY)) return Promise.resolve() } catch { return Promise.resolve() }
  if (!getPasscode()) return Promise.resolve()
  importantMigration ??= (async () => {
    let uploaded = 0
    for (const d of getImportantDates()) {
      const name = typeof d?.name === 'string' ? d.name.trim() : ''
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) continue
      const sameDay = await apiJson('GET', `/api/events?from=${d.date}&to=${d.date}`)
      if (sameDay.some(e => e.kind === 'important' && e.title === name)) continue
      try {
        await apiJson('POST', '/api/events', {
          title: name, all_day: true, start_date: d.date, kind: 'important',
          repeat: d.recurring === 'yearly' || d.recurring === 'monthly' ? d.recurring : 'none',
          external_id: `legacy:${d.id}`,
        })
        uploaded++
      } catch (e) { if (e.status !== 409) throw e } // 409：别的设备已经传过这条
    }
    try { localStorage.setItem(JSON.stringify({ at: new Date().toISOString(), uploaded })) } catch {}
  })().catch(() => { importantMigration = null }) // 失败了下次进页面再试
  return importantMigration
}

// 首页倒计时：今天起 400 天内每个重要日期的下一次（重复的由后端展开），整理成旧的重要日期格式；结果缓存一份，打开首页先顶上
const IMPORTANT_CACHE_KEY = 'important_upcoming_cache'
function getUpcomingImportantCache() {
  try { const v = JSON.parse(localStorage.getItem(IMPORTANT_CACHE_KEY)); return Array.isArray(v) ? v : null } catch { return null }
}
async function fetchUpcomingImportant() {
  const today = beijingDateStr()
  const list = await apiJson('GET', `/api/events?from=${today}&to=${addDaysStr(today, 399)}`)
  const next = new Map()
  for (const e of list) {
    if (e.kind !== 'important') continue
    const id = e.series_id ?? e.id, day = eventFirstDay(e)
    if (day < today) continue
    if (!next.has(id) || day < next.get(id).date) next.set(id, { id, name: e.title, date: day, recurring: false })
  }
  const out = [...next.values()]
  try { localStorage.setItem(JSON.stringify(out)) } catch {}
  return out
}

// ─── Period prediction ──────────────────────────────
function predictNextPeriod(periods) {
  if (!periods || periods.length < 2) return []
  const dates = periods.map(p => new Date(p.date)).sort((a, b) => a - b)
  const starts = []
  let prevDate = null
  dates.forEach(d => {
    if (!prevDate || (d - prevDate) / 86400000 > 1) starts.push(d)
    prevDate = d
  })
  if (starts.length < 2) return []
  const gaps = []
  for (let i = 1; i < starts.length; i++) gaps.push((starts[i] - starts[i - 1]) / 86400000)
  const avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
  if (avgCycle < 20 || avgCycle > 45) return []
  const lastStart = starts[starts.length - 1]
  const nextStart = new Date(lastStart.getTime() + avgCycle * 86400000)
  const predicted = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(nextStart.getTime() + i * 86400000)
    predicted.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return predicted
}

// ─── Date helpers ───────────────────────────────────
function fmtListTime(t) { if (!t) return ''; const d = new Date(t), now = new Date(); if (d.toDateString() === now.toDateString()) return fmtShortTime(t); return `${d.getMonth() + 1}/${d.getDate()}` }
function getWhisperCache() {
  try { const w = JSON.parse(localStorage.getItem('whisper_last') || 'null'); return w?.content ? w : null } catch { return null }
}
function setWhisperCache(w) {
  try { localStorage.setItem('whisper_last', JSON.stringify({ date: w.date, content: w.content })) } catch {}
}
// whispers 表按北京时间的日期存
function beijingDateStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}
function daysBetween(a, b) { return Math.floor((b - a) / (1000 * 60 * 60 * 24)) }
function daysUntilCeil(a, b) { return Math.ceil((b - a) / (1000 * 60 * 60 * 24)) }

function fmtShortTime(t, pad) { if (!t) return ''; const d = new Date(t); return `${pad ? String(d.getHours()).padStart(2, '0') : d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
// 聊天消息的时间，都带时刻：今天 21:30；昨天 Yesterday 21:30；2–6 天前 Monday 21:30；更早 10/9 21:30（跨年带年份）。按日历天算，不按 24 小时
// pad：小时补两位（英文版 Vesper 照画布写 08:31）
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function fmtMsgTime(t, pad) {
  if (!t) return ''
  const d = new Date(t), now = new Date(), hm = fmtShortTime(t, pad)
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
  if (days <= 0) return hm
  if (days === 1) return `Yesterday ${hm}`
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${hm}`
  return `${d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}/`}${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

const CC_SESSION = { id: 'cc' }

export {
  API, START_DATE, getPasscode, setPasscodeStorage, lockApp, apiFetch, getDraft, setDraftStorage, getMcpUrl, setMcpUrlStorage, mcpRequest, getImportantDates, SH_TZ, pad2, addDaysStr, daysBetweenStr, shDateOf, shTimeOf, eventFirstDay, eventLastDay, apiJson, eventsErrorText, importantFromEvent, ensureImportantMigrated, getUpcomingImportantCache, fetchUpcomingImportant, predictNextPeriod, fmtListTime, getWhisperCache, setWhisperCache, beijingDateStr, daysBetween, daysUntilCeil, fmtShortTime, fmtMsgTime, CC_SESSION,
}
