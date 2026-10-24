import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import { UsagePage, CcLimitedNotice, useCcUsageBrief } from './Usage'
import { setSkin } from './skin.js'
import { loadDraftFiles, saveDraftFiles, draftFileCount } from './draftFiles.js'

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

// ─── Global focus-based keyboard/tab-bar visibility ──
function useKeyboardOpen(setKeyboardOpen) {
  useEffect(() => {
    const onFocusIn = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') setKeyboardOpen(true) }
    const onFocusOut = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') setTimeout(() => setKeyboardOpen(false), 50) }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => { document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut) }
  }, [setKeyboardOpen])
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
// ─── Voice audio duration resolution ────────────────
// Blob-sourced MP3s in Chrome often report duration as Infinity until
// the media element is forced to seek near the end once, a known
// workaround for the missing/streamed-duration metadata bug.
function resolveAudioDuration(audio, cb) {
  const tryFinalize = () => {
    if (isFinite(audio.duration) && audio.duration > 0) { cb(audio.duration); return true }
    return false
  }
  const onLoaded = () => {
    audio.removeEventListener('loadedmetadata', onLoaded)
    if (tryFinalize()) return
    const onTimeUpdate = () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.currentTime = 0
      tryFinalize()
    }
    audio.addEventListener('timeupdate', onTimeUpdate)
    try { audio.currentTime = 1e101 } catch { /* ignore */ }
  }
  audio.addEventListener('loadedmetadata', onLoaded)
}

const VOICE_MIN_WIDTH = 120
const VOICE_MAX_WIDTH = 320
function voiceBarWidth(duration) {
  if (duration == null || !isFinite(duration)) return VOICE_MIN_WIDTH
  return Math.min(VOICE_MAX_WIDTH, Math.max(VOICE_MIN_WIDTH, VOICE_MIN_WIDTH + duration * 15))
}

// 说话者自己决定哪句用声音说：<voice>英文</voice><voice_zh>中文翻译</voice_zh>，其余是普通文字。
// 按原顺序拆成 { type: 'text', text } / { type: 'voice', text, zh }。ElevenLabs 只念非中文，
// 所以 <voice> 里要是写成了中文，就退回成普通文字显示。
const VOICE_TAG_RE = /<voice>([\s\S]*?)<\/voice>\s*(?:<voice_zh>([\s\S]*?)<\/voice_zh>)?/g
function parseVoiceSegments(raw) {
  const segs = []
  if (!raw) return segs
  const pushText = (t) => {
    t = t.replace(/<\/?voice(_zh)?>/g, '').trim()
    if (t) segs.push({ type: 'text', text: t })
  }
  let last = 0
  for (const m of raw.matchAll(VOICE_TAG_RE)) {
    pushText(raw.slice(last, m.index))
    const text = m[1].trim()
    const zh = (m[2] || '').trim()
    if (text && !/[\u4e00-\u9fff]/.test(text)) segs.push({ type: 'voice', text, zh })
    else pushText(text)
    last = m.index + m[0].length
  }
  pushText(raw.slice(last))
  return segs
}
// 转文字只显示说的话：[softly]、[sighs] 这类音频标签是给 ElevenLabs 的，不给人看
function stripAudioTags(text) {
  return text.replace(/\[[^\]\n]*\]\s*/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}
function hasVoiceSegment(raw) {
  return parseVoiceSegments(raw).some(seg => seg.type === 'voice')
}
function estimateVoiceDurations(msgKey, raw, fetchDurationEstimate) {
  parseVoiceSegments(raw).forEach((seg, si) => { if (seg.type === 'voice') fetchDurationEstimate(`${msgKey}:${si}`, seg.text) })
}

// ─── Copy ───────────────────────────────────────────
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* 旧浏览器/非 https：走下面的兜底 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}
function CopyButton({ getText, className = 'copy-btn', label }) {
  const [done, setDone] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const onClick = async (e) => {
    e.stopPropagation()
    if (!(await copyText(getText()))) return
    setDone(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(false), 1500)
  }
  return <button className={className} onClick={onClick} aria-label="Copy">{done ? I.check : I.copy}{label && <span>{done ? 'Copied' : label}</span>}</button>
}
// 一条消息复制出去的文字：去掉 <voice> 标签，语音段留说的话（方括号音频标签也去掉）
function messageCopyText(raw) {
  return parseVoiceSegments(raw).map(seg => seg.type === 'voice' ? stripAudioTags(seg.text) : seg.text).join('\n\n')
}

// ─── Markdown（不引依赖，只做聊天里用得到的那部分）──
// 强调只认 *，不认 _：颜文字里全是下划线。* 后面必须紧跟文字（字母/数字/汉字）才算强调，
// 这样 (*´▽`*) 之类不会被吃掉星号。
const MD_INLINE_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|\*(?=[\p{L}\p{N}])([^*\n]*?[^\s*])\*(?!\*)|~~(?=\S)([\s\S]*?\S)~~|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'）】，。]+)/gu
function mdInline(text, kp) {
  const out = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(MD_INLINE_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${kp}.${n++}`
    if (m[1]) out.push(<code key={k} className="md-code">{m[2]}</code>)
    else if (m[3] != null) out.push(<strong key={k}>{mdInline(m[3], k)}</strong>)
    else if (m[4] != null) out.push(/[A-Za-z0-9]/.test(text[m.index - 1] || '') ? m[0] : <em key={k}>{mdInline(m[4], k)}</em>) // 2*3*4 这种算式不当斜体
    else if (m[5] != null) out.push(<del key={k}>{mdInline(m[5], k)}</del>)
    else if (m[6] != null) out.push(<a key={k} href={m[7]} target="_blank" rel="noreferrer noopener">{mdInline(m[6], k)}</a>)
    else out.push(<a key={k} href={m[8]} target="_blank" rel="noreferrer noopener">{m[8]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
const MD_FENCE_RE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const MD_LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const MD_TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
function mdCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}
function mdBlocks(src) {
  const lines = (src || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let para = []
  const flush = () => { if (para.length) { blocks.push({ t: 'p', text: para.join('\n') }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(MD_FENCE_RE)
    if (fence) {
      flush()
      const ch = fence[1][0]
      const body = []
      i++
      while (i < lines.length) {
        const t = lines[i].trim()
        if (t.length >= fence[1].length && t.split('').every(c => c === ch)) break
        body.push(lines[i++])
      }
      blocks.push({ t: 'code', lang: fence[2], code: body.join('\n') })
      continue
    }
    if (!line.trim()) { flush(); continue }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (h) { flush(); blocks.push({ t: 'h', level: h[1].length, text: h[2] }); continue }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push({ t: 'hr' }); continue }
    if (/^>(\s|$)/.test(line)) {
      flush()
      const q = []
      while (i < lines.length && /^>(\s|$)/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
      i--
      blocks.push({ t: 'quote', text: q.join('\n') })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && lines[i + 1].includes('|') && MD_TABLE_SEP_RE.test(lines[i + 1])) {
      flush()
      const head = mdCells(line)
      const rows = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(mdCells(lines[i++]))
      i--
      blocks.push({ t: 'table', head, rows })
      continue
    }
    const li = line.match(MD_LIST_RE)
    if (li) {
      flush()
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(MD_LIST_RE)
        if (m) items.push({ depth: Math.min(4, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), marker: /\d/.test(m[2]) ? m[2].replace(')', '.') : '•', text: m[3] })
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1].text += '\n' + lines[i].trim()
        else break
        i++
      }
      i--
      blocks.push({ t: 'list', items })
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}
function CodeBlock({ lang, code }) {
  return (
    <div className="md-pre">
      <div className="md-pre-head"><span>{lang || 'code'}</span><CopyButton className="md-pre-copy" getText={() => code} label="Copy" /></div>
      <pre><code>{code}</code></pre>
    </div>
  )
}
// 一个 Markdown 块（段落、代码、标题、列表、引用、表格）
function mdBlockEl(b, i) {
  if (b.t === 'code') return <CodeBlock key={i} lang={b.lang} code={b.code} />
  if (b.t === 'h') return <div key={i} className={`md-h md-h${Math.min(b.level, 3)}`}>{mdInline(b.text, i)}</div>
  if (b.t === 'hr') return <hr key={i} className="md-hr" />
  if (b.t === 'quote') return <div key={i} className="md-quote">{mdInline(b.text, i)}</div>
  if (b.t === 'list') return (
    <div key={i} className="md-list">
      {b.items.map((it, j) => <div key={j} className="md-li" style={it.depth ? { paddingLeft: `${it.depth * 1.2}em` } : undefined}><span className="md-bullet">{it.marker}</span><span className="md-li-text">{mdInline(it.text, `${i}-${j}`)}</span></div>)}
    </div>
  )
  if (b.t === 'table') return (
    <div key={i} className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{b.head.map((c, j) => <th key={j}>{mdInline(c, `${i}-h${j}`)}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, ri) => <tr key={ri}>{b.head.map((_, j) => <td key={j}>{mdInline(r[j] || '', `${i}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
  return <div key={i} className="md-p">{mdInline(b.text, i)}</div>
}
// 助手消息的文字气泡：按 Markdown 渲染；有代码块或表格时气泡放宽，免得太窄
function MdBubble({ text, className = '' }) {
  const blocks = useMemo(() => mdBlocks(text), [text])
  const wide = blocks.some(b => b.t === 'code' || b.t === 'table')
  // 纯聊天（全是普通段落）时，空行隔开的每一段各成一个气泡，像连着发了几条微信；
  // 带代码、列表、表格、标题的"技术回复"不拆，保持一整块
  if (blocks.length > 1 && blocks.every(b => b.t === 'p')) {
    return blocks.map((b, i) => <div key={i} className={`bubble md ${className}`}><div className="md-p">{mdInline(b.text, i)}</div></div>)
  }
  return <div className={`bubble md ${wide ? 'wide' : ''} ${className}`}>{blocks.map(mdBlockEl)}</div>
}
// 沐 (CC) 的回复：不要气泡，照 claude.ai 助手回答的样子，纯文字铺满宽度
function MdFlat({ text, className = '' }) {
  const blocks = useMemo(() => mdBlocks(text), [text])
  return <div className={`cc-md ${className}`}>{blocks.map(mdBlockEl)}</div>
}

function TranscriptToggle({ open, onClick }) {
  return <button className="voice-transcript-btn" onClick={onClick}>{open ? '收起' : '转文字'}</button>
}

function VoiceAwareContent({ raw, msgKey, player, showTranscript, flat = false }) {
  const segs = useMemo(() => parseVoiceSegments(raw), [raw])
  const { ttsState, ttsDurations, toggleTts, seekTts } = player
  return segs.map((seg, si) => {
    if (seg.type === 'text') return flat ? <MdFlat key={si} className="msg-seg" text={seg.text} /> : <MdBubble key={si} className="msg-seg" text={seg.text} />
    const key = `${msgKey}:${si}`
    return (
      <div key={si} className="msg-seg">
        <VoiceMessage
          status={(ttsState[key] || {}).status || 'idle'}
          progress={(ttsState[key] || {}).progress || 0}
          duration={ttsDurations[key]}
          text={seg.text}
          zh={seg.zh}
          showText={showTranscript}
          onToggle={() => toggleTts(key, seg.text)}
          onSeek={ratio => seekTts(key, ratio)}
        />
      </div>
    )
  })
}

// ─── VoiceMessage (iMessage-style voice bubble) ─────
function VoiceMessage({ status, progress, duration, text, zh, showText, onToggle, onSeek }) {
  const trackRef = useRef(null)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const startXRef = useRef(0)
  const widthPx = useMemo(() => voiceBarWidth(duration), [duration])
  // 波形点数按波形区实际宽度来排（每点 3px + 间隔 3px），正好铺满：
  // 以前按"理想宽度"算点数，窄屏上语音条被 max-width 截短，右边的点被裁掉，进度就显得走得太快
  const [trackWidth, setTrackWidth] = useState(0)
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setTrackWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dotCount = useMemo(() => trackWidth ? Math.max(6, Math.floor((trackWidth + 3) / 6)) : Math.max(10, Math.min(32, Math.round(widthPx / 10))), [trackWidth, widthPx])
  const dotHeights = useMemo(() => Array.from({ length: 64 }, () => 4 + Math.round(Math.random() * 10)), [])
  const dots = useMemo(() => dotHeights.slice(0, Math.min(dotCount, 64)), [dotHeights, dotCount]) // 宽度变了也不重新洗高度，免得波形闪

  const playing = status === 'playing'
  const paused = status === 'paused'
  const loading = status === 'loading'
  const seekable = typeof onSeek === 'function' && isFinite(duration) && duration > 0
  const activeCount = (playing || paused) ? Math.round((progress || 0) * dots.length) : 0
  const elapsed = duration ? (progress || 0) * duration : 0
  const displaySeconds = (playing || paused) ? elapsed : duration
  const durationLabel = (displaySeconds != null && isFinite(displaySeconds)) ? `${Math.max(0, Math.round(displaySeconds))}"` : ''

  const ratioFromEvent = (e) => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (!rect.width) return 0
    return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
  }
  // 点语音条任意位置 = 播放/暂停；在波形上横向拖动才是调进度（拖过之后那次 click 不算点击）
  const handlePointerDown = (e) => {
    movedRef.current = false
    if (!seekable) return
    draggingRef.current = true
    startXRef.current = e.clientX
  }
  const handlePointerMove = (e) => {
    if (!draggingRef.current) return
    if (!movedRef.current) {
      if (Math.abs(e.clientX - startXRef.current) < 8) return
      movedRef.current = true
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    onSeek(ratioFromEvent(e))
  }
  const endDrag = (e) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  return (
    <div className="voice-msg">
      <div className={`voice-bar ${status}`} style={{ width: `${widthPx}px` }} onClick={onToggle} aria-label={playing ? 'Pause voice' : loading ? 'Loading voice' : 'Play voice'}>
        <span
          ref={trackRef}
          className={`voice-wave ${seekable ? '' : 'disabled'}`}
          onClick={e => { if (movedRef.current) { movedRef.current = false; e.stopPropagation() } }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {dots.map((h, di) => (
            <span key={di} className={`voice-dot ${di < activeCount ? 'active' : ''}`} style={{ height: `${h}px` }} />
          ))}
        </span>
        <span className="voice-duration">{loading ? <span className="spinner tiny light" /> : durationLabel}</span>
      </div>
      {showText && (
        <div className="bubble voice-transcript">
          <div>{stripAudioTags(text)}</div>
          {zh && <div className="voice-transcript-zh">{zh}</div>}
        </div>
      )}
    </div>
  )
}

// ─── Voice playback (shared by ChatRoom and CC chat) ─
// 语音段的 key 是 "消息key:段序号"，播放前才去 /api/tts 请求音频，时长先用 /api/tts/duration 估算。
function useVoicePlayer() {
  const [ttsState, setTtsState] = useState({})
  const [ttsDurations, setTtsDurations] = useState({})
  const ttsAudioRef = useRef(null)
  const ttsUrlRef = useRef(null)
  const ttsAbortRef = useRef(null)
  const ttsIdxRef = useRef(null)
  const ttsStatusRef = useRef(null)
  // Audio kept alive (not revoked) after a message finishes playing, or when
  // switching away to play a different message, so replaying the same
  // message reuses it instead of re-fetching from /api/tts.
  const ttsCacheRef = useRef({})
  const ttsDurationsRef = useRef({})
  useEffect(() => { ttsDurationsRef.current = ttsDurations }, [ttsDurations])

  const fetchDurationEstimate = useCallback((idx, text) => {
    if (!text || !text.trim()) return
    const params = new URLSearchParams({ text, preset: 'calm' })
    apiFetch(`/api/tts/duration?${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && isFinite(data.duration)) {
          setTtsDurations(prev => (prev[idx] != null ? prev : { ...prev, [idx]: data.duration }))
        }
      })
      .catch(() => {})
  }, [])

  const clearTtsCache = useCallback(() => {
    Object.values(ttsCacheRef.current).forEach(({ url }) => URL.revokeObjectURL(url))
    ttsCacheRef.current = {}
  }, [])

  const stopTts = useCallback(() => {
    if (ttsAbortRef.current) { ttsAbortRef.current.abort(); ttsAbortRef.current = null }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
      ttsAudioRef.current.ontimeupdate = null
      ttsAudioRef.current.onended = null
      ttsAudioRef.current.onerror = null
      ttsAudioRef.current.onloadedmetadata = null
      ttsAudioRef.current.src = ''
      ttsAudioRef.current = null
    }
    if (ttsUrlRef.current) { URL.revokeObjectURL(ttsUrlRef.current); ttsUrlRef.current = null }
    const prevIdx = ttsIdxRef.current
    ttsIdxRef.current = null
    ttsStatusRef.current = null
    if (prevIdx != null) setTtsState(prev => { const n = { ...prev }; delete n[prevIdx]; return n })
  }, [])

  // Keeps the currently-active audio alive in ttsCacheRef instead of
  // discarding it — used when a message finishes naturally or when
  // switching to play a different message, so it can be replayed later
  // without a new fetch. Contrast with stopTts, which really discards.
  const stashTts = useCallback(() => {
    const idx = ttsIdxRef.current
    const audio = ttsAudioRef.current
    if (idx == null || !audio) return
    audio.pause()
    audio.currentTime = 0
    audio.ontimeupdate = null
    audio.onended = null
    audio.onerror = null
    ttsCacheRef.current[idx] = { audio, url: ttsUrlRef.current }
    ttsIdxRef.current = null
    ttsStatusRef.current = null
    ttsUrlRef.current = null
    setTtsState(prev => { const n = { ...prev }; delete n[idx]; return n })
  }, [])

  const pauseTts = useCallback(() => {
    const idx = ttsIdxRef.current
    if (idx == null || !ttsAudioRef.current) return
    ttsAudioRef.current.pause()
    ttsStatusRef.current = 'paused'
    setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'paused' } }))
  }, [])

  const resumeTts = useCallback(() => {
    const idx = ttsIdxRef.current
    if (idx == null || !ttsAudioRef.current) return
    ttsAudioRef.current.play()
    ttsStatusRef.current = 'playing'
    setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'playing' } }))
  }, [])

  const activateCachedTts = useCallback((idx, cached, atRatio) => {
    if (ttsIdxRef.current !== null && ttsIdxRef.current !== idx) stashTts()
    delete ttsCacheRef.current[idx]
    const { audio, url } = cached
    ttsIdxRef.current = idx
    ttsStatusRef.current = 'playing'
    ttsUrlRef.current = url
    ttsAudioRef.current = audio
    audio.ontimeupdate = () => {
      const dur = ttsDurationsRef.current[idx] ?? audio.duration
      if (dur && isFinite(dur)) setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], progress: audio.currentTime / dur } }))
    }
    audio.onended = () => { if (ttsIdxRef.current === idx) stashTts() }
    audio.onerror = () => { if (ttsIdxRef.current === idx) stopTts() }
    const knownDur = ttsDurationsRef.current[idx] ?? audio.duration
    if (atRatio && isFinite(knownDur) && knownDur) audio.currentTime = atRatio * knownDur
    audio.play().catch(() => {})
    setTtsState(prev => ({ ...prev, [idx]: { status: 'playing', progress: atRatio || 0 } }))
  }, [stashTts, stopTts])

  const toggleTts = useCallback(async (idx, text) => {
    if (ttsIdxRef.current === idx) {
      if (ttsStatusRef.current === 'playing') { pauseTts(); return }
      if (ttsStatusRef.current === 'paused') { resumeTts(); return }
      return
    }
    const cached = ttsCacheRef.current[idx]
    if (cached) { activateCachedTts(idx, cached, 0); return }
    stashTts()
    ttsIdxRef.current = idx
    ttsStatusRef.current = 'loading'
    setTtsState(prev => ({ ...prev, [idx]: { status: 'loading', progress: 0 } }))
    const controller = new AbortController()
    ttsAbortRef.current = controller
    try {
      const res = await apiFetch(`/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, preset: 'calm' }), signal: controller.signal })
      if (!res.ok) throw new Error('tts failed')
      const headerDuration = Number(res.headers.get('X-Audio-Duration'))
      const blob = await res.blob()
      if (ttsIdxRef.current !== idx) return
      const url = URL.createObjectURL(blob)
      ttsUrlRef.current = url
      const audio = new Audio(url)
      ttsAudioRef.current = audio
      if (isFinite(headerDuration) && headerDuration > 0) {
        setTtsDurations(prev => ({ ...prev, [idx]: headerDuration }))
      } else {
        resolveAudioDuration(audio, dur => setTtsDurations(prev => ({ ...prev, [idx]: dur })))
      }
      audio.ontimeupdate = () => {
        const dur = ttsDurationsRef.current[idx] ?? audio.duration
        if (dur && isFinite(dur)) setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], progress: audio.currentTime / dur } }))
      }
      audio.onended = () => { if (ttsIdxRef.current === idx) stashTts() }
      audio.onerror = () => { if (ttsIdxRef.current === idx) stopTts() }
      await audio.play()
      if (ttsIdxRef.current === idx) { ttsStatusRef.current = 'playing'; setTtsState(prev => ({ ...prev, [idx]: { status: 'playing', progress: 0 } })) }
    } catch (err) {
      if (err.name !== 'AbortError' && ttsIdxRef.current === idx) {
        ttsIdxRef.current = null
        ttsStatusRef.current = null
        setTtsState(prev => { const n = { ...prev }; delete n[idx]; return n })
      }
    }
  }, [stashTts, stopTts, pauseTts, resumeTts, activateCachedTts])

  const seekTts = useCallback((idx, ratio) => {
    const clamped = Math.min(Math.max(ratio, 0), 1)
    if (ttsIdxRef.current === idx) {
      const audio = ttsAudioRef.current
      const dur = ttsDurationsRef.current[idx] ?? audio?.duration
      if (!audio || !isFinite(dur) || !dur) return
      audio.currentTime = clamped * dur
      setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], progress: clamped } }))
      return
    }
    const cached = ttsCacheRef.current[idx]
    if (cached) activateCachedTts(idx, cached, clamped)
  }, [activateCachedTts])

  useEffect(() => () => { stopTts(); clearTtsCache() }, [stopTts, clearTtsCache])

  const resetVoice = useCallback(() => {
    stopTts()
    clearTtsCache()
    setTtsDurations({})
  }, [stopTts, clearTtsCache])

  return { ttsState, ttsDurations, toggleTts, seekTts, fetchDurationEstimate, resetVoice }
}

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

function ChatPage({ onEnterRoom, lang = 'zh', onUsage }) {
  // 每次切到 Chats 都会重新挂载，所以默认直接进沐；返回进对话列表。都保留 tab 栏
  // 沐右上角 ⋮ 离开聊天页进 menu，里面三个入口各是一整页：search 查找聊天记录 / brain 回复方式 / usage
  const [view, setView] = useState('cc') // cc / list / menu / search / brain / usage
  const [jumpTo, setJumpTo] = useState(null) // 搜索结果点回来：{ id }，聊天页挂载时停在那条
  const searchSaved = useRef({ q: '', res: null, scrollTop: 0 }) // 搜过的词和结果，再进来还在
  const go = (v) => { if (v === 'usage' && onUsage) { onUsage(); return } setJumpTo(null); setView(v) }
  const swipeUsage = useSwipeBack(() => go('menu'))
  useEffect(() => { onEnterRoom(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
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

// ─── 沐 (CC) ─────────────────────────────────────────
// 经后端 /api/cc/* 转发到 VPS 上的 Claude Code。浏览器只持有 APP 口令（apiFetch 带上），bridge token 只在后端。
// 聊天记录现在存在 VPS（bridge 的 inbox/outbox），前端只在内存里留"发送中/发送失败"的临时消息。
// 聊天这一套界面文字默认中文（Clawd）；Vesper 借用时外面包一层 CcLang.Provider value="en"，整套换英文
const CcLang = createContext('zh')
function useCcSay() { const en = useContext(CcLang) === 'en'; return (zh, enText) => en ? enText : zh }

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
const ccIsTool = m => m.role === 'system' && m.kind === 'tool'
const ccIsHis = m => m.role === 'assistant' || ccIsTool(m) // 算进他那一块的：他的话和他调的工具
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

// 他边写边到的新段落：整段从透明渐变到完全显示，不遮罩、不位移、不逐字。字是一到就完整写进页面的（能复制、能长按选字），
// 动画只改透明度。时长固定 CC_REVEAL_MS，想快想慢改这个数
const CC_REVEAL_MS = 400
const ccRevealed = new Set() // 已经浮现过的：块重新挂载（前面插进来补上的话）时不再播一遍
const ccReduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function CcPiece({ m, player, showTranscript }) {
  const say = useCcSay()
  const [anim, setAnim] = useState(() => !!m.live && !ccRevealed.has(m.key) && !ccReduceMotion())
  const ms = CC_REVEAL_MS
  useEffect(() => {
    ccRevealed.add(m.key)
    if (!anim) return
    const t = setTimeout(() => setAnim(false), ms + 300) // 动画事件没来（切走页面之类）也一定去掉遮罩
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`cc-piece${anim ? ' cc-reveal' : ''}`} style={anim ? { '--cc-reveal-ms': `${ms}ms` } : undefined} onAnimationEnd={e => { if (e.target === e.currentTarget) setAnim(false) }}>
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
function CcTools({ tools }) {
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
function ccTurnParts(items) {
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
function CcBrainScreen({ onBack }) {
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
function CcMenuPage({ onBack, onOpen }) {
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
function CcSearchPage({ saved, onBack, onPick }) {
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
function CcEditBox({ text, onSave, onCancel }) {
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
// （白名单唯一来源是 VPS 上的 /opt/mu-bridge/file_types.json，前端不写死）。拿不到时图片照常能发，按 9 个算
const CC_MAX_ITEMS_FALLBACK = 9
const ccExt = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : '' }
const fmtFileSize = (n) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
// 带口令取回 bridge 上的图或文件（<img>/<a> 带不了 Authorization），blob 地址按 path 缓存在内存里。
// 聊天里的图要缩略图（thumb：bridge 做的 360×360 webp，十几 KB），点开大图才要原图；内存里缩略图的 key 是 `${path}#thumb`。
// 图还存进浏览器的 Cache Storage：文件名是 uuid、内容永远不变，存一次下次打开 App 直接读，不用再绕 Render 和梯子。
// iPhone 好几天不打开可能被系统清掉，读不到、存不进（无痕模式、非 https）都当没有，照常走网络
const ccImageCache = new Map()
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
async function fetchCcImage(path, { thumb = false } = {}) {
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
// 上传失败时把后端的提示（"不支持 .docx 文件"、"文件不能超过 20MB"）带出来
async function ccUploadForm(form) {
  const res = await apiFetch(`/api/cc/upload`, { method: 'POST', body: form })
  if (res.status === 401) throw new Error('unauthorized')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
async function uploadCcImage(blob) {
  const form = new FormData()
  form.append('image', blob, blob.type === 'image/webp' ? 'image.webp' : 'image.jpg')
  return (await ccUploadForm(form)).path
}
async function uploadCcFile(file) {
  const form = new FormData()
  form.append('name', file.name) // 原文件名单独放一个字段：multipart 的 filename 遇到中文各家浏览器编码不一
  form.append('file', file, file.name)
  return (await ccUploadForm(form)).path
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
function CcFileIcon({ name }) {
  return <span className="cc-file-icon">{CC_FILE_ICON}<span className="cc-file-ext">{ccExt(name).slice(0, 4).toUpperCase()}</span></span>
}

// 聊天里自己发的文件：类型图标 + 原文件名 + 大小，点一下打开，右边按钮下载。bridge 只留 7 天，过期了灰掉
function CcFile({ file }) {
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
// 点开的大图：右上角三个点 → 苹果原生分享面板（里面有"存储图像"），原图原画质
// 分享必须在点击的那一下同步调用（iOS 会拦掉异步之后的调用），所以一打开就先把图读成 File
const LIGHTBOX_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' }
// 一组图左右滑着看（聊天里她发过的所有图、草稿里待发的图），从点开的那张开始；横向 scroll-snap，手指滑就是系统原生的手感
// items：[{ path?, localUrl? }]。path 是 bridge 上的图：先用缩略图垫着，滑到附近了再取原图（分享的也是原图）
function ImageLightbox({ items, index = 0, onClose }) {
  const say = useCcSay()
  const [at, setAt] = useState(index)
  const [files, setFiles] = useState({}) // 第几张 → 读好的 File（分享要在点的那一下同步调用）
  const track = useRef(null)
  useLayoutEffect(() => { const el = track.current; if (el) el.scrollLeft = index * el.clientWidth }, [index])
  const onScroll = (e) => { const el = e.currentTarget; setAt(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))) }
  const onFile = useCallback((i, f) => setFiles(prev => ({ ...prev, [i]: f })), [])
  const file = files[at]
  const share = (e) => {
    e.stopPropagation()
    navigator.share({ files: [file] }).catch(() => {}) // 她在面板里取消也会走到 catch，不用提示
  }
  // 挂到 body 上：Vesper 的聊天在自己的层里，不挂出去会被底下的 tab 栏压住
  return createPortal(
    <div className="image-lightbox-overlay" onClick={onClose}>
      {file && <button className="icon-btn image-lightbox-more" onClick={share} aria-label={say('分享或存储图像', 'Share or save image')}>{I.more}</button>}
      <div className="image-lightbox-track" ref={track} onScroll={onScroll}>
        {items.map((img, i) => <LightboxSlide key={img.path || img.localUrl || i} img={img} near={Math.abs(i - at) <= 1} onFile={f => onFile(i, f)} />)}
      </div>
      {items.length > 1 && <div className="image-lightbox-count">{at + 1} / {items.length}</div>}
    </div>,
    document.body,
  )
}
function LightboxSlide({ img, near, onFile }) {
  const [shown, setShown] = useState(img.localUrl || (img.path && (ccImageCache.get(img.path) || ccImageCache.get(`${img.path}#thumb`))) || null)
  const [full, setFull] = useState(!img.path || !!ccImageCache.get(img.path))
  useEffect(() => {
    if (full || !near) return
    let alive = true
    fetchCcImage(img.path).then(u => { if (alive) { setShown(u); setFull(true) } }).catch(() => { if (alive) setFull(true) })
    return () => { alive = false }
  }, [img.path, near, full])
  const fileRef = useRef(onFile)
  useEffect(() => { fileRef.current = onFile })
  useEffect(() => {
    if (!full || !shown) return
    let alive = true
    fetch(shown).then(r => r.blob()).then(b => {
      const f = new File([b], `mu-${Date.now()}.${LIGHTBOX_EXT[b.type] || 'jpg'}`, { type: b.type || 'image/jpeg' })
      if (alive && navigator.canShare?.({ files: [f] })) fileRef.current(f)
    }).catch(() => {})
    return () => { alive = false }
  }, [shown, full])
  return <div className="image-lightbox-slide">{shown && <img src={shown} alt="" />}</div>
}

// 聊天里显示缩略图；点开交给 ImageLightbox 去取原图（刚发的图本地就有原图，直接用）
function CcImage({ img, onOpen }) {
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
  return <img src={url} alt="" className="cc-thumb" onClick={() => onOpen(img)} />
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
// 录音格式：Chrome 录 webm/opus，iPhone Safari 只会 mp4
function ccRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return null
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || ''
}
const CC_VOICE_MAX_S = 60 // 一段最多录这么久，到点自动发
const CC_VOICE_MIN_S = 0.8
// 输入框两边的圆圈按钮：语音（声波）/ 键盘、⊕
const CC_VOICE_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.3 10.6a2 2 0 0 1 0 2.8" strokeWidth="1.8"/><path d="M11.8 8.6a5 5 0 0 1 0 6.8" strokeWidth="1.8"/><path d="M14.3 6.6a8 8 0 0 1 0 10.8" strokeWidth="1.8"/></svg>
const CC_KEYBOARD_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 9h.01M10.5 9h.01M13.5 9h.01M16.5 9h.01M7.5 12h.01M10.5 12h.01M13.5 12h.01M16.5 12h.01" strokeWidth="2.2"/><path d="M9 15.5h6" strokeWidth="1.8"/></svg>
const CC_EMOJI_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="9" cy="10" r=".6" fill="currentColor" strokeWidth="1.4"/><circle cx="15" cy="10" r=".6" fill="currentColor" strokeWidth="1.4"/><path d="M7.8 13.5h8.4a4.2 4.2 0 0 1-8.4 0z" strokeWidth="1.6"/></svg>
const CC_BACKSPACE_ICON = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 5H8.5L3 12l5.5 7H21z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/></svg>
// 表情面板：常用的这些，点一下插进输入框光标处
const CC_EMOJIS = [...'😀😁😂🤣😊😇🙂😉😌😍🥰😘😗😙😚😋😛😜🤪😝🤗🤭🫢🤫🤔🫡😐😑😶🙄😏😒😮‍💨😬😴🥱😪🤤😷🤒🥴😵‍💫🤯🥳🥺🥹😢😭😤😠😡🤬😳😱😨😰😥😓🫠🙃😈👻💀🤡🙈🙉🙊💋💌💘💝💖💗💓💞💕❤️🧡💛💚💙💜🤍🖤💔❣️🫶👍👎👌✌️🤞🫰🤟🤙👋👏🙌🙏💪🤝🫂👀✨🌙⭐️🔥🌸🌹🍀🎉🎁🍰☕️🧋🍜🐱🐶🐰🐻🐼🦊']
const CC_EMOJI_LIST = (() => { try { return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(CC_EMOJIS.join(''))].map(x => x.segment) } catch { return CC_EMOJIS } })()
const CC_PLUS_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7.5v9M7.5 12h9" strokeWidth="1.7"/></svg>
const CC_PLAY_ICON = <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>
const CC_PAUSE_ICON = <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>

// 她发的语音：点一下放 / 停，下面是 ears 转出来的字和语气（和她平时比偏了多少）
// 录音先取好放着，点的那一下同步 play()，iPhone 才不会因为"不是用户点的"拦掉
let ccVoiceNow = null // 同一时间只放一条
function CcVoice({ v }) {
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

function getCcLast() {
  try { return JSON.parse(localStorage.getItem('cc_last') || 'null') } catch { return null }
}
function setCcLastStorage(m) {
  try { localStorage.setItem('cc_last', JSON.stringify({ text: m.text || (m.images?.length ? '[图片]' : m.files?.length ? '[文件]' : m.voices?.length ? '[语音]' : ''), time: m.time })) } catch {}
}
// 最近三十轮存在本机：进聊天页先直接画出来，再拉 /history 对一遍（以服务器为准）。
// 存的是 ccFromServer 之后的样子，格式改了就换 key（_v2…），旧的自然作废
const CC_CACHE_KEY = 'cc_history_v1'
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

function CCChatPage({ onBack, onMenu, jumpTo }) {
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
  const [emojiOpen, setEmojiOpen] = useState(false) // 表情面板
  const [recording, setRecording] = useState(null) // 按住说话中：{ start, cancel }；start 是麦克风开好的时刻（还在要权限时是 null）
  const [recNow, setRecNow] = useState(0)
  const recRef = useRef(null)
  const canRecord = ccRecorderMime() !== null && !!navigator.mediaDevices?.getUserMedia
  const [voiceMode, setVoiceMode] = useState(() => { try { return canRecord && localStorage.getItem('cc_voice_mode') === '1' } catch { return false } }) // 上次用的是语音还是键盘，下次进来照旧
  const toggleVoiceMode = () => {
    const next = !voiceMode
    setVoiceMode(next)
    try { localStorage.setItem('cc_voice_mode', next ? '1' : '0') } catch {}
    if (next) setEmojiOpen(false)
    // 切到语音前先让输入框失焦：直接卸掉的话浏览器不发 focusout，底部 tab 会一直藏着；切回键盘也不自动聚焦，点了输入框才藏 tab
    if (next) textareaRef.current?.blur()
  }
  // 插在光标处（没聚焦过就接在最后），不弹键盘；语音模式下先切回键盘
  const insertEmoji = (em) => {
    const ta = textareaRef.current
    const sel = ta && document.activeElement === ta ? [ta.selectionStart, ta.selectionEnd] : null
    setInput(v => sel ? v.slice(0, sel[0]) + em + v.slice(sel[1]) : v + em)
    if (voiceMode) { setVoiceMode(false); try { localStorage.setItem('cc_voice_mode', '0') } catch {} }
  }
  const deleteBack = () => setInput(v => { const parts = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(v)]; return parts.slice(0, -1).map(x => x.segment).join('') })
  const photoInputRef = useRef(null)
  const cameraInputRef = useRef(null) // Vesper 的 Camera 按钮用
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const messagesEndRef = useRef(null)
  const listRef = useRef(null)
  const scrollModeRef = useRef('bottom') // bottom：滚到底；keep：往上加载旧消息，保持原位置
  const prevHeightRef = useRef(0)
  const voice = useVoicePlayer()
  const { fetchDurationEstimate } = voice
  const [transcripts, setTranscripts] = useState({})

  const swipe = useSwipeBack(onBack)
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
  useLayoutEffect(() => { const ta = textareaRef.current; if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' } }, [input, passcode, voiceMode])

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
  // 键盘、表情面板、加号面板三选一。点开面板先收起键盘，面板占键盘的位置（Vesper 里面板高度 = 上次键盘的高度）；
  // 点输入框弹键盘时，面板等键盘真的升上来那一下再收，输入框一直在同一个高度，不会先掉下去再被顶上来
  const panelOpen = emojiOpen || attachOpen
  const closePanels = () => { setEmojiOpen(false); setAttachOpen(false) }
  const togglePanel = (which) => {
    textareaRef.current?.blur()
    setEmojiOpen(which === 'emoji' ? o => !o : false)
    setAttachOpen(which === 'attach' ? o => !o : false)
  }
  const onInputFocus = () => {
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
  // Vesper 要知道面板开着：和键盘一样收起底部 tab 栏
  useEffect(() => { window.dispatchEvent(new CustomEvent('cc-panel', { detail: panelOpen })) }, [panelOpen])
  useEffect(() => () => window.dispatchEvent(new CustomEvent('cc-panel', { detail: false })), [])
  // 输入栏变高变矮（面板开合、键盘起落、草稿图那一排）时消息列表贴着底：最后一条跟着输入栏走，不跳
  // 面板开合、草稿图那一排是渲染引起的：每次渲染完、画出来之前对一下；键盘起落不经过渲染，交给 ResizeObserver。
  // 列表是后来才渲染出来的（先有加载中那一屏），换了元素就重新挂
  const anchorRef = useRef(null)
  useLayoutEffect(() => {
    const el = listRef.current
    if (anchorRef.current?.el !== el) {
      anchorRef.current?.ro?.disconnect()
      anchorRef.current = null
      if (!el) return
      const a = { el, h: el.clientHeight }
      a.adjust = () => {
        const d = a.h - el.clientHeight
        a.h = el.clientHeight
        if (d && !detachedRef.current && el.scrollHeight - el.scrollTop - el.clientHeight - Math.max(d, 0) < 80) el.scrollTop += d
      }
      if (typeof ResizeObserver !== 'undefined') { a.ro = new ResizeObserver(a.adjust); a.ro.observe(el) }
      anchorRef.current = a
      return
    }
    anchorRef.current?.adjust()
  })
  useEffect(() => () => anchorRef.current?.ro?.disconnect(), [])
  const stickBottom = () => {
    if (say(true, false) || detachedRef.current) return
    const go = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }
    go(); setTimeout(go, 120); setTimeout(go, 360)
  }

  // 缓存里垫上的他的话：语音段的时长也要估（mergeHistory 只估新来的）
  useEffect(() => {
    history.forEach(m => { if (m.role === 'assistant') estimateVoiceDurations(m.key, m.text, fetchDurationEstimate) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (!detachedRef.current) setCcCacheStorage(history) }, [history, detached]) // 搜出来的那一段不进缓存

  // 往上滑到顶加载更早的 30 条，保持当前位置不跳
  const loadOlder = async () => {
    if (loadingMore || !hasMore || !history.length) return
    setLoadingMore(true)
    prevHeightRef.current = listRef.current?.scrollHeight || 0
    try {
      const data = await fetchHistory(history[0].time)
      mergeHistory((data.messages || []).map(ccFromServer), 'keep')
      setHasMore(!!data.has_more)
    } catch {}
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
    const items = rows.flatMap(r => r.m?.images || []).map(im => ({ path: im.localUrl ? null : im.path, localUrl: im.localUrl }))
    const all = rows.flatMap(r => r.m?.images || [])
    setLightbox({ items, index: Math.max(all.indexOf(img), 0) })
  }
  const openPendingImage = (p) => {
    const imgs = pending.filter(x => x.kind === 'image')
    setLightbox({ items: imgs.map(x => ({ localUrl: x.previewUrl })), index: Math.max(imgs.indexOf(p), 0) })
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
    if (scrollModeRef.current === 'keep') el.scrollTop = el.scrollHeight - prevHeightRef.current
    else if (scrollModeRef.current === 'jump') {
      // 搜索跳过来：那条放到中间，之后的更新不再动位置
      const target = flashKey && el.querySelector(`[data-mids~="${CSS.escape(flashKey)}"]`)
      if (target) target.scrollIntoView({ block: 'center' })
      if (messages.length) scrollModeRef.current = 'stay'
    } else if (scrollModeRef.current !== 'stay') messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, typingNow, flashKey])
  useEffect(() => {
    if (!flashKey) return
    const t = setTimeout(() => setFlashKey(null), 2400)
    return () => clearTimeout(t)
  }, [flashKey])
  const onListScroll = (e) => {
    const el = e.currentTarget
    const toBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (el.scrollTop < 80) loadOlder()
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
  const deliver = async (msg) => {
    setTemp(prev => prev.map(m => m.key === msg.key ? { ...m, failed: false } : m))
    startWaiting()
    try {
      // 一个一个排队传，不并发：后端是整份读进内存再转给 VPS，一起传会把 Render 的内存顶满
      const sent = []
      for (const p of msg.items) {
        let path = uploadedRef.current.get(p.key)
        if (!path && p.kind === 'voice') {
          // 先交给 ears 听：转出来的字、语气记在附件上（重发时不用再听一遍），临时消息上马上显示
          p.heard = await listenCcVoice(p.blob, p.duration)
          setTemp(prev => prev.map(m => m.key === msg.key ? { ...m, voices: m.voices.map(v => v.key === p.key ? { ...v, ...ccVoiceView(p.heard), duration: p.duration, listening: false } : v) } : m))
          path = p.heard.path
          uploadedRef.current.set(p.key, path)
          ccImageCache.set(path, p.localUrl)
        }
        if (!path) {
          path = p.kind === 'image' ? await uploadCcImage(p.blob) : await uploadCcFile(p.file)
          uploadedRef.current.set(p.key, path)
          ccImageCache.set(path, p.previewUrl || p.localUrl) // 刚发的直接用本地预览，不用再向服务器取
          if (p.kind === 'image') ccImgCachePut(path, false, p.blob) // 下次打开 App 也不用下载自己发的图
        }
        sent.push({ p, path })
      }
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

  // ─── 按住说话 ───
  // 按下开麦克风开始录，松开就发；按着往上滑超过 60px 松开是取消。第一次按会弹麦克风权限，没开好就松手的这次不算
  const sendVoice = (blob, duration) => {
    const localUrl = URL.createObjectURL(blob)
    const item = { key: `voice-${Date.now()}`, kind: 'voice', blob, duration, localUrl }
    const msg = { key: `me-${Date.now()}`, local: true, clientId: ccClientId(), items: [item], role: 'user', text: '', time: new Date().toISOString(), voices: [{ key: item.key, localUrl, duration, listening: true }] }
    if (detachedRef.current) showLatest()
    scrollModeRef.current = 'bottom'
    setTemp(prev => [...prev, msg])
    deliver(msg)
  }
  const finishRecording = (rec) => {
    rec.stream?.getTracks().forEach(t => t.stop())
    if (recRef.current === rec) recRef.current = null
    if (rec.cancel) return
    if (rec.duration < CC_VOICE_MIN_S) { setNotice(say('太短了，按住多说一会儿', 'Too short — hold a little longer')); return }
    const type = rec.recorder?.mimeType || rec.chunks[0]?.type || 'audio/webm'
    const blob = new Blob(rec.chunks, { type })
    if (blob.size) sendVoice(blob, rec.duration)
  }
  const stopRecording = (cancel) => {
    const rec = recRef.current
    if (!rec || rec.released) return
    rec.released = true
    rec.cancel = cancel
    rec.duration = rec.startedAt ? (Date.now() - rec.startedAt) / 1000 : 0
    clearTimeout(rec.timer)
    setRecording(null)
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop() // onstop 里收尾
    else finishRecording({ ...rec, cancel: true })
  }
  const startRecording = async (e) => {
    e.preventDefault()
    if (recRef.current || !passcode) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const rec = { chunks: [], y0: e.clientY, released: false, cancel: false }
    recRef.current = rec
    setRecording({ start: null, cancel: false })
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      recRef.current = null
      setRecording(null)
      setNotice(say('没拿到麦克风权限（设置里允许这个网页用麦克风）', 'No microphone access — allow it in Settings'))
      return
    }
    rec.stream = stream
    if (rec.released) { // 在弹权限的时候已经松手了
      stream.getTracks().forEach(t => t.stop())
      if (recRef.current === rec) recRef.current = null
      if (!rec.cancel) setNotice(say('好了，再按住说一次', 'Ready — hold to talk again'))
      return
    }
    const mime = ccRecorderMime()
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recorder.ondataavailable = ev => { if (ev.data?.size) rec.chunks.push(ev.data) }
    recorder.onstop = () => finishRecording(rec)
    rec.recorder = recorder
    rec.startedAt = Date.now()
    recorder.start()
    rec.timer = setTimeout(() => stopRecording(false), CC_VOICE_MAX_S * 1000)
    setRecording({ start: rec.startedAt, cancel: false })
  }
  const moveRecording = (e) => {
    const rec = recRef.current
    if (!rec || rec.released) return
    const cancel = rec.y0 - e.clientY > 60
    setRecording(r => r && r.cancel !== cancel ? { ...r, cancel } : r)
  }
  const releaseRecording = (e) => {
    const rec = recRef.current
    if (!rec) return
    stopRecording(rec.y0 - e.clientY > 60)
  }
  useEffect(() => {
    if (!recording?.start) return
    const t = setInterval(() => setRecNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [recording?.start])
  useEffect(() => () => { const rec = recRef.current; if (rec) { rec.cancel = true; stopRecording(true) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
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

  const handleInputChange = (e) => setInput(e.target.value)

  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)
  const handleKeyDown = (e) => { if (isMobile) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); sendMessage() } }
  const statusLabel = { connecting: 'Connecting…', live: ccBrainLabel(brain) || 'Claude Code', offline: 'Offline · reconnecting' }[status]

  return (
    <>
    <div className="chatroom cc-room" {...swipe}>
      <div className="chatroom-header">
        <button className="icon-btn" onClick={onBack}>{I.back}</button>
        <div className="chatroom-title">
          {/* 英文版（Vesper）连接状态是名字右边一个小圆点，绝对定位挂着，名字还在正中、顶栏不变高 */}
          <div className="chatroom-name">{say('沐 (CC)', <span className="cc-name-wrap">Soren<span key={passcode ? status : 'locked'} className={`cc-head-dot ${passcode ? status : 'offline'}`} role="status" aria-label={passcode ? statusLabel : 'Locked'} /></span>)}</div>
          {say(<div className="chatroom-model">{passcode ? statusLabel : 'Locked'}</div>, null)}
        </div>
        <div className="chatroom-header-right">
          <button className="icon-btn" onClick={onMenu} aria-label={say('更多', 'More')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
      </div>

      <CcLimitedNotice brief={usageBrief} en={say(false, true)} />
      {compacting && <div className="cc-compacting" role="status" aria-label={say('正在压缩', 'Compacting')}>compacting<span className="cc-compacting-dot">.</span><span className="cc-compacting-dot">.</span><span className="cc-compacting-dot">.</span></div>}
      <div className="messages" ref={listRef} onScroll={onListScroll} onClick={closePanels}>
        {loadingMore && <div className="empty-state">Loading…</div>}
        {messages.length === 0 && <div className="empty-state">{jumping ? 'Loading…' : passcode ? 'Start chatting' : ''}</div>}
        {rows.map(row => {
          if (row.turn) {
            // 他的一轮：几段合成一块，没有气泡；时间、复制整块、转文字放在块下面
            // 还在说（服务器的"正在输入"亮着、这是最后一块）：不显示操作行，三个点跟在这块最后面
            const live = liveTurnKey === row.key
            const items = row.items
            const said = items.filter(it => !ccIsTool(it)) // 他说的话（复制、转文字只管这些）
            const last = items[items.length - 1]
            const voiced = said.some(it => hasVoiceSegment(it.text))
            const viaApi = items.findLast(it => it.viaApi) // 这块是 API 替班回的：时间后面标上模型
            const open = !!transcripts[row.key]
            return (
              <div key={row.key} className={`msg assistant cc-turn${items.some(it => it.key === flashKey) ? ' cc-flash' : ''}`} data-mids={items.map(it => it.key).join(' ')}>
                <div className="cc-turn-body">
                  {ccTurnParts(items).map(part => part.tools
                    ? <CcTools key={part.key} tools={part.tools} />
                    : <CcPiece key={part.key} m={part.m} player={voice} showTranscript={open} />)}
                  {live && <div className="cc-typing cc-typing-inline" aria-label={say('正在输入', 'Typing')}><span className="cc-typing-dot" /><span className="cc-typing-dot" /><span className="cc-typing-dot" /></div>}
                </div>
                {!live && (
                  <div className="msg-meta">
                    <span className="msg-time">{fmtMsgTime(last.time, say(false, true))}</span>
                    {viaApi && <span className="msg-time cc-via-api">{viaApi.model ? `API · ${viaApi.model}` : 'API'}</span>}
                    {said.length > 0 && <CopyButton getText={() => said.map(it => messageCopyText(it.text)).filter(Boolean).join('\n\n')} />}
                    {voiced && <TranscriptToggle open={open} onClick={() => setTranscripts(prev => ({ ...prev, [row.key]: !prev[row.key] }))} />}
                  </div>
                )}
              </div>
            )
          }
          const m = row.m
          const failure = failures.get(m.key)
          const showFailure = failure && !calledAgain.has(failure.key)
          const editing = editingKey === m.key
          return (
          <div key={m.key} className={`msg ${m.role}${m.key === flashKey ? ' cc-flash' : ''}`} data-mids={m.key}>
            {m.images?.length > 0 && <div className="cc-images">{m.images.map((im, i) => <CcImage key={im.path || im.key || i} img={im} onOpen={openChatImage} />)}</div>}
            {m.files?.length > 0 && <div className="cc-files">{m.files.map((f, i) => <CcFile key={f.path || f.key || i} file={f} />)}</div>}
            {m.voices?.length > 0 && m.voices.map((v, i) => <CcVoice key={v.path || v.key || i} v={v} />)}
            {m.text && (editing
              ? <CcEditBox text={m.text} onSave={t => saveEdit(m, t)} onCancel={() => setEditingKey(null)} />
              : <div className="bubble">{m.text}</div>)}
            <div className="msg-meta">
              {m.failed
                ? <>
                    <button className="cc-note-btn" onClick={() => deliver(m)}>{say('发送失败 · 点一下重发', 'Not sent · tap to retry')}</button>
                    <button className="copy-btn" onClick={() => discardFailed(m)} aria-label="Delete">{I.close}</button>
                  </>
                : <span className="msg-time">{fmtMsgTime(m.time, say(false, true))}</span>}
              {m.editedAt && <span className="msg-time">{say('已编辑', 'Edited')}</span>}
              {m.viaApp && <span className="msg-time">{say('来自 Claude App', 'From Claude App')}</span>}
              {m.text && !editing && <CopyButton getText={() => m.text} />}
              {m.text && !m.local && !m.viaApp && !editing && (
                <button className="copy-btn" onClick={() => setEditingKey(m.key)} aria-label="Edit">{I.edit}</button>
              )}
            </div>
            {showFailure && (
              <div className="cc-msg-note">{failure.partial ? say('话没说完就断了', 'Cut off mid-reply') : say('他这次没回上来', "He didn't reply this time")} · <button className="cc-note-btn" onClick={() => callAgain(m, failure)}>{say('再叫他一下', 'Call him again')}</button></div>
            )}
            {!showFailure && stuck && !compacting && !serverTyping?.on && m.key === lastUserKey && <div className="cc-msg-note">{say('他好像卡住了', 'He seems stuck')}</div>}
          </div>
          )
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

      <div className="composer">
        {notice && <div className="cc-notice" onClick={() => setNotice('')}>{notice}</div>}
        {pending.length > 0 && (
          <div className="cc-pending">
            {pending.map(p => p.kind === 'file' ? (
              <div key={p.key} className="composer-image-preview cc-pending-file" title={p.file.name}>
                <CcFileIcon name={p.file.name} />
                <span className="cc-file-info">
                  <span className="cc-file-name">{p.file.name}</span>
                  <span className="cc-file-size">{fmtFileSize(p.file.size)}</span>
                </span>
                <button onClick={() => removePending(p.key)} aria-label="Remove file">{I.close}</button>
              </div>
            ) : (
              <div key={p.key} className="composer-image-preview">
                <img src={p.previewUrl} alt="" onClick={() => openPendingImage(p)} />
                <button onClick={() => removePending(p.key)} aria-label="Remove image">{I.close}</button>
              </div>
            ))}
          </div>
        )}
        {recording && (
          <div className={`cc-recording${recording.cancel ? ' cancel' : ''}`} role="status">
            <span className="cc-recording-dot" />
            <span className="cc-recording-time">{recording.start ? `${Math.floor(Math.max(0, recNow - recording.start) / 1000)}"` : '…'}</span>
            <span>{!recording.start ? 'Opening mic…' : recording.cancel ? 'Release to cancel' : 'Release to send · slide up to cancel'}</span>
          </div>
        )}
        {/* 左边切语音 / 键盘；语音模式下输入框换成整条"按住 说话"；右边 ⊕ 是照片和文件，有东西要发时多一个发送 */}
        <div className="composer-input-row cc-composer-row">
          <button className="attach-btn cc-mode-btn" onClick={toggleVoiceMode} disabled={!passcode || (!voiceMode && !canRecord)} aria-label={voiceMode ? say('切换到键盘', 'Keyboard') : say('切换到语音', 'Voice')}>{voiceMode ? CC_KEYBOARD_ICON : CC_VOICE_ICON}</button>
          {voiceMode ? (
            <button className={`cc-hold-btn${recording ? ' recording' : ''}${recording?.cancel ? ' cancel' : ''}`} disabled={!passcode}
              onPointerDown={startRecording} onPointerMove={moveRecording} onPointerUp={releaseRecording} onPointerCancel={() => stopRecording(true)}
              onContextMenu={e => e.preventDefault()}>{!recording ? 'Hold to talk' : recording.cancel ? 'Release to cancel' : 'Release to send'}</button>
          ) : (
            <textarea ref={textareaRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown} onFocus={onInputFocus} onBlur={stickBottom} placeholder="Say to Soren" rows={1} disabled={!passcode} />
          )}
          <button className={`attach-btn${emojiOpen ? ' active' : ''}`} onClick={() => togglePanel('emoji')} disabled={!passcode} aria-label="Emoji" aria-expanded={emojiOpen}>{CC_EMOJI_ICON}</button>
          <button className={`attach-btn${attachOpen ? ' active' : ''}`} onClick={() => togglePanel('attach')} disabled={!passcode || full} aria-label="Add photos or files" aria-expanded={attachOpen}>{CC_PLUS_ICON}</button>
          <input ref={fileInputRef} type="file" accept={fileAccept} multiple onChange={handleFileSelect} style={{ display: 'none' }} />
          <input ref={photoInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} style={{ display: 'none' }} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} style={{ display: 'none' }} />
          {((!voiceMode && input.trim()) || pending.length > 0) && <button className="send-btn" onClick={sendMessage} disabled={!passcode}>{I.send}</button>}
        </div>
        {attachOpen && (
          <div className="cc-attach-menu">
            {say(false, true) && <button onClick={() => { setAttachOpen(false); cameraInputRef.current?.click() }} disabled={!passcode || full}>{I.camera}<span>Camera</span></button>}
            <button onClick={() => { setAttachOpen(false); photoInputRef.current?.click() }} disabled={!passcode || full}>{I.photo}<span>{say('照片', 'Photos')}</span></button>
            <button onClick={() => { setAttachOpen(false); fileInputRef.current?.click() }} disabled={!passcode || !fileTypes || full}>{I.file}<span>{say('文件', 'Files')}</span></button>
          </div>
        )}
        {emojiOpen && (
          <div className="cc-emoji-panel">
            <div className="cc-emoji-grid">{CC_EMOJI_LIST.map(em => <button key={em} onClick={() => insertEmoji(em)}>{em}</button>)}</div>
            <button className="cc-emoji-del" onClick={deleteBack} disabled={!input} aria-label="Delete">{CC_BACKSPACE_ICON}</button>
          </div>
        )}
      </div>

      {lightbox && <ImageLightbox items={lightbox.items} index={lightbox.index} onClose={() => setLightbox(null)} />}

    </div>
    </>
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
  API, START_DATE, getPasscode, apiFetch, apiJson, LockScreen, useKeyboardOpen,
  beijingDateStr, getWhisperCache, setWhisperCache,
  ensureImportantMigrated, fetchUpcomingImportant, getUpcomingImportantCache, importantFromEvent,
  eventFirstDay, eventLastDay, shDateOf, shTimeOf, addDaysStr, daysBetweenStr, predictNextPeriod,
  ChatPage, getMcpUrl, setMcpUrlStorage, mcpRequest, DrawGuessGame,
}
