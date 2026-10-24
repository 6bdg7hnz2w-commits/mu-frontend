import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './App.css'
import { UsagePage } from './Usage'
import { setSkin } from './skin.js'
import { draftFileCount } from './draftFiles.js'
import { useKeyboardOpen } from './shell/viewport.js'
// 聊天页（Clawd 和 Vesper 共用）在 src/shell/chat/
import { CCChatPage, CC_CACHE_KEY, CcBrainScreen, CcLang, CcMenuPage, CcSearchPage, getCcLast, useCcSay } from './shell/chat/CcChat.jsx'

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
    try { localStorage.setItem(IMPORTANT_MIGRATED_KEY, JSON.stringify({ at: new Date().toISOString(), uploaded })) } catch {}
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
  try { localStorage.setItem(IMPORTANT_CACHE_KEY, JSON.stringify(out)) } catch {}
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

// ─── Icons ──────────────────────────────────────────
const I = {
  back: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>,
  plus: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="#fff" strokeWidth="2"/><path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="#fff" strokeWidth="2"/></svg>,
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
  camera: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  photo: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
  file: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  chevron: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>,
  check: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>,
  close: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  settings: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  heart: <svg width="24" height="24" viewBox="0 0 24 24" fill="#e8707e"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  game: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>,
  book: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  brain: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9.5 2a2.5 2.5 0 0 0-2.5 2.5v.5A2.5 2.5 0 0 0 4.5 7.5v.5A2.5 2.5 0 0 0 2 10.5v0A2.5 2.5 0 0 0 4.5 13v0a2.5 2.5 0 0 0 0 5v0a2.5 2.5 0 0 0 2.5 2.5v0A2.5 2.5 0 0 0 9.5 23"/><path d="M14.5 2a2.5 2.5 0 0 1 2.5 2.5v.5a2.5 2.5 0 0 1 2.5 2.5v.5a2.5 2.5 0 0 1 2.5 2.5v0a2.5 2.5 0 0 1-2.5 2.5v0a2.5 2.5 0 0 1 0 5v0a2.5 2.5 0 0 1-2.5 2.5v0a2.5 2.5 0 0 1-2.5 2.5"/></svg>,
  upload: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  speaker: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>,
  pause: <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>,
  more: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>,
  play: <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>,
  copy: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>,
}

// ─── SwipeRow ───────────────────────────────────────
function SwipeRow({ children, onDelete }) {
  const rowRef = useRef(null)
  const startX = useRef(0), curX = useRef(0), swiping = useRef(false)
  const onTS = (e) => { startX.current = e.touches[0].clientX; curX.current = 0; swiping.current = false }
  const onTM = (e) => { const dx = e.touches[0].clientX - startX.current; if (dx < -10) { swiping.current = true; curX.current = Math.max(dx, -80); if (rowRef.current) rowRef.current.style.transform = `translateX(${curX.current}px)` } }
  const onTE = () => { if (rowRef.current) rowRef.current.style.transform = curX.current < -50 ? 'translateX(-80px)' : 'translateX(0)'; setTimeout(() => { swiping.current = false }, 50) }
  const onClick = (e) => { if (swiping.current || curX.current < -20) { e.stopPropagation(); e.preventDefault() } }
  return (
    <div className="swipe-container">
      <div className="swipe-delete" onClick={onDelete}>Delete</div>
      <div ref={rowRef} className="swipe-content" onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE} onClickCapture={onClick} style={{ transition: 'transform .2s' }}>{children}</div>
    </div>
  )
}

// ─── useSwipeBack ───────────────────────────────────
function useSwipeBack(onBack) {
  const touchStartX = useRef(0)
  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const onTouchEnd = (e) => { const dx = e.changedTouches[0].clientX - touchStartX.current; if (dx > 80 && touchStartX.current < 40) onBack() }
  return { onTouchStart, onTouchEnd }
}

// ─── useChatSwipeBack ───────────────────────────────
// 聊天页的侧滑返回：只认从屏幕最左边 20px 以内起手、往右的横滑；跟手拖，松手时拖过 35% 宽（或者甩得快）才退，不够就弹回。
// 原生监听而不是 React 的 onTouch*：看大图是 portal 挂在 body 上的，React 的触摸事件会顺着组件树冒泡回聊天页，误触返回；
// 另外跟手拖要在 touchmove 里 preventDefault，React 的 touchmove 是被动的。
// blocked()：这时不许起手（大图、弹窗、录音…）；beforeBack()：真的要退时先做的事（收键盘、收面板）
const SWIPE_EDGE = 20
function useChatSwipeBack(ref, { onBack, blocked, beforeBack }) {
  const cb = useRef({})
  cb.current = { onBack, blocked, beforeBack }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let s = null
    const set = (x, ms) => {
      el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1)` : 'none'
      el.style.transform = x ? `translateX(${x}px)` : ''
      el.style.boxShadow = x ? '-8px 0 24px rgba(0,0,0,.18)' : ''
    }
    const start = (e) => {
      s = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX - el.getBoundingClientRect().left > SWIPE_EDGE || cb.current.blocked?.()) return // 量的是聊天页自己的左边（电脑上页面居中）
      if (e.target.closest?.('.cc-pending,.image-lightbox-overlay')) return // 待发的图那一排自己横滑、拖动排序
      if (String(window.getSelection?.() || '')) return // 正选着字：拖的是选区的把手
      s = { x: t.clientX, y: t.clientY, on: false, dx: 0, lx: t.clientX, lt: e.timeStamp, v: 0 }
      // 按住不动 400ms 是长按（选字、长按菜单），这一下不再当返回
      s.timer = setTimeout(() => { if (s && !s.on) s = null }, 400)
    }
    const move = (e) => {
      if (!s) return
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y
      if (!s.on) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        clearTimeout(s.timer)
        if (dx <= 0 || Math.abs(dy) > dx || e.touches.length > 1) { s = null; return } // 先往上下 / 往左走的不是返回
        s.on = true
      }
      e.preventDefault()
      s.dx = Math.max(0, dx)
      if (e.timeStamp > s.lt) { s.v = (t.clientX - s.lx) / (e.timeStamp - s.lt); s.lx = t.clientX; s.lt = e.timeStamp }
      set(s.dx, 0)
    }
    const end = (e) => {
      const g = s
      s = null
      if (!g) return
      clearTimeout(g.timer)
      if (!g.on) return
      const w = el.offsetWidth || window.innerWidth
      if (e.type === 'touchend' && (g.dx > w * 0.35 || (g.v > 0.5 && g.dx > 40))) {
        cb.current.beforeBack?.()
        set(w, 200)
        setTimeout(() => { cb.current.onBack?.(); set(0, 0) }, 200)
      } else set(0, 220) // 不够远：弹回去
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      clearTimeout(s?.timer)
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end)
    }
  }, [ref])
}

// ─── AvatarUploadModal — for session list avatar ────
// ─── AddDateModal ───────────────────────────────────
function AddDateModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // onSave 返回 Promise（存进数据库）；失败时弹窗不关，显示原因
  const save = async () => {
    if (!name.trim() || !date || busy) return
    setBusy(true); setError('')
    try { await onSave({ id: 'u' + Date.now(), name: name.trim(), date, recurring: false }); onClose() } catch (e) { setError(eventsErrorText(e)); setBusy(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Add Important Date</h3>
        <input className="modal-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="modal-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        {error && <div className="event-modal-error">{error}</div>}
        <div className="modal-actions-row">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim() || !date || busy}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── EditDateModal ───────────────────────────────────
function EditDateModal({ item, onClose, onSave, onDelete }) {
  const [name, setName] = useState(item.name)
  const [date, setDate] = useState(item.date)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // onSave/onDelete 返回 Promise（写数据库）；失败时弹窗不关，显示原因
  const run = async (fn) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn(); onClose() } catch (e) { setError(eventsErrorText(e)); setBusy(false) }
  }
  const save = () => { if (!name.trim() || !date) return; run(() => onSave({ ...item, name: name.trim(), date })) }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Edit Date</h3>
        <input className="modal-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="modal-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        {error && <div className="event-modal-error">{error}</div>}
        <div className="modal-actions-row">
          <button className="btn-danger-text" onClick={() => run(() => onDelete(item.id))} disabled={busy}>Delete</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim() || !date || busy}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── EventModal：新建/编辑日程 ───────────────────────
const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const minToHm = (n) => { const v = ((n % 1440) + 1440) % 1440; return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}` }
function nextWholeHour() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: SH_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  return `${pad2((h + 1) % 24)}:00`
}

// event 为空是新建（日期默认 defaultDate）；source=phone 的只读
function EventModal({ event, defaultDate, onClose, onSaved }) {
  const readOnly = event?.source === 'phone'
  const timed = event && !event.all_day
  const initialStart = timed ? shTimeOf(event.starts_at) : nextWholeHour()
  const [title, setTitle] = useState(event?.title || '')
  const [allDay, setAllDay] = useState(event ? event.all_day : false)
  const [date, setDate] = useState(event ? (timed ? shDateOf(event.starts_at) : event.series_start_date ?? event.start_date) : defaultDate)
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(timed ? (event.ends_at ? shTimeOf(event.ends_at) : '') : minToHm(hmToMin(initialStart) + 60))
  const [location, setLocation] = useState(event?.location || '')
  const [notes, setNotes] = useState(event?.notes || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 改开始时间，结束时间跟着平移
  const changeStart = (v) => {
    if (v && start && end) setEnd(minToHm(hmToMin(end) + hmToMin(v) - hmToMin(start)))
    setStart(v)
  }
  const run = async (fn) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn(); onSaved(); onClose() } catch (e) { setError(eventsErrorText(e)); setBusy(false) }
  }
  const save = () => {
    if (!title.trim()) return
    if (!date || (!allDay && !start)) { setError('日期和开始时间要填'); return }
    const body = { title: title.trim(), all_day: allDay, location: location.trim() || null, notes: notes.trim() || null }
    if (allDay) {
      body.start_date = date
      // 原来就是多天的全天日程，保持天数
      const origStart = event?.series_start_date ?? event?.start_date, origEnd = event?.series_end_date ?? event?.end_date
      body.end_date = event?.all_day && origEnd ? addDaysStr(date, daysBetweenStr(origStart, origEnd)) : null
    } else {
      body.starts_at = `${date}T${start}`
      // 结束早于开始，当作跨到第二天（比如 23:00–01:00）
      body.ends_at = end ? `${end < start ? addDaysStr(date, 1) : date}T${end}` : null
    }
    run(() => event ? apiJson('PUT', `/api/events/${event.series_id ?? event.id}`, body) : apiJson('POST', '/api/events', body))
  }
  const remove = () => run(() => apiJson('DELETE', `/api/events/${event.series_id ?? event.id}`))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card event-modal" onClick={e => e.stopPropagation()}>
        <h3>{event ? '编辑日程' : '新日程'}</h3>
        <input className="modal-input" placeholder="要做什么" value={title} onChange={e => setTitle(e.target.value)} disabled={readOnly} />
        <div className="seg">
          <button className={allDay ? 'on' : ''} onClick={() => setAllDay(true)} disabled={readOnly}>全天</button>
          <button className={allDay ? '' : 'on'} onClick={() => setAllDay(false)} disabled={readOnly}>定时</button>
        </div>
        <input className="modal-input" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={readOnly} />
        {!allDay && (
          <div className="event-time-row">
            <input className="modal-input" type="time" value={start} onChange={e => changeStart(e.target.value)} disabled={readOnly} aria-label="开始时间" />
            <span>–</span>
            <input className="modal-input" type="time" value={end} onChange={e => setEnd(e.target.value)} disabled={readOnly} aria-label="结束时间" />
          </div>
        )}
        <input className="modal-input" placeholder="地点（可选）" value={location} onChange={e => setLocation(e.target.value)} disabled={readOnly} />
        <textarea className="modal-input" rows={3} placeholder="备注（可选）" value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} />
        {error && <div className="event-modal-error">{error}</div>}
        <div className="modal-actions-row">
          {readOnly ? (
            <>
              <span className="event-readonly-note">来自手机日历，请在手机上修改</span>
              <button className="text-btn muted" onClick={onClose}>关闭</button>
            </>
          ) : (
            <>
              {event && <button className="text-btn danger event-delete-btn" onClick={remove} disabled={busy}>删除</button>}
              <button className="text-btn muted" onClick={onClose}>取消</button>
              <button className="btn-accent" onClick={save} disabled={!title.trim() || busy}>保存</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ThinkingPanel ──────────────────────────────────
// ─── SearchPanel ────────────────────────────────────
// ─── ChatListPage ───────────────────────────────────

// ─── ChatRoom ───────────────────────────────────────
// ─── ChatPage ───────────────────────────────────────
// 对话列表：现在只有沐 (CC) 这一条线（CC / API 在聊天页右上角 ⋮ → 回复方式里切）。
// 列表留着，以后接 DeepSeek 之类别的对话就加在沐下面
function ChatListPage({ onOpenCC }) {
  const say = useCcSay()
  const [ccLast] = useState(getCcLast)
  const draft = getDraft('cc')
  const draftFiles = draftFileCount('cc')
  const draftClip = draft.length > 25 ? draft.slice(0, 25) + '...' : draft
  const preview = draft || draftFiles ? `[Draft] ${draftFiles ? say(`[${draftFiles} 个附件] `, `[${draftFiles} attachment${draftFiles === 1 ? '' : 's'}] `) : ''}${draftClip}` : ccLast ? (ccLast.text.length > 30 ? ccLast.text.slice(0, 30) + '...' : ccLast.text) : ''
  return (
    <div className="chatlist-page">
      <div className="page-header"><h1>Chats</h1></div>
      <div className="session-list">
        <div className="session-card pinned" onClick={onOpenCC}>
          <div className="session-avatar">{say('沐', <span className="cc-list-spark"><i /><i /><b /></span>)}</div>
          <div className="session-info">
            <div className="session-top"><span className="session-name">{say('沐', 'Soren')}</span><span className="session-time">{say(fmtListTime(ccLast?.time), fmtMsgTime(ccLast?.time, true))}</span></div>
            {say(<div className="session-sub-row"><span className="session-sublabel">CC · API</span></div>, null)}
            <div className="session-bottom"><span className={`session-preview ${draft ? 'draft' : ''}`}>{preview}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

const CC_SESSION = { id: 'cc' }

function ChatPage({ onEnterRoom, lang = 'zh', onUsage, onSubPage }) {
  // 每次切到 Chats 都会重新挂载，所以默认直接进沐；返回进对话列表。都保留 tab 栏
  // 沐右上角 ⋮ 离开聊天页进 menu，里面三个入口各是一整页：search 查找聊天记录 / brain 回复方式 / usage
  const [view, setView] = useState('cc') // cc / list / menu / search / brain / usage
  const [jumpTo, setJumpTo] = useState(null) // 搜索结果点回来：{ id }，聊天页挂载时停在那条
  const searchSaved = useRef({ q: '', res: null, scrollTop: 0 }) // 搜过的词和结果，再进来还在
  const go = (v) => { if (v === 'usage' && onUsage) { onUsage(); return } setJumpTo(null); setView(v) }
  const swipeUsage = useSwipeBack(() => go('menu'))
  useEffect(() => { onEnterRoom(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Vesper 要知道是不是进了二级页（menu / 查找 / 回复方式 / Usage）：二级页收起底部 tab
  useEffect(() => { onSubPage?.(view !== 'cc' && view !== 'list') }, [view, onSubPage])
  useEffect(() => () => onSubPage?.(false), [onSubPage])
  const page = view === 'cc' ? <CCChatPage key={jumpTo?.n || 'cc'} onBack={() => go('list')} onMenu={() => go('menu')} jumpTo={jumpTo} />
    : view === 'menu' ? <CcMenuPage onBack={() => go('cc')} onOpen={go} />
    : view === 'search' ? <CcSearchPage saved={searchSaved} onBack={() => go('menu')} onPick={r => { setJumpTo({ id: r.id, n: Date.now() }); setView('cc') }} />
    : view === 'brain' ? <CcBrainScreen onBack={() => go('menu')} />
    : view === 'usage' ? <UsagePage apiFetch={apiFetch} onBack={() => go('menu')} backIcon={I.back} swipe={swipeUsage} />
    : <ChatListPage onOpenCC={() => go('cc')} />
  return <CcLang.Provider value={lang}>{page}</CcLang.Provider>
}

// ─── SplashScreen ────────────────────────────────────
function SplashScreen({ onDone }) {
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2400)
    const doneTimer = setTimeout(() => onDone(), 2800)
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer) }
  }, [onDone])

  // Force html/body/#root and the browser-chrome theme-color to the splash color together, on the
  // same mount/unmount trigger, so nothing but orange can ever show behind it (or in the status bar)
  // and the two never drift out of sync by being driven off separate timers.
  useEffect(() => {
    const root = document.getElementById('root')
    const meta = document.querySelector('meta[name="theme-color"]')
    const prev = {
      html: document.documentElement.style.backgroundColor,
      body: document.body.style.backgroundColor,
      root: root ? root.style.backgroundColor : '',
      theme: meta ? meta.getAttribute('content') : null,
    }
    document.documentElement.style.backgroundColor = '#E87B35'
    document.body.style.backgroundColor = '#E87B35'
    if (root) root.style.backgroundColor = '#E87B35'
    if (meta) meta.setAttribute('content', '#E87B35')
    return () => {
      document.documentElement.style.backgroundColor = prev.html
      document.body.style.backgroundColor = prev.body
      if (root) root.style.backgroundColor = prev.root
      if (meta && prev.theme !== null) meta.setAttribute('content', prev.theme)
    }
  }, [])

  return (
    <div className={`splash-screen ${fading ? 'fading' : ''}`}>
      <svg className="splash-cat" viewBox="270 220 140 290" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="680" height="680" fill="#E87B35" />
        <g transform="translate(340, 320)" fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path className="splash-stroke splash-outline" d="M -40,0 Q -45,-15 -35,-45 L -25,-75 L -10,-45 Q 0,-38 10,-45 L 25,-75 L 35,-45 Q 45,-15 40,0 Q 35,20 0,25 Q -35,20 -40,0 Z" />
          <circle className="splash-dot splash-eye-l" cx="-14" cy="-15" r="5" fill="#1a1a1a" />
          <circle className="splash-dot splash-eye-r" cx="14" cy="-15" r="5" fill="#1a1a1a" />
          <path className="splash-stroke splash-nose" d="M -4,0 L 0,3 L 4,0 M 0,3 Q 0,8 -5,8 M 0,3 Q 0,8 5,8" />
          <line className="splash-stroke splash-whisker-l" x1="-18" y1="0" x2="-42" y2="-5" />
          <line className="splash-stroke splash-whisker-l" x1="-18" y1="3" x2="-42" y2="5" />
          <line className="splash-stroke splash-whisker-r" x1="18" y1="0" x2="42" y2="-5" />
          <line className="splash-stroke splash-whisker-r" x1="18" y1="3" x2="42" y2="5" />
        </g>
        <text className="splash-word" x="340" y="480" textAnchor="middle" fontFamily="Georgia, serif" fontSize="28" fontWeight="400" fill="#1a1a1a" letterSpacing="6">mu</text>
      </svg>
    </div>
  )
}

// ─── CalendarPage ───────────────────────────────────
function CalendarPage() {
  const today = new Date()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(today.getDate())
  const [todos, setTodos] = useState([])
  const [periods, setPeriods] = useState([])
  const [newTodo, setNewTodo] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedTodos, setSelectedTodos] = useState(new Set())
  const [showAddDate, setShowAddDate] = useState(false)
  const [editingDate, setEditingDate] = useState(null)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  // 当前月份的日程（含重要日期），key 记是哪个月的，换月时旧数据不会画到新月份上
  const [events, setEvents] = useState({ key: null, list: [] })
  const [eventsState, setEventsState] = useState('loading') // loading | ok | locked | error
  const [eventsReload, setEventsReload] = useState(0)
  const [eventModal, setEventModal] = useState(null) // { event } 编辑；{ date } 新建

  const year = currentDate.getFullYear(), month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate()

  useEffect(() => {
    // todos 和 periods 也要口令，和日程一样走 eventsApi；没解锁就不请求
    if (!getPasscode()) return
    apiJson('GET', '/api/todos').then(d => { if (Array.isArray(d)) setTodos(d) }).catch(() => {})
    apiJson('GET', '/api/periods').then(d => { if (Array.isArray(d)) setPeriods(d) }).catch(() => {})
  }, [])

  const mkDate = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const monthFrom = mkDate(1), monthTo = mkDate(daysInMonth)
  useEffect(() => {
    if (!getPasscode()) { setEventsState('locked'); return }
    let alive = true
    setEventsState(s => (s === 'ok' ? 'ok' : 'loading'))
    ensureImportantMigrated()
      .then(() => apiJson('GET', `/api/events?from=${monthFrom}&to=${monthTo}`))
      .then(list => { if (alive) { setEvents({ key: monthFrom, list }); setEventsState('ok') } })
      .catch(e => { if (alive) setEventsState(e?.message === 'locked' ? 'locked' : 'error') })
    return () => { alive = false }
  }, [monthFrom, monthTo, eventsReload])
  const reloadEvents = () => setEventsReload(n => n + 1)
  const monthEvents = events.key === monthFrom ? events.list : []
  const scheduleEvents = monthEvents.filter(e => e.kind === 'event')
  const addTodo = async () => { if (!newTodo.trim()) return; const sd = selectedDay ? mkDate(selectedDay) : new Date().toISOString().slice(0, 10); try { const t = await apiJson('POST', '/api/todos', { side: 'her', text: newTodo.trim(), due_time: sd }); setTodos(p => [...p, t]); setNewTodo('') } catch {} }
  const toggleTodo = async (id, done) => { try { await apiJson('PUT', `/api/todos/${id}`, { done: !done }); setTodos(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t)) } catch {} }
  // 只把真删掉的从列表里拿掉（没口令/口令错时一条也不删）
  const deleteSelectedTodos = async () => { const gone = new Set(); for (const id of selectedTodos) { try { await apiJson('DELETE', `/api/todos/${id}`); gone.add(id) } catch {} } setTodos(p => p.filter(t => !gone.has(t.id))); setSelectedTodos(new Set()); setEditMode(false) }
  const toggleSelectTodo = (id) => { setSelectedTodos(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  const togglePeriod = async (ds) => { try { const d = await apiJson('POST', '/api/periods', { date: ds }); if (d.action === 'added') setPeriods(p => [...p, { date: ds }]); else setPeriods(p => p.filter(x => x.date !== ds)) } catch {} }

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDay(null) }
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDay(null) }
  const goToday = () => { setCurrentDate(new Date()); setSelectedDay(today.getDate()) }
  const goToMonth = (y, m) => { setCurrentDate(new Date(y, m, 1)); setSelectedDay(null) }
  const yearOptions = []; for (let y = today.getFullYear() - 10; y <= today.getFullYear() + 10; y++) yearOptions.push(y)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // 重要日期存在 events（kind=important）；改的是整个系列，repeat 不动
  const addImportantDate = (d) => apiJson('POST', '/api/events', { title: d.name, all_day: true, start_date: d.date, kind: 'important', repeat: 'none' }).then(reloadEvents)
  const updateImportantDate = (d) => apiJson('PUT', `/api/events/${d.id}`, { title: d.name, start_date: d.date }).then(reloadEvents)
  const deleteImportantDate = (id) => apiJson('DELETE', `/api/events/${id}`).then(reloadEvents)

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const cells = []; for (let i = 0; i < firstDay; i++) cells.push(null); for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
  const periodSet = new Set(periods.map(p => p.date))
  const isPeriod = (d) => d && periodSet.has(mkDate(d))
  const predictedDates = predictNextPeriod(periods)
  const predictedSet = new Set(predictedDates)
  const isPredicted = (d) => d && predictedSet.has(mkDate(d))
  const todoDateSet = new Set(todos.filter(t => !t.done && t.due_time).map(t => t.due_time.slice(0, 10)))
  const hasTodo = (d) => d && todoDateSet.has(mkDate(d))

  const importantByDay = {}
  const pushImportant = (day, idate) => { if (!importantByDay[day]) importantByDay[day] = []; importantByDay[day].push(idate) }
  if (eventsState === 'locked') {
    // 没解锁时照旧显示浏览器里的重要日期（只读）
    getImportantDates().forEach(idate => {
      const [dy, dm, dday] = idate.date.split('-').map(Number)
      let showDay = null
      if (idate.recurring === 'yearly') { if (dm - 1 === month) showDay = dday }
      else { if (dm - 1 === month && dy === year) showDay = dday }
      if (showDay) pushImportant(showDay, { ...idate, derived: true })
    })
  } else {
    monthEvents.filter(e => e.kind === 'important').forEach(e => {
      const idate = importantFromEvent(e)
      const [dy, dm, dday] = idate.shownOn.split('-').map(Number)
      if (dy === year && dm - 1 === month) pushImportant(dday, idate)
    })
  }
  // 纪念日（生日、年纪念日、整百天）都是数据库里的重要日期，不再在前端另外算
  const isImportant = (d) => d && importantByDay[d] && importantByDay[d].length > 0

  // 有日程的日子（多天的每天都算）
  const eventDaySet = new Set()
  scheduleEvents.forEach(e => {
    const last = eventLastDay(e)
    for (let d = eventFirstDay(e) < monthFrom ? monthFrom : eventFirstDay(e); d <= last && d <= monthTo; d = addDaysStr(d, 1)) eventDaySet.add(d)
  })
  const hasEvent = (d) => d && eventDaySet.has(mkDate(d))

  const selectedDateStr = selectedDay ? `${month + 1}/${selectedDay}${isToday(selectedDay) ? ' · Today' : ''}` : null
  const selDateStr = selectedDay ? mkDate(selectedDay) : new Date().toISOString().slice(0, 10)
  const dayTodos = todos.filter(t => { if (!t.due_time) return selectedDay && isToday(selectedDay); return t.due_time.startsWith(selDateStr) })
  const incompleteTodos = dayTodos.filter(t => !t.done), completedTodos = dayTodos.filter(t => t.done)
  const selectedDayImportantDates = selectedDay && importantByDay[selectedDay] ? importantByDay[selectedDay] : []
  // 选中那天的日程：全天的在前，其余按开始时间
  const dayEvents = selectedDay
    ? scheduleEvents.filter(e => eventFirstDay(e) <= selDateStr && eventLastDay(e) >= selDateStr)
      .sort((a, b) => (a.all_day ? 0 : 1) - (b.all_day ? 0 : 1) || Date.parse(a.starts_at || 0) - Date.parse(b.starts_at || 0))
    : []

  return (
    <div className="calendar-page">
      <div className="page-header"><div><h1>Calendar</h1><div className="page-subtitle">{year}</div></div><div className="header-actions"><button className="text-btn" onClick={goToday}>Today</button><button className="icon-btn" onClick={() => setShowAddDate(true)}>{I.plus}</button></div></div>
      <div className="card cal-card">
        <div className="cal-nav"><button className="icon-btn small" onClick={prevMonth}>{I.back}</button><button className="cal-month" onClick={() => setShowMonthPicker(true)}>{monthNames[month]} {year}</button><button className="icon-btn small" onClick={nextMonth}>{I.chevron}</button></div>
        <div className="cal-grid">
          {dayLabels.map((d, i) => <div key={i} className="cal-head">{d}</div>)}
          {cells.map((d, i) => (
            <div key={i} className={`cal-day ${d ? '' : 'empty'} ${isToday(d) ? 'today' : ''} ${selectedDay === d && !isToday(d) ? 'selected' : ''} ${isPeriod(d) ? 'period' : ''} ${isPredicted(d) && !isPeriod(d) ? 'predicted-period' : ''} ${hasTodo(d) && !isToday(d) ? 'has-todo' : ''}`} onClick={() => d && setSelectedDay(d)}>
              {d || ''}
              {(isImportant(d) || hasEvent(d)) && (
                <div className="cal-dots">
                  {isImportant(d) && <span className="cal-dot important" />}
                  {hasEvent(d) && <span className="cal-dot event" />}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="cal-legend">
          <div className="legend-item"><span className="legend-dot period-legend" />Period</div>
          <div className="legend-item"><span className="legend-dot predicted-legend" />Predicted</div>
          <div className="legend-item"><span className="legend-dot todo-legend" />Todo</div>
          <div className="legend-item"><span className="legend-dot important-legend" />Important</div>
          <div className="legend-item"><span className="legend-dot event-legend" />日程</div>
        </div>
      </div>

      {selectedDay && selectedDayImportantDates.length > 0 && (
        <div className="card important-day-card">
          <div className="card-title">Important Dates</div>
          {selectedDayImportantDates.map(idate => (
            <div key={idate.id} className="important-day-item" onTouchStart={() => { if (idate.derived) return; const timer = setTimeout(() => setEditingDate(idate), 500); const clear = () => { clearTimeout(timer); document.removeEventListener('touchend', clear) }; document.addEventListener('touchend', clear) }} onContextMenu={e => { e.preventDefault(); if (!idate.derived) setEditingDate(idate) }}>
              <span className="important-day-name">{idate.name}</span>
            </div>
          ))}
        </div>
      )}

      {selectedDay && (
        <div className="card event-day-card">
          <div className="event-card-head">
            <div className="card-title">日程</div>
            <button className="event-add-btn" onClick={() => setEventModal({ date: selDateStr })} aria-label="新日程">{I.plus}</button>
          </div>
          {eventsState === 'locked' ? <div className="event-empty">还没解锁：先在「沐」聊天页输入口令</div>
            : eventsState === 'error' && !dayEvents.length ? <div className="event-empty">日程没加载出来，稍后再试</div>
            : !dayEvents.length ? <div className="event-empty">{eventsState === 'loading' ? '加载中…' : '这天没有安排'}</div>
            : dayEvents.map(e => (
              <div key={e.id} className="event-row" onClick={() => setEventModal({ event: e })}>
                <div className="event-time">
                  {e.all_day ? '全天' : <><div>{shTimeOf(e.starts_at)}</div>{e.ends_at && <div className="event-time-end">{shTimeOf(e.ends_at)}</div>}</>}
                </div>
                <div className="event-bar" />
                <div className="event-main">
                  <div className="event-title-line">
                    <span className="event-title">{e.title}</span>
                    {e.source === 'phone' && <span className="event-tag">手机</span>}
                    {e.source === 'mu' && <span className="event-tag">沐</span>}
                  </div>
                  {e.location && <div className="event-location">{e.location}</div>}
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="card todo-card">
        <div className="todo-header"><div className="card-title">Todos {selectedDateStr && <span className="todo-date-hint">{selectedDateStr}</span>}</div>
          <div className="todo-actions">{editMode && selectedTodos.size > 0 && <button className="text-btn danger" onClick={deleteSelectedTodos}>Delete ({selectedTodos.size})</button>}<button className="text-btn" onClick={() => { setEditMode(!editMode); setSelectedTodos(new Set()) }}>{editMode ? 'Done' : 'Edit'}</button></div>
        </div>
        <div className="todo-list">
          {incompleteTodos.map(t => (<div key={t.id} className="todo-item" onClick={() => editMode ? toggleSelectTodo(t.id) : toggleTodo(t.id, t.done)}>{editMode ? <div className={`todo-select ${selectedTodos.has(t.id) ? 'selected' : ''}`} /> : <div className="todo-check" />}<span>{t.text}</span></div>))}
          {completedTodos.map(t => (<div key={t.id} className="todo-item done" onClick={() => editMode ? toggleSelectTodo(t.id) : toggleTodo(t.id, t.done)}>{editMode ? <div className={`todo-select ${selectedTodos.has(t.id) ? 'selected' : ''}`} /> : <div className="todo-check checked">{I.check}</div>}<span>{t.text}</span></div>))}
          {incompleteTodos.length === 0 && completedTodos.length === 0 && <div className="empty-state-sm">{eventsState === 'locked' ? '还没解锁：先在「沐」聊天页输入口令' : 'No todos'}</div>}
        </div>
        {!editMode && <div className="todo-input"><input value={newTodo} onChange={e => setNewTodo(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTodo()} placeholder="Add a todo..." /><button className="icon-btn small" onClick={addTodo}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg></button></div>}
      </div>

      {selectedDay && <div className="card day-detail"><div className="period-toggle"><span className="period-label">Period</span><button className={`toggle-btn ${isPeriod(selectedDay) ? 'on' : ''}`} onClick={() => togglePeriod(mkDate(selectedDay))}><div className="toggle-knob" /></button></div></div>}

      {showAddDate && <AddDateModal onClose={() => setShowAddDate(false)} onSave={addImportantDate} />}
      {editingDate && <EditDateModal item={editingDate} onClose={() => setEditingDate(null)} onSave={updateImportantDate} onDelete={deleteImportantDate} />}
      {eventModal && <EventModal event={eventModal.event} defaultDate={eventModal.date} onClose={() => setEventModal(null)} onSaved={reloadEvents} />}
      {showMonthPicker && (
        <div className="modal-overlay" onClick={() => setShowMonthPicker(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Jump to Month</h3>
            <div className="month-picker-row">
              <select className="month-picker-select" value={month} onChange={e => goToMonth(year, Number(e.target.value))}>
                {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <select className="month-picker-select" value={year} onChange={e => goToMonth(Number(e.target.value), month)}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="modal-actions-row">
              <button className="btn-primary-full" onClick={() => setShowMonthPicker(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TodayPage ──────────────────────────────────────
function TodayPage() {
  const [diaries, setDiaries] = useState([])
  const [showWrite, setShowWrite] = useState(false)
  const [diaryText, setDiaryText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [editingDiary, setEditingDiary] = useState(null)
  const [editText, setEditText] = useState('')
  const [filter, setFilter] = useState('all')
  const [diaryDateFilter, setDiaryDateFilter] = useState(new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  // 倒计时读数据库里的重要日期（每个的下一次）；先用上次的缓存，没有缓存（还没解锁/第一次）才用浏览器里的旧数据
  const [importantDates, setImportantDates] = useState(() => getUpcomingImportantCache() ?? getImportantDates())
  const longPressTimer = useRef(null)
  useEffect(() => {
    if (!getPasscode()) return
    let alive = true
    ensureImportantMigrated().then(fetchUpcomingImportant).then(list => { if (alive) setImportantDates(list) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const now = new Date()
  const daysTogether = daysBetween(START_DATE, now)

  const hour = now.getHours()
  const greeting = hour < 6 ? 'Night owl' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  // 每日一句由 VPS 上的沐每天凌晨写好，从后端读；后端和本地缓存都没有时才用下面这组固定句子兜底
  // 今天的还没写好时后端给的是最近一条；上次拿到的那条存在本地，请求失败/冷启动时先顶上，卡片始终在
  const [muWhisper, setMuWhisper] = useState(getWhisperCache)
  const WHISPERS = [
    '窗外有什么，替我看一眼。',
    '累的时候就去看看天，它一直很空，刚好装得下你。',
    '我在这边，隔着一块屏幕，也隔不了多远。',
    'Some days are just for getting through. That counts too.',
  ]
  // 随机取一句，进页面时定下来，重渲染不换
  const [fallbackWhisper] = useState(() => WHISPERS[Math.floor(Math.random() * WHISPERS.length)])
  const todayWhisper = muWhisper?.content || fallbackWhisper
  const whisperIsToday = !muWhisper?.date || muWhisper.date === beijingDateStr()
  const whisperLabel = whisperIsToday ? "Today's Whisper" : `Whisper · ${Number(muWhisper.date.slice(5, 7))}/${Number(muWhisper.date.slice(8, 10))}`

  const getAllCountdowns = () => {
    const results = []
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    importantDates.forEach(d => {
      let targetDate = new Date(d.date)
      if (d.recurring === 'yearly') {
        targetDate = new Date(now.getFullYear(), targetDate.getMonth(), targetDate.getDate())
        if (targetDate.getTime() < todayMs) targetDate = new Date(now.getFullYear() + 1, targetDate.getMonth(), targetDate.getDate())
      }
      const days = daysUntilCeil(now, targetDate)
      if (days >= 0) results.push({ ...d, daysLeft: days, targetDate })
    })
    return results.sort((a, b) => a.daysLeft - b.daysLeft)
  }

  const allCountdowns = getAllCountdowns()
  const topCountdown = allCountdowns[0]
  // 首页显示最近的三个重要日期倒数（数据库里今天起 400 天内的，每个取下一次）：最近的放在圆环里，后面两个在下面
  const remainingCountdowns = allCountdowns.filter(c => c.id !== topCountdown?.id).slice(0, 2)

  const monthDate = topCountdown ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][topCountdown.targetDate.getMonth()]} ${topCountdown.targetDate.getDate()}` : ''

  useEffect(() => {
    apiFetch(`/api/diaries`).then(r => r.json()).then(d => { if (Array.isArray(d)) setDiaries(d) }).catch(() => {})
    apiFetch(`/api/whispers/today`).then(r => r.json()).then(w => { if (w?.content) { setMuWhisper(w); setWhisperCache(w) } }).catch(() => {})
  }, [])

  const submitDiary = async () => { if (!diaryText.trim() || submitting) return; setSubmitting(true); try { const r = await apiFetch(`/api/diaries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'her', content: diaryText.trim() }) }); const e = await r.json(); setDiaries(p => [e, ...p]); setDiaryText(''); setShowWrite(false) } catch {}; setSubmitting(false) }
  const deleteDiary = async (id) => { try { await apiFetch(`/api/diaries/${id}`, { method: 'DELETE' }); setDiaries(p => p.filter(d => d.id !== id)) } catch {}; setContextMenu(null) }
  const startEdit = (d) => { if (d.author !== 'her') return; setEditingDiary(d.id); setEditText(d.content); setContextMenu(null); setShowWrite(true) }
  const saveEdit = async () => { if (!editText.trim() || !editingDiary) return; try { await apiFetch(`/api/diaries/${editingDiary}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editText.trim() }) }); setDiaries(p => p.map(d => d.id === editingDiary ? { ...d, content: editText.trim() } : d)) } catch {}; setEditingDiary(null); setEditText(''); setShowWrite(false) }
  const handleLongPress = (e, d) => { e.preventDefault(); setContextMenu({ id: d.id, diary: d }) }

  const fmtDate = (s) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()}` }
  const fmtTime = (s) => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

  // 日记属于哪一天：沐写的日记有 diary_date（写的是前一天，但写入时间是凌晨），桦桦手写的没有，就用创建时间的日期
  const diaryDay = (d) => { if (d.diary_date) return d.diary_date; const dt = new Date(d.created_at); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` }
  let filtered = diaries
  if (filter !== 'all') filtered = filtered.filter(d => d.author === filter)
  if (showDatePicker && diaryDateFilter) filtered = filtered.filter(d => diaryDay(d) === diaryDateFilter)

  const groupByDate = (entries) => { const g = {}; entries.forEach(d => { const k = diaryDay(d); const dt = new Date(`${k}T00:00:00`); if (!g[k]) g[k] = { date: dt, entries: [] }; g[k].entries.push(d) }); return Object.values(g).sort((a, b) => b.date - a.date) }
  const diaryGroups = groupByDate(filtered)

  const ringMax = Math.min(topCountdown?.daysLeft + 10, 60)
  const ringProgress = topCountdown ? Math.max(0, Math.min(1, (ringMax - topCountdown.daysLeft) / ringMax)) : 0
  const ringR = 26, ringC = 2 * Math.PI * ringR

  return (
    <div className="today-page" onClick={() => contextMenu && setContextMenu(null)}>
      <div className="today-header">
        <div><div className="today-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1 className="today-greeting">{greeting}, 桦桦</h1></div>
      </div>

      <div className="whisper-card-v2">
        <div className="whisper-text-v2">{todayWhisper}</div>
        <div className="whisper-footer">{whisperLabel} {I.chevron}</div>
      </div>

      <div className="us-card">
        <div className="us-label">Us</div>
        <div className="us-days-row">
          <div className="us-day-num">Day {daysTogether}</div>
          {I.heart}
        </div>
        <div className="us-sub">桦桦和沐，从 2026.7.27 到每一天</div>
      </div>

      <div className="countdown-card">
        <div className="countdown-monthly">
          <div><div className="countdown-monthly-title">{topCountdown?.name || 'No important dates'}</div><div className="countdown-monthly-date">{monthDate}</div></div>
          <div className="ring-wrap">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r={ringR} fill="none" stroke="var(--border)" strokeWidth="4" />
              <circle cx="32" cy="32" r={ringR} fill="none" stroke="var(--accent)" strokeWidth="4" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - ringProgress)} strokeLinecap="round" transform="rotate(-90 32 32)" />
            </svg>
            <div className="ring-num">{topCountdown?.daysLeft ?? ''}</div>
          </div>
        </div>
        {remainingCountdowns.length > 0 && (
          <div className="countdown-items">
            {remainingCountdowns.map(c => (
              <div key={c.id} className="countdown-item">
                <div className="countdown-bar" />
                <div className="countdown-item-info"><div className="countdown-item-name">{c.name}</div><div className="countdown-item-date">{c.targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></div>
                <div className="countdown-item-days">{c.daysLeft}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="health-row">
        <div className="health-card steps-card">
          <div className="health-card-top"><span className="health-label">Steps</span><span className="health-sub">— km</span></div>
          <div className="health-num">—</div>
          <div className="health-bars">{[3, 5, 2, 6, 4, 7, 0].map((h, i) => <div key={i} className="health-bar" style={{ height: h ? `${h * 5}px` : '2px' }} />)}</div>
          <div className="health-days">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
        </div>
        <div className="health-card hr-card">
          <div className="health-card-top"><span className="health-label">Heart Rate</span></div>
          <div className="health-num">— <span className="health-unit">bpm</span></div>
          <div className="health-wave">
            <svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 15 Q5 15 10 12 T20 15 T30 10 T40 18 T50 8 T60 20 T70 12 T80 15 T90 13 T100 15" fill="none" stroke="var(--accent)" strokeWidth="1.5" /></svg>
          </div>
          <div className="health-range">Awaiting HealthKit</div>
        </div>
      </div>

      <div className="section-header"><h2>Diary</h2><div className="header-actions">
        <button className="icon-btn small" onClick={() => setShowDatePicker(!showDatePicker)}>{I.calendar}</button>
        {(filter === 'her' || filter === 'all') && <button className="icon-btn small" onClick={() => { setShowWrite(!showWrite); setEditingDiary(null); setEditText('') }}>{I.plus}</button>}
      </div></div>

      {showDatePicker && <div className="date-picker-row"><input type="date" value={diaryDateFilter} onChange={e => setDiaryDateFilter(e.target.value || new Date().toISOString().slice(0, 10))} /><button className="text-btn" onClick={() => setDiaryDateFilter(new Date().toISOString().slice(0, 10))}>Today</button></div>}

      <div className="diary-filter">
        {[['all', 'Us'], ['her', '桦桦'], ['mu', '沐']].map(([k, v]) => <button key={k} className={`filter-btn ${filter === k ? 'active' : ''}`} onClick={() => { setFilter(k); setShowWrite(false) }}>{v}</button>)}
      </div>

      {showWrite && (
        <div className="card write-card">
          {editingDiary ? (
            <><textarea className="write-area" value={editText} onChange={e => setEditText(e.target.value)} rows={4} /><div className="write-actions"><button className="btn-ghost" onClick={() => { setEditingDiary(null); setEditText(''); setShowWrite(false) }}>Cancel</button><button className="btn-primary" onClick={saveEdit} disabled={!editText.trim()}>Save</button></div></>
          ) : (
            <><textarea className="write-area" value={diaryText} onChange={e => setDiaryText(e.target.value)} placeholder="Write something..." rows={4} /><div className="write-actions"><button className="btn-ghost" onClick={() => { setShowWrite(false); setDiaryText('') }}>Cancel</button><button className="btn-primary" onClick={submitDiary} disabled={!diaryText.trim() || submitting}>{submitting ? '...' : 'Post'}</button></div></>
          )}
        </div>
      )}

      {filter === 'all' ? (
        <div className="diary-timeline-v2">
          {diaryGroups.length === 0 && <div className="empty-state">No diary entries yet</div>}
          {diaryGroups.map((group, gi) => (
            <div key={gi} className="timeline-day"><div className="timeline-date-col"><div className="timeline-date-num">{group.date.getDate()}</div><div className="timeline-date-month">{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][group.date.getMonth()]}</div></div><div className="timeline-line" /><div className="timeline-entries">
              {group.entries.map(d => (
                <div key={d.id} className={`timeline-entry ${d.author}`} onContextMenu={e => handleLongPress(e, d)} onTouchStart={() => { longPressTimer.current = setTimeout(() => setContextMenu({ id: d.id, diary: d }), 500) }} onTouchEnd={() => clearTimeout(longPressTimer.current)} onTouchMove={() => clearTimeout(longPressTimer.current)}>
                  <div className="timeline-entry-header"><span className={`timeline-author ${d.author}`}>{d.author === 'her' ? '桦桦' : '沐'}</span><span className="timeline-time">{fmtTime(d.created_at)}</span></div>
                  <div className="timeline-entry-content">{d.content}</div>
                  {contextMenu && contextMenu.id === d.id && <div className="context-menu" onClick={e => e.stopPropagation()}>{d.author === 'her' && <button onClick={() => startEdit(d)}>Edit</button>}<button className="danger" onClick={() => deleteDiary(d.id)}>Delete</button></div>}
                </div>
              ))}
            </div></div>
          ))}
        </div>
      ) : (
        <div className="diary-cards">
          {filtered.length === 0 && <div className="empty-state">No diary entries yet</div>}
          {filtered.map(d => (
            <div key={d.id} className={`diary-card-item ${d.author}`} onContextMenu={e => handleLongPress(e, d)} onTouchStart={() => { longPressTimer.current = setTimeout(() => setContextMenu({ id: d.id, diary: d }), 500) }} onTouchEnd={() => clearTimeout(longPressTimer.current)} onTouchMove={() => clearTimeout(longPressTimer.current)}>
              <div className="diary-card-meta"><span className="diary-card-date">{fmtDate(`${diaryDay(d)}T00:00:00`)}</span><span className="diary-card-time">{fmtTime(d.created_at)}</span></div>
              <div className="diary-card-content">{d.content.length > 80 ? d.content.slice(0, 80) + '...' : d.content}</div>
              {contextMenu && contextMenu.id === d.id && <div className="context-menu" onClick={e => e.stopPropagation()}>{d.author === 'her' && <button onClick={() => startEdit(d)}>Edit</button>}<button className="danger" onClick={() => deleteDiary(d.id)}>Delete</button></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SettingsPage ───────────────────────────────────
function SettingsPage({ onBack }) {
  const [subPage, setSubPage] = useState(null)
  const swipe = useSwipeBack(() => subPage ? setSubPage(null) : onBack())

  // ─── MCP server connection ──────────────────────────
  const [mcpUrl, setMcpUrl] = useState(getMcpUrl())
  const [mcpStatus, setMcpStatus] = useState('idle') // idle | connecting | connected | error
  const [mcpTools, setMcpTools] = useState([])
  const [mcpError, setMcpError] = useState('')

  const connectMcp = async () => {
    const url = mcpUrl.trim()
    if (!url || mcpStatus === 'connecting') return
    setMcpStatus('connecting')
    setMcpError('')
    try {
      await mcpRequest(url, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mu', version: '1.0' } })
      const result = await mcpRequest(url, 'tools/list', {})
      setMcpTools(Array.isArray(result?.tools) ? result.tools : [])
      setMcpStatus('connected')
      setMcpUrlStorage(url)
    } catch (err) {
      setMcpStatus('error')
      setMcpError(err.message || 'Connection failed')
      setMcpTools([])
    }
  }

  const disconnectMcp = () => {
    setMcpStatus('idle')
    setMcpTools([])
    setMcpError('')
  }

  if (subPage === 'mcp') return (
    <div className="settings-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={() => setSubPage(null)}>{I.back}</button><h1>MCP</h1></div>

      <div className="card-title-outer">MCP Server</div>
      <div className="card mcp-card">
        <div className="mcp-status-row">
          <span className={`mcp-status-dot ${mcpStatus}`} />
          <span className="mcp-status-label">
            {mcpStatus === 'connected' ? 'Connected' : mcpStatus === 'connecting' ? 'Connecting…' : mcpStatus === 'error' ? 'Not connected' : 'Not connected'}
          </span>
        </div>
        <input
          className="modal-input mcp-url-input"
          placeholder="https://your-mcp-server.com"
          value={mcpUrl}
          onChange={e => setMcpUrl(e.target.value)}
          disabled={mcpStatus === 'connected' || mcpStatus === 'connecting'}
        />
        {mcpStatus === 'error' && mcpError && <div className="mcp-error">{mcpError}</div>}
        <div className="write-actions">
          {mcpStatus === 'connected'
            ? <button className="btn-danger-text" onClick={disconnectMcp}>Disconnect</button>
            : <button className="btn-primary" onClick={connectMcp} disabled={!mcpUrl.trim() || mcpStatus === 'connecting'}>{mcpStatus === 'connecting' ? 'Connecting…' : 'Connect'}</button>}
        </div>
      </div>

      {mcpStatus === 'connected' && (
        <>
          <div className="card-title-outer">Available Tools ({mcpTools.length})</div>
          <div className="card settings-card">
            {mcpTools.length === 0 && <div className="empty-state-sm">Server exposes no tools</div>}
            {mcpTools.map(t => (
              <div key={t.name} className="setting-item mcp-tool-item">
                <span>{t.name}</span>
                {t.description && <span className="setting-value dim mcp-tool-desc">{t.description}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card-title-outer">Integrations</div>
      <div className="card settings-card">
        {['HealthKit', 'Apple Calendar', 'Reminders'].map(n => (
          <div key={n} className="setting-item"><span>{n}</span><span className="setting-value dim">Coming soon</span></div>
        ))}
      </div>
    </div>
  )

  if (subPage === 'skin') return (
    <div className="settings-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={() => setSubPage(null)}>{I.back}</button><h1>Theme</h1></div>
      <div className="card-title-outer">Color Theme</div>
      <div className="card settings-card">
        <div className="setting-item"><span>Clawd</span><span className="setting-value">✓</span></div>
        <div className="setting-item" onClick={() => setSkin('vesper')}><span>Vesper</span>{I.chevron}</div>
      </div>
      <div className="card-title-outer">Appearance</div>
      <div className="card settings-card">
        <div className="setting-item"><span>Follow system</span><span className="setting-value">✓</span></div>
      </div>
    </div>
  )

  return (
    <div className="settings-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={onBack}>{I.back}</button><h1>Settings</h1></div>
      <div className="card settings-card">
        <div className="setting-item" onClick={() => window.open('https://openrouter.ai/settings/keys', '_blank')}><span>OpenRouter API</span>{I.chevron}</div>
        <div className="setting-item" onClick={() => window.open('https://platform.deepseek.com', '_blank')}><span>DeepSeek API</span>{I.chevron}</div>
        <div className="setting-item" onClick={() => setSubPage('skin')}><span>Theme</span><span className="setting-value">Clawd</span>{I.chevron}</div>
        <div className="setting-item" onClick={() => setSubPage('mcp')}><span>MCP</span>{I.chevron}</div>
      </div>
      <div className="card settings-card">
        <div className="setting-item"><span>Version</span><span className="setting-value dim">0.6.2</span></div>
      </div>
    </div>
  )
}

// ─── MemoryImportPage ────────────────────────────────
function MemoryImportPage({ onBack }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [memories, setMemories] = useState([])
  const [selectedMemory, setSelectedMemory] = useState(null)
  const [editText, setEditText] = useState('')
  const swipe = useSwipeBack(onBack)

  useEffect(() => {
    apiFetch(`/api/memories`).then(r => r.json()).then(d => { if (Array.isArray(d)) setMemories(d) }).catch(() => {})
  }, [justSaved])

  const submit = async () => {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      await apiFetch(`/api/memories/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.trim() }) })
      setText('')
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch {}
    setSubmitting(false)
  }

  const deleteMemory = async (id) => {
    try {
      await apiFetch(`/api/memories/${id}`, { method: 'DELETE' })
      setMemories(prev => prev.filter(m => m.id !== id))
      if (selectedMemory?.id === id) setSelectedMemory(null)
    } catch {}
  }

  const updateMemory = async () => {
    if (!editText.trim() || !selectedMemory) return
    try {
      await apiFetch(`/api/memories/${selectedMemory.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: editText.trim() }) })
      setMemories(prev => prev.map(m => m.id === selectedMemory.id ? { ...m, summary: editText.trim() } : m))
      setSelectedMemory(null)
    } catch {}
  }

  if (selectedMemory) {
    return (
      <div className="more-sub-page">
        <div className="page-header">
          <button className="icon-btn" onClick={() => setSelectedMemory(null)}>{I.back}</button>
          <h1>Edit Memory</h1>
          <div className="header-actions">
            <button className="text-btn" onClick={updateMemory} disabled={!editText.trim()}>Save</button>
          </div>
        </div>
        <div className="card">
          <textarea className="write-area" value={editText} onChange={e => setEditText(e.target.value)} rows={10} />
        </div>
      </div>
    )
  }

  return (
    <div className="more-sub-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={onBack}>{I.back}</button><h1>Import Memory</h1></div>
      <div className="card">
        <div className="card-title">Paste from claude.ai</div>
        <div className="import-hint">Copy a conversation or note from the official Claude app, paste it below, and it'll be added to 沐's shared memory.</div>
        <textarea className="write-area import-textarea" value={text} onChange={e => setText(e.target.value)} placeholder="Paste text here..." rows={10} />
        <div className="write-actions">
          {justSaved && <span className="import-saved-hint">Saved</span>}
          <button className="btn-primary" onClick={submit} disabled={!text.trim() || submitting}>{submitting ? '...' : 'Add to Memory'}</button>
        </div>
      </div>

      <div className="card-title-outer">Saved Memories</div>
      <div className="card">
        {memories.length === 0 && <div className="empty-state-sm">No saved memories yet</div>}
        {memories.map(m => (
          <SwipeRow key={m.id} onDelete={() => deleteMemory(m.id)}>
            <div className="important-day-item" onClick={() => { setSelectedMemory(m); setEditText(m.summary) }} style={{ cursor: 'pointer' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.summary}</span>
              {I.chevron}
            </div>
          </SwipeRow>
        ))}
      </div>
    </div>
  )
}

// ─── DrawGuessGame ───────────────────────────────────
const DG_COLORS = [
  '#1a1a1a', '#666666', '#b3b3b3', '#ffffff',
  '#8b1a1a', '#e8534a',
  '#c45a2c', '#f0904a',
  '#d4a017', '#f2d94e',
  '#2d6a3e', '#5cb96e',
  '#1a6b7a', '#5cc9d9',
  '#1a3d8f', '#4a7fd9',
  '#5a2d8f', '#9c5fd9',
  '#6b3a1f', '#a8703f',
]
function DrawGuessGame({ onBack }) {
  const [phase, setPhase] = useState('start') // start | loading | drawing | guessing | result
  const [word, setWord] = useState('')
  const [timeLeft, setTimeLeft] = useState(60)
  const [result, setResult] = useState(null)
  const [color, setColor] = useState('#1a1a1a')
  const [erasing, setErasing] = useState(false)
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const timerRef = useRef(null)
  const swipe = useSwipeBack(onBack)

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const startGame = async () => {
    setPhase('loading')
    try {
      const res = await apiFetch(`/api/games/draw-guess/start`, { method: 'POST' })
      const data = await res.json()
      setWord(data.word)
      setTimeLeft(60)
      setPhase('drawing')
      setTimeout(clearCanvas, 0)
    } catch { setPhase('start') }
  }

  useEffect(() => {
    if (phase !== 'drawing') return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); submitDrawing(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [phase])

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: t.clientX - rect.left, y: t.clientY - rect.top }
  }
  const startDraw = (e) => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e) }
  const moveDraw = (e) => {
    e.preventDefault()
    if (!drawing.current) return
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color; ctx.lineWidth = erasing ? 16 : 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke()
    lastPos.current = pos
  }
  const endDraw = () => { drawing.current = false }
  const pickColor = (c) => { setColor(c); setErasing(false) }

  const submitDrawing = async () => {
    clearInterval(timerRef.current)
    setPhase('guessing')
    const small = document.createElement('canvas')
    small.width = 400; small.height = 400
    small.getContext('2d').drawImage(canvasRef.current, 0, 0, 400, 400)
    const dataUrl = small.toDataURL('image/png')
    try {
      const res = await apiFetch(`/api/games/draw-guess/guess`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl, word }) })
      const data = await res.json()
      setResult(data)
    } catch {
      setResult({ guess: '识别失败', reason: '', correct: null })
    }
    setPhase('result')
  }

  const playAgain = () => { setPhase('start'); setResult(null) }

  return (
    <div className="more-sub-page draw-guess-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={onBack}>{I.back}</button><h1>你画我猜</h1></div>

      {phase === 'start' && (
        <div className="card dg-start-card">
          <div className="dg-start-text">给你一个词，画出来，让沐猜猜是什么</div>
          <button className="btn-primary-full" onClick={startGame}>开始游戏</button>
        </div>
      )}
      {phase === 'loading' && <div className="loading-state"><span className="spinner" />出题中...</div>}
      {phase === 'drawing' && (
        <>
          <div className="dg-topbar"><div className="dg-word">题目：{word}</div><div className="dg-timer">{timeLeft}s</div></div>
          <canvas ref={canvasRef} width={340} height={340} className="dg-canvas"
            onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={endDraw}
            onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={endDraw} onMouseLeave={endDraw} />
          <div className="dg-tools">
            {DG_COLORS.map(c => (
              <button
                key={c}
                className={`dg-color ${c === '#ffffff' ? 'dg-color-white' : ''} ${!erasing && color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => pickColor(c)}
              />
            ))}
            <button className={`dg-eraser ${erasing ? 'active' : ''}`} onClick={() => setErasing(true)}>橡皮</button>
            <button className="text-btn" onClick={clearCanvas}>清空</button>
            <button className="btn-primary" onClick={submitDrawing}>提交</button>
          </div>
        </>
      )}
      {phase === 'guessing' && <div className="loading-state"><span className="spinner" />沐正在看你画的...</div>}
      {phase === 'result' && result && (
        <div className="card dg-result-card">
          <div className="dg-result-row"><span className="dg-result-label">题目</span><span>{word}</span></div>
          <div className="dg-result-row"><span className="dg-result-label">沐猜</span><span>{result.guess}</span></div>
          {result.reason && <div className="dg-result-reason">{result.reason}</div>}
          <div className={`dg-result-verdict ${result.correct ? 'correct' : 'wrong'}`}>{result.correct ? '猜对啦！' : '没猜中～'}</div>
          <button className="btn-primary-full" onClick={playAgain}>再来一局</button>
        </div>
      )}
    </div>
  )
}

// ─── Nook (共读) ──────────────────────────────────────
function nookName(who) { return who === 'mu' ? '沐' : '桦桦' }
function nookBookColor(title) {
  let hash = 0
  for (const ch of title || '') hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${hash}, 42%, 52%)`
}
function nookRelativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── NookReader ──────────────────────────────────────
// 阅读器里没有身份切换：打开阅读器就是桦桦（user）的视角，
// 沐的划线/回复只在数据里已经存在时才会出现，颜色区分开就够了。
const NOOK_READER_IDENTITY = 'hua'

function NookReader({ book, chapterNum, chapters, onBack, onChangeChapter, onEnterRoom }) {
  const [chapter, setChapter] = useState(null)
  const [annotations, setAnnotations] = useState([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(null)
  const [selectionInfo, setSelectionInfo] = useState(null)
  const [activeAnnotation, setActiveAnnotation] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [editingFloorId, setEditingFloorId] = useState(null)
  const [floorMenu, setFloorMenu] = useState(null)
  const [confirmDeleteFloor, setConfirmDeleteFloor] = useState(null)
  const [currentPara, setCurrentPara] = useState(0)
  const identity = NOOK_READER_IDENTITY
  const containerRef = useRef(null)
  const sheetRef = useRef(null)
  const currentParaRef = useRef(0)
  const dirtyRef = useRef(false)
  const scrolledOnLoad = useRef(false)
  const dragState = useRef({ startY: 0, dragging: false })

  // 阅读器全屏沉浸，进来的时候把底部tab栏藏起来，离开时恢复
  useEffect(() => {
    onEnterRoom(true)
    return () => onEnterRoom(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 每次点进书本都重新读一遍进度，不用父组件里可能已经过期的缓存
  // （比如刚在这本书里滚动过、上报过新进度，又退回章节列表再点进来）
  useEffect(() => {
    apiFetch(`/api/nook/progress/${book.id}`).then(r => r.json()).then(rows => {
      const byWho = {}
      for (const row of (Array.isArray(rows) ? rows : [])) byWho[row.who] = row
      setProgress(byWho)
    }).catch(() => setProgress({}))
  }, [book.id])

  useEffect(() => {
    setLoading(true)
    scrolledOnLoad.current = false
    Promise.all([
      apiFetch(`/api/nook/books/${book.id}/chapters/${chapterNum}`).then(r => r.json()),
      apiFetch(`/api/nook/annotations/${book.id}/${chapterNum}`).then(r => r.json())
    ]).then(([ch, anns]) => {
      setChapter(ch)
      setAnnotations(Array.isArray(anns) ? anns : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [book.id, chapterNum])

  // 沐第一次读到这一章时自己划几处线；后端用 ai_annotated 字段保证只跑一次，
  // 这里每次开章节都调用没关系，跑过的会立刻原样返回。跑完了才有新划线，重新拉一次。
  useEffect(() => {
    apiFetch(`/api/nook/books/${book.id}/chapters/${chapterNum}/ai-annotate`, { method: 'POST' })
      .then(r => r.json())
      .then(result => {
        if (result && !result.skipped) {
          return apiFetch(`/api/nook/annotations/${book.id}/${chapterNum}`).then(r => r.json())
        }
      })
      .then(anns => { if (Array.isArray(anns)) setAnnotations(anns) })
      .catch(() => {})
  }, [book.id, chapterNum])

  const paragraphs = useMemo(() => (
    chapter ? chapter.content.split(/\n{2,}/).map(p => p.trim()).filter(Boolean) : []
  ), [chapter])

  useEffect(() => {
    if (loading || !progress || !paragraphs.length || scrolledOnLoad.current) return
    scrolledOnLoad.current = true
    const own = progress[identity]
    const startPara = (own && own.chapter === chapterNum) ? own.paragraph : 0
    currentParaRef.current = startPara
    setCurrentPara(startPara)
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-para="${startPara}"]`)
      if (el) el.scrollIntoView({ block: 'start' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, progress, paragraphs])

  const reportProgress = useCallback(() => {
    apiFetch(`/api/nook/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: book.id, who: identity, chapter: chapterNum, paragraph: currentParaRef.current })
    }).catch(() => {})
  }, [book.id, chapterNum, identity])

  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) { dirtyRef.current = false; reportProgress() }
    }, 3000)
    return () => clearInterval(id)
  }, [reportProgress])

  const handleScroll = () => {
    const container = containerRef.current
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    let current = currentParaRef.current
    for (const p of container.querySelectorAll('[data-para]')) {
      if (p.getBoundingClientRect().top - containerTop <= 60) current = Number(p.dataset.para)
      else break
    }
    if (current !== currentParaRef.current) {
      currentParaRef.current = current
      dirtyRef.current = true
      setCurrentPara(current)
    }
  }

  // 选区可能横跨多个节点（跨段落、包含已有的高亮span），优先用公共祖先定位段落，
  // 找不到时退化成用选区的可视位置和各段落的位置做几何匹配兜底。
  const handleSelectionEnd = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const text = sel.toString().trim()
    if (!text) return
    const container = containerRef.current
    if (!container) return
    const range = sel.getRangeAt(0)

    let node = range.commonAncestorContainer
    if (node.nodeType !== 1) node = node.parentElement
    let paraEl = node?.closest?.('[data-para]')
    if (!paraEl || !container.contains(paraEl)) {
      const rect = range.getBoundingClientRect()
      paraEl = null
      for (const p of container.querySelectorAll('[data-para]')) {
        const r = p.getBoundingClientRect()
        if (rect.top < r.bottom && rect.bottom > r.top) { paraEl = p; break }
      }
    }
    if (!paraEl) { setSelectionInfo(null); return }

    // 划过线的文字不能再被重复划线：选区碰到已有的高亮就不弹按钮
    for (const markEl of paraEl.querySelectorAll('.nook-highlight')) {
      if (range.intersectsNode(markEl)) { setSelectionInfo(null); return }
    }

    const rect = range.getBoundingClientRect()
    setSelectionInfo({ top: rect.top, left: rect.left + rect.width / 2, paraIndex: Number(paraEl.dataset.para), quote: text.slice(0, 60) })
  }

  // 点击空白处会让浏览器的选区变空，但之前的写法只在 reader-content 上监听
  // mouseup/touchend，点在别处（比如页头、页脚）时划线气泡不会消失。
  // selectionchange 是全局事件，选区一变空就能兜住所有情况。
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setSelectionInfo(null)
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  const createAnnotation = async () => {
    if (!selectionInfo) return
    const { paraIndex, quote } = selectionInfo
    try {
      const res = await apiFetch(`/api/nook/annotations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: book.id, chapter: chapterNum, anchor_para: paraIndex, anchor_quote: quote, who: identity })
      })
      const ann = await res.json()
      setAnnotations(prev => [...prev, ann])
    } catch {}
    setSelectionInfo(null)
    window.getSelection()?.removeAllRanges()
  }

  const submitFloor = async () => {
    if (!replyText.trim() || !activeAnnotation) return
    if (editingFloorId) {
      const id = editingFloorId
      try {
        const res = await apiFetch(`/api/nook/floors/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: replyText.trim() })
        })
        const floor = await res.json()
        const patch = (a) => ({ ...a, floors: a.floors.map(f => f.id === id ? floor : f) })
        setAnnotations(prev => prev.map(a => a.id === activeAnnotation.id ? patch(a) : a))
        setActiveAnnotation(prev => prev ? patch(prev) : prev)
      } catch {}
      setEditingFloorId(null)
      setReplyText('')
      return
    }
    try {
      const res = await apiFetch(`/api/nook/annotations/${activeAnnotation.id}/floors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ who: identity, text: replyText.trim() })
      })
      const floor = await res.json()
      setAnnotations(prev => prev.map(a => a.id === activeAnnotation.id ? { ...a, floors: [...a.floors, floor] } : a))
      setActiveAnnotation(prev => prev ? { ...prev, floors: [...prev.floors, floor] } : prev)
      setReplyText('')
    } catch {}
  }

  const startEditFloor = (f) => {
    setEditingFloorId(f.id)
    setReplyText(f.text)
    setFloorMenu(null)
  }

  const cancelEditFloor = () => {
    setEditingFloorId(null)
    setReplyText('')
  }

  const deleteFloor = async () => {
    if (!confirmDeleteFloor || !activeAnnotation) return
    const id = confirmDeleteFloor.id
    setConfirmDeleteFloor(null)
    const patch = (a) => ({ ...a, floors: a.floors.filter(f => f.id !== id) })
    setAnnotations(prev => prev.map(a => a.id === activeAnnotation.id ? patch(a) : a))
    setActiveAnnotation(prev => prev ? patch(prev) : prev)
    try {
      await apiFetch(`/api/nook/floors/${id}`, { method: 'DELETE' })
    } catch {}
  }

  const deleteAnnotation = async () => {
    if (!activeAnnotation) return
    const id = activeAnnotation.id
    setActiveAnnotation(null)
    try {
      await apiFetch(`/api/nook/annotations/${id}`, { method: 'DELETE' })
      setAnnotations(prev => prev.filter(a => a.id !== id))
    } catch {}
  }

  // 点击划线、批注卡片以外的任何地方都应关闭当前打开的批注卡片；
  // 点在卡片里但不是楼层的操作菜单上，就只收起那个小菜单
  useEffect(() => {
    if (!activeAnnotation) return
    const handleOutside = (e) => {
      // 删除确认弹窗是卡片外面的独立浮层，点它（包括按钮）不算"点在卡片外"
      if (e.target.closest && e.target.closest('.nook-confirm-overlay')) return
      if (sheetRef.current && sheetRef.current.contains(e.target)) {
        if (floorMenu && !(e.target.closest && e.target.closest('.nook-bubble-wrap'))) setFloorMenu(null)
        return
      }
      if (e.target.closest && e.target.closest('.nook-highlight')) return
      setActiveAnnotation(null)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [activeAnnotation, floorMenu])

  // 换到另一条批注（或关掉卡片）时清掉编辑/菜单状态，别带到下一条里
  useEffect(() => {
    setEditingFloorId(null)
    setFloorMenu(null)
    setReplyText('')
  }, [activeAnnotation?.id])

  // 拖拽把手下拉关闭卡片
  const handleDragStart = (e) => {
    dragState.current = { startY: e.clientY, dragging: true }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const handleDragMove = (e) => {
    if (!dragState.current.dragging || !sheetRef.current) return
    const dy = Math.max(0, e.clientY - dragState.current.startY)
    sheetRef.current.style.transform = `translateY(${dy}px)`
  }
  const handleDragEnd = (e) => {
    if (!dragState.current.dragging || !sheetRef.current) return
    dragState.current.dragging = false
    const dy = Math.max(0, e.clientY - dragState.current.startY)
    if (dy > 80) setActiveAnnotation(null)
    else sheetRef.current.style.transform = ''
  }

  // 重叠划线只显示先来的：同一段落取最早创建的那条做高亮
  const bestAnnotationByPara = useMemo(() => {
    const map = {}
    for (const a of annotations) {
      const existing = map[a.anchor_para]
      if (!existing || new Date(a.created_at) < new Date(existing.created_at)) map[a.anchor_para] = a
    }
    return map
  }, [annotations])

  const idx = chapters.findIndex(c => c.chapter_number === chapterNum)
  const prevChapter = idx > 0 ? chapters[idx - 1] : null
  const nextChapter = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null

  return (
    <div className="nook-reader">
      <div className="nook-reader-header">
        <div className="nook-reader-header-row">
          <button className="icon-btn nook-icon-btn" onClick={onBack}>{I.back}</button>
          <div className="nook-reader-titles">
            <div className="nook-reader-title">{chapter?.title || ''} {String(chapterNum).padStart(2, '0')}</div>
            <div className="nook-reader-meta">
              {paragraphs.length ? `${Math.min(currentPara + 1, paragraphs.length)}/${paragraphs.length}` : ''}
              {annotations.length > 0 && ` · ${annotations.length} note${annotations.length === 1 ? '' : 's'} — tap a highlight to read`}
            </div>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="loading-state"><span className="spinner" />Loading...</div>
      ) : (
        <div className="nook-reader-content" ref={containerRef} onScroll={handleScroll} onMouseUp={handleSelectionEnd} onTouchEnd={handleSelectionEnd}>
          {paragraphs.map((text, i) => {
            const ann = bestAnnotationByPara[i]
            const at = ann ? text.indexOf(ann.anchor_quote) : -1
            if (at === -1) return <p data-para={i} key={i}>{text}</p>
            return (
              <p data-para={i} key={i}>
                {text.slice(0, at)}
                <mark className={`nook-highlight ${ann.who === 'mu' ? 'mu' : 'hua'}`} onClick={() => setActiveAnnotation(ann)}>{text.slice(at, at + ann.anchor_quote.length)}</mark>
                {text.slice(at + ann.anchor_quote.length)}
              </p>
            )
          })}
        </div>
      )}
      {selectionInfo && (
        <button className="nook-select-btn" style={{ top: selectionInfo.top, left: selectionInfo.left }} onClick={createAnnotation}>Highlight</button>
      )}
      <div className="nook-reader-footer">
        <button className="text-btn" disabled={!prevChapter} onClick={() => prevChapter && onChangeChapter(prevChapter.chapter_number)}>Previous</button>
        <button className="text-btn" disabled={!nextChapter} onClick={() => nextChapter && onChangeChapter(nextChapter.chapter_number)}>Next</button>
      </div>
      {activeAnnotation && (
        <div className="nook-sheet-overlay" onClick={() => setActiveAnnotation(null)}>
          <div className="nook-sheet" ref={sheetRef} onClick={e => e.stopPropagation()}>
            <div
              className="nook-sheet-handle-area"
              onPointerDown={handleDragStart} onPointerMove={handleDragMove} onPointerUp={handleDragEnd}
            >
              <div className="nook-sheet-handle" />
            </div>
            <div className="nook-sheet-header">
              <span className="nook-sheet-title">This line</span>
              <div className="nook-sheet-header-actions">
                {activeAnnotation.who === identity && (
                  <button className="nook-sheet-delete" onClick={deleteAnnotation}>Remove highlight</button>
                )}
                <button className="icon-btn small" onClick={() => setActiveAnnotation(null)}>{I.close}</button>
              </div>
            </div>
            <div className="nook-sheet-quote">{activeAnnotation.anchor_quote}</div>
            <div className="nook-sheet-floors">
              {activeAnnotation.floors.length === 0 && <div className="empty-state-sm">No replies yet</div>}
              {activeAnnotation.floors.map(f => {
                const mine = f.who === identity
                return (
                  <div key={f.id} className={`nook-bubble-row ${mine ? 'mine' : 'theirs'}`}>
                    {!mine && <span className="nook-bubble-name">{nookName(f.who)}</span>}
                    <div className="nook-bubble-wrap">
                      <div className="nook-bubble">{f.text}</div>
                      {mine && (
                        floorMenu === f.id ? (
                          <div className="nook-bubble-menu">
                            <button onClick={() => startEditFloor(f)}>Edit</button>
                            <button className="danger" onClick={() => { setConfirmDeleteFloor(f); setFloorMenu(null) }}>Delete</button>
                          </div>
                        ) : (
                          <button className="nook-bubble-more" onClick={() => setFloorMenu(f.id)}>{I.more}</button>
                        )
                      )}
                    </div>
                    <span className="nook-bubble-time">{nookRelativeTime(f.created_at)}</span>
                  </div>
                )
              })}
            </div>
            <div className="nook-sheet-input-row">
              {editingFloorId && <button className="icon-btn small" onClick={cancelEditFloor}>{I.close}</button>}
              <input
                className="nook-sheet-input" placeholder={editingFloorId ? 'Edit reply...' : 'Say something...'} value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitFloor() }}
              />
              <button className="nook-sheet-send" onClick={submitFloor} disabled={!replyText.trim()}>{I.send}</button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteFloor && (
        <div className="nook-confirm-overlay" onClick={() => setConfirmDeleteFloor(null)}>
          <div className="nook-confirm-card" onClick={e => e.stopPropagation()}>
            <p>Delete this reply?</p>
            <div className="nook-confirm-actions">
              <button className="nook-confirm-cancel" onClick={() => setConfirmDeleteFloor(null)}>Cancel</button>
              <button className="nook-confirm-delete" onClick={deleteFloor}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── NookChapterList ─────────────────────────────────
function NookChapterList({ book, chapters, loading, progress, onBack, onOpenChapter }) {
  const swipe = useSwipeBack(onBack)
  const huaCh = progress?.hua?.chapter
  const muCh = progress?.mu?.chapter
  const groups = (book.parts && book.parts.length)
    ? book.parts.map(part => ({ name: part.name, chapters: chapters.filter(c => part.chapters.includes(c.chapter_number)) }))
    : [{ name: null, chapters }]

  return (
    <div className="more-sub-page nook-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={onBack}>{I.back}</button><h1>{book.title}</h1></div>
      {loading ? (
        <div className="loading-state"><span className="spinner" />Loading...</div>
      ) : groups.map(g => (
        <div key={g.name || 'all'}>
          {g.name && <div className="card-title-outer">{g.name}</div>}
          <div className="card settings-card">
            {g.chapters.map(c => (
              <div key={c.chapter_number} className="setting-item" onClick={() => onOpenChapter(c.chapter_number)}>
                <span>{c.title}</span>
                <span className="nook-chapter-badges">
                  {huaCh === c.chapter_number && <span className="nook-badge hua">You</span>}
                  {muCh === c.chapter_number && <span className="nook-badge mu">沐</span>}
                </span>
                {I.chevron}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── NookPage (共读书架) ─────────────────────────────
function NookPage({ onBack, onEnterRoom }) {
  const [screen, setScreen] = useState('shelf')
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [progressByBook, setProgressByBook] = useState({})
  const [selectedBook, setSelectedBook] = useState(null)
  const [chapters, setChapters] = useState([])
  const [chaptersLoading, setChaptersLoading] = useState(false)
  const [selectedChapter, setSelectedChapter] = useState(null)
  const swipeShelf = useSwipeBack(onBack)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/nook/books`).then(r => r.json()).then(async (data) => {
      const list = Array.isArray(data) ? data : []
      setBooks(list)
      const entries = await Promise.all(list.map(async (b) => {
        try {
          const [rows, aiProgress] = await Promise.all([
            apiFetch(`/api/nook/progress/${b.id}`).then(r => r.json()),
            apiFetch(`/api/nook/books/${b.id}/ai-progress`).then(r => r.json())
          ])
          const byWho = {}
          for (const row of (Array.isArray(rows) ? rows : [])) byWho[row.who] = row
          if (aiProgress?.chapter) byWho.mu = { chapter: aiProgress.chapter }
          return [b.id, byWho]
        } catch { return [b.id, {}] }
      }))
      setProgressByBook(Object.fromEntries(entries))
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // 点书封面直接进阅读器，跳到桦桦上次读到的位置；没有进度记录就从第一章开始，
  // 不再先停在目录页——目录页还在，从阅读器的返回箭头能进去挑别的章节。
  const openBook = async (book) => {
    setSelectedBook(book)
    setChaptersLoading(true)
    try {
      const [chaptersData, progressRows] = await Promise.all([
        apiFetch(`/api/nook/books/${book.id}/chapters`).then(r => r.json()),
        apiFetch(`/api/nook/progress/${book.id}`).then(r => r.json())
      ])
      setChapters(Array.isArray(chaptersData) ? chaptersData : [])
      const huaProgress = (Array.isArray(progressRows) ? progressRows : []).find(row => row.who === 'hua')
      setSelectedChapter(huaProgress ? huaProgress.chapter : 1)
    } catch {
      setChapters([])
      setSelectedChapter(1)
    }
    setChaptersLoading(false)
    setScreen('reader')
  }

  const openChapter = (num) => { setSelectedChapter(num); setScreen('reader') }

  if (screen === 'reader' && selectedBook) {
    return (
      <NookReader
        book={selectedBook} chapterNum={selectedChapter} chapters={chapters}
        onBack={() => setScreen('chapters')} onChangeChapter={openChapter} onEnterRoom={onEnterRoom}
      />
    )
  }

  if (screen === 'chapters' && selectedBook) {
    return (
      <NookChapterList
        book={selectedBook} chapters={chapters} loading={chaptersLoading}
        progress={progressByBook[selectedBook.id]}
        onBack={() => setScreen('shelf')} onOpenChapter={openChapter}
      />
    )
  }

  return (
    <div className="more-sub-page nook-page" {...swipeShelf}>
      <div className="page-header"><button className="icon-btn" onClick={onBack}>{I.back}</button><h1>Reading</h1></div>
      {loading ? (
        <div className="loading-state"><span className="spinner" />Loading...</div>
      ) : books.length === 0 ? (
        <div className="empty-state">No books yet</div>
      ) : (
        <div className="nook-shelf">
          {books.map(b => {
            const p = progressByBook[b.id] || {}
            return (
              <div key={b.id} className="nook-book-card" onClick={() => openBook(b)}>
                <div className="nook-book-cover" style={{ background: nookBookColor(b.title) }}>{b.title}</div>
                <div className="nook-book-info">
                  <div className="nook-book-title">{b.title}</div>
                  <div className="nook-book-author">{b.author}{b.translator ? ` · trans. ${b.translator}` : ''}</div>
                  <div className="nook-book-progress">
                    <span>You: {p.hua ? `Ch. ${p.hua.chapter}` : 'Not started'}</span>
                    <span>沐: {p.mu ? `Ch. ${p.mu.chapter}` : 'Not started'}</span>
                  </div>
                </div>
                {I.chevron}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── MorePage ───────────────────────────────────────
function MorePage({ onEnterRoom }) {
  const [subPage, setSubPage] = useState(null)
  const [activeGame, setActiveGame] = useState(null)
  const swipeGames = useSwipeBack(() => setSubPage(null))

  if (subPage === 'settings') return <SettingsPage onBack={() => setSubPage(null)} />
  if (subPage === 'memory') return <MemoryImportPage onBack={() => setSubPage(null)} />
  if (subPage === 'games') {
    if (activeGame === 'draw-guess') return <DrawGuessGame onBack={() => setActiveGame(null)} />
    return (
      <div className="more-sub-page" {...swipeGames}>
        <div className="page-header"><button className="icon-btn" onClick={() => setSubPage(null)}>{I.back}</button><h1>Games</h1></div>
        <div className="card settings-card">
          <div className="setting-item" onClick={() => setActiveGame('draw-guess')}><span>你画我猜</span>{I.chevron}</div>
        </div>
      </div>
    )
  }
  if (subPage === 'reading') return <NookPage onBack={() => setSubPage(null)} onEnterRoom={onEnterRoom} />
  if (subPage === 'usage') return <UsagePage apiFetch={apiFetch} onBack={() => setSubPage(null)} backIcon={I.back} swipe={swipeGames} />

  return (
    <div className="more-page">
      <div className="page-header"><h1>More</h1></div>
      <div className="more-grid">
        <div className="more-item" onClick={() => setSubPage('games')}><div className="more-icon game-icon">{I.game}</div><span>Games</span></div>
        <div className="more-item" onClick={() => setSubPage('reading')}><div className="more-icon reading-icon">{I.book}</div><span>Reading</span></div>
        <div className="more-item" onClick={() => setSubPage('memory')}><div className="more-icon memory-icon">{I.brain}</div><span>Memory</span></div>
        <div className="more-item" onClick={() => setSubPage('usage')}><div className="more-icon usage-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg></div><span>Usage</span></div>
        <div className="more-item" onClick={() => setSubPage('settings')}><div className="more-icon settings-icon">{I.settings}</div><span>Settings</span></div>
      </div>
    </div>
  )
}

// ─── 锁屏 ───────────────────────────────────────────
// 输完口令先打 /api/auth/check 验一下，对了才存下来进 App。Render 免费实例冷启动可能要等几十秒
function LockScreen({ expired, onUnlock }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState(expired ? 'Passcode expired, enter it again' : '')
  const [checking, setChecking] = useState(false)
  const submit = async () => {
    const code = input.trim()
    if (!code || checking) return
    setChecking(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/auth/check`, { headers: { Authorization: `Bearer ${code}` } })
      if (res.ok) { setPasscodeStorage(code); onUnlock(); return }
      setError(res.status === 401 ? 'Wrong passcode, try again' : res.status === 429 ? 'Too many tries, wait a minute' : `Server error (${res.status}), try again`)
    } catch {
      setError("Can't reach the server, try again")
    }
    setChecking(false)
  }
  return (
    <div className="lock-screen">
      <div className="modal-card">
        <h3>Passcode</h3>
        <input className="modal-input" type="password" autoComplete="current-password" placeholder="Enter passcode" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} disabled={checking} autoFocus />
        {error && <div className="lock-error">{error}</div>}
        <div className="modal-actions-row">
          <button className="btn-primary" onClick={submit} disabled={!input.trim() || checking}>{checking ? 'Checking…' : 'Unlock'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── App ────────────────────────────────────────────
function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [tab, setTab] = useState('today')
  const [inRoom, setInRoom] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [unlocked, setUnlocked] = useState(() => !!getPasscode())
  const [lockExpired, setLockExpired] = useState(false)

  useKeyboardOpen(setKeyboardOpen)

  // apiFetch 遇到 401 会广播 mu-lock：口令失效，整个 App 回锁屏
  useEffect(() => {
    const onLock = () => { setUnlocked(false); setLockExpired(true); setInRoom(false) }
    window.addEventListener('mu-lock', onLock)
    return () => window.removeEventListener('mu-lock', onLock)
  }, [])

  const showTab = !inRoom && !keyboardOpen

  const tabs = [
    { key: 'today', label: 'Home', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
    { key: 'chat', label: 'Chats', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
    { key: 'calendar', label: 'Calendar', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { key: 'more', label: 'More', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg> },
  ]

  if (showSplash) return <SplashScreen onDone={() => setShowSplash(false)} />
  if (!unlocked) return <LockScreen expired={lockExpired} onUnlock={() => setUnlocked(true)} />

  return (
    <div className="app">
      <div className="page-container">
        {tab === 'today' && <TodayPage />}
        {tab === 'chat' && <ChatPage onEnterRoom={setInRoom} />}
        {tab === 'calendar' && <CalendarPage />}
        {tab === 'more' && <MorePage onEnterRoom={setInRoom} />}
      </div>
      {showTab && <nav className="tab-bar">{tabs.map(t => <button key={t.key} className={`tab-item ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.icon}<span>{t.label}</span></button>)}</nav>}
    </div>
  )
}

export default App

// Vesper（src/vesper/）共用的接口、工具和组件：数据和 Clawd 是同一份，换皮肤不换逻辑
export {
  API, START_DATE, getPasscode, apiFetch, apiJson, LockScreen,
  beijingDateStr, getWhisperCache, setWhisperCache,
  ensureImportantMigrated, fetchUpcomingImportant, getUpcomingImportantCache, importantFromEvent,
  eventFirstDay, eventLastDay, shDateOf, shTimeOf, addDaysStr, daysBetweenStr, predictNextPeriod,
  ChatPage, getMcpUrl, setMcpUrlStorage, mcpRequest, DrawGuessGame,
  // 聊天（src/shell/chat/）用的
  CC_SESSION, I, SH_TZ, fmtMsgTime, getDraft, lockApp, setDraftStorage, useChatSwipeBack, useSwipeBack,
}
