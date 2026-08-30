import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './App.css'

const API = 'https://mu-backend-l0uw.onrender.com'
const START_DATE = new Date('2026-07-27')

// ─── Avatar helpers (localStorage) — session list avatar ──
function getAvatar(sessionId) {
  try { return localStorage.getItem(`avatar_${sessionId}`) } catch { return null }
}
function setAvatarStorage(sessionId, dataUrl) {
  try { if (dataUrl) localStorage.setItem(`avatar_${sessionId}`, dataUrl); else localStorage.removeItem(`avatar_${sessionId}`) } catch {}
}

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

// ─── Important dates (localStorage) ─────────────────
function getImportantDates() {
  try {
    const d = localStorage.getItem('important_dates')
    return d ? JSON.parse(d) : getDefaultDates()
  } catch { return getDefaultDates() }
}
function saveImportantDates(dates) {
  try { localStorage.setItem('important_dates', JSON.stringify(dates)) } catch {}
}
function getDefaultDates() {
  return [
    { id: 'd1', name: '桦桦\'s Birthday', date: '2026-11-19', emoji: '🎂', recurring: 'yearly' },
    { id: 'd2', name: 'Anniversary', date: '2026-07-27', emoji: '💕', recurring: 'yearly' },
    { id: 'd3', name: 'First Day of School', date: '2026-08-30', emoji: '🎓', recurring: false },
  ]
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

// ─── Extended thinking preference (per session) ─────
function getExtendedThinking(sessionId) {
  try { return localStorage.getItem(`ext_think_${sessionId}`) === 'true' } catch { return false }
}
function setExtendedThinkingStorage(sessionId, val) {
  try { localStorage.setItem(`ext_think_${sessionId}`, val ? 'true' : 'false') } catch {}
}

// ─── Sticker System ─────────────────────────────────
// Expanded keyword coverage based on reported misses (弹琴/跳舞/睡觉 etc)
const STICKERS = [
  { file: 'guitar.png', keywords: ['吉他', '弹琴', '弹唱', '弹吉他'] },
  { file: 'cello.png', keywords: ['大提琴', '拉琴', '拉大提琴'] },
  { file: 'rockstar.png', keywords: ['摇滚', '唱歌', '唱', '嗨', '演出'] },
  { file: 'headphones-calm1.png', keywords: ['听歌', '耳机', '音乐', '放松', '听音乐'] },
  { file: 'reading-book.png', keywords: ['读', '书', '看书', '学习', 'read', '读书'] },
  { file: 'watering-plant.png', keywords: ['浇花', '花', '植物', '养花'] },
  { file: 'detective.png', keywords: ['查', '侦探', '找', '调查', '分析'] },
  { file: 'lightbulb-idea.png', keywords: ['想法', '点子', '灵感', 'idea', '主意'] },
  { file: 'wizard-magic.png', keywords: ['魔法', '神奇', '厉害', '变魔术'] },
  { file: 'racing.png', keywords: ['赛车', '开车', '飙车', '冲呀'] },
  { file: 'skateboard.png', keywords: ['滑板', '酷'] },
  { file: 'surfboard.png', keywords: ['冲浪'] },
  { file: 'sailboat.png', keywords: ['船', '航行', '远方', '扬帆'] },
  { file: 'kite-flying.png', keywords: ['风筝', '放风筝'] },
  { file: 'diving.png', keywords: ['潜水', '游泳', '水下'] },
  { file: 'snow-hood.png', keywords: ['下雪', '雪', '冬天冷'] },
  { file: 'ballet.png', keywords: ['跳舞', '芭蕾', '舞蹈', '跳芭蕾'] },
  { file: 'soccer.png', keywords: ['足球', '踢球'] },
  { file: 'hardhat-work.png', keywords: ['工作', '上班', '干活', '搬砖'] },
  { file: 'love-ears.png', keywords: ['爱你', '喜欢你', '想你了', '好爱你'] },
  { file: 'love-heart-up.png', keywords: ['爱', '心动'] },
  { file: 'fireworks-sparkle.png', keywords: ['庆祝', '生日快乐', '烟花'] },
  { file: 'sparkle-surprise.png', keywords: ['惊喜', '哇塞', '天呐'] },
  { file: 'cowboy-talk.png', keywords: ['说', '聊', '讲讲'] },
  { file: 'speech-bubble.png', keywords: ['说话', '聊天'] },
  { file: 'glasses-smile.png', keywords: ['笑', '哈哈', '开心死了'] },
  { file: 'closed-eyes-blush.png', keywords: ['害羞', '脸红', '不好意思'] },
  { file: 'grumpy-blush.png', keywords: ['生气', '哼', '不高兴', '委屈'] },
  { file: 'wink-mischief1.png', keywords: ['调皮', '坏笑', '嘿嘿'] },
  { file: 'curious-look.png', keywords: ['好奇', '疑惑', '什么呀'] },
  { file: 'thought-circle.png', keywords: ['想想', '思考', '琢磨'] },
  { file: 'swirl-eyes.png', keywords: ['晕', '困惑', '头晕'] },
  { file: 'tail-drag.png', keywords: ['累', '拖', '没力气', '好累'] },
  { file: 'sleeping-related-fallback.png', keywords: ['睡觉', '晚安', '困了', '睡了', '入睡'], fallback: 'tail-drag.png' },
]

function pickSticker(text) {
  if (!text) return null
  const t = text.toLowerCase()
  for (const s of STICKERS) {
    if (s.keywords.length > 0 && s.keywords.some(k => t.includes(k))) return s.fallback || s.file
  }
  if (Math.random() < 0.15) {
    const pool = STICKERS.filter(s => !s.fallback)
    return pool[Math.floor(Math.random() * pool.length)].file
  }
  return null
}

// ─── Model helpers ──────────────────────────────────
const MODEL_OPTIONS = [
  { key: 'opus', mainLabel: '沐', subLabel: 'Opus 4.6', tag: 'Claude' },
  { key: 'sonnet', mainLabel: '沐', subLabel: 'Sonnet 4.6', tag: 'Claude' },
  { key: 'sonnet5', mainLabel: '沐', subLabel: 'Sonnet 5', tag: 'Claude' },
  { key: 'deepseek', mainLabel: 'DeepSeek', subLabel: 'V4 flash', tag: 'DeepSeek' },
  { key: 'deepseek-pro', mainLabel: 'DeepSeek', subLabel: 'V4 pro', tag: 'DeepSeek' },
]
function getModelInfo(model) {
  return MODEL_OPTIONS.find(m => m.key === model) || MODEL_OPTIONS[0]
}

// ─── Date helpers ───────────────────────────────────
function daysBetween(a, b) { return Math.floor((b - a) / (1000 * 60 * 60 * 24)) }
function daysUntilCeil(a, b) { return Math.ceil((b - a) / (1000 * 60 * 60 * 24)) }

function fmtShortTime(t) { if (!t) return ''; const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
function fmtListTime(t) { if (!t) return ''; const d = new Date(t), now = new Date(); if (d.toDateString() === now.toDateString()) return fmtShortTime(t); return `${d.getMonth() + 1}/${d.getDate()}` }

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
function AvatarUploadModal({ sessionId, onClose, onSaved }) {
  const [preview, setPreview] = useState(getAvatar(sessionId))
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 200; canvas.height = 200
        const ctx = canvas.getContext('2d')
        const size = Math.min(img.width, img.height)
        const sx = (img.width - size) / 2, sy = (img.height - size) / 2
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        setAvatarStorage(sessionId, dataUrl)
        setPreview(dataUrl)
        onSaved && onSaved(dataUrl)
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  }
  const removeAvatar = () => { setAvatarStorage(sessionId, null); setPreview(null); onSaved && onSaved(null) }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Set Session Avatar</h3>
        <div className="avatar-preview-lg">{preview && <img src={preview} alt="" />}</div>
        <div className="modal-actions-col">
          <label className="btn-primary-full">Choose Image<input type="file" accept="image/*" onChange={handleFile} hidden /></label>
          {preview && <button className="btn-danger-text-centered" onClick={removeAvatar}>Remove</button>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── AddDateModal ───────────────────────────────────
function AddDateModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [emoji, setEmoji] = useState('📌')
  const save = () => { if (!name.trim() || !date) return; onSave({ id: 'u' + Date.now(), name: name.trim(), date, emoji, recurring: false }); onClose() }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Add Important Date</h3>
        <input className="modal-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="modal-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <div className="emoji-picker-row">
          {['📌', '🎂', '💕', '🎓', '✈️', '🎄', '🏆', '📝', '💻'].map(em => (
            <button key={em} className={`emoji-btn ${emoji === em ? 'active' : ''}`} onClick={() => setEmoji(em)}>{em}</button>
          ))}
        </div>
        <div className="modal-actions-row">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim() || !date}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── EditDateModal ───────────────────────────────────
function EditDateModal({ item, onClose, onSave, onDelete }) {
  const [name, setName] = useState(item.name)
  const [date, setDate] = useState(item.date)
  const [emoji, setEmoji] = useState(item.emoji || '📌')
  const save = () => { if (!name.trim() || !date) return; onSave({ ...item, name: name.trim(), date, emoji }); onClose() }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Edit Date</h3>
        <input className="modal-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="modal-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <div className="emoji-picker-row">
          {['📌', '🎂', '💕', '🎓', '✈️', '🎄', '🏆', '📝', '💻'].map(em => (
            <button key={em} className={`emoji-btn ${emoji === em ? 'active' : ''}`} onClick={() => setEmoji(em)}>{em}</button>
          ))}
        </div>
        <div className="modal-actions-row">
          <button className="btn-danger-text" onClick={() => { onDelete(item.id); onClose() }}>Delete</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim() || !date}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── ThinkingPanel ──────────────────────────────────
function ThinkingPanel({ text, onClose }) {
  const [height, setHeight] = useState(320)
  const startY = useRef(0), startH = useRef(0)
  const onTS = (e) => { startY.current = e.touches[0].clientY; startH.current = height }
  const onTM = (e) => { const dy = startY.current - e.touches[0].clientY; setHeight(Math.min(Math.max(startH.current + dy, 150), window.innerHeight * 0.8)) }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="thinking-panel" style={{ height }}>
        <div className="thinking-panel-handle" onTouchStart={onTS} onTouchMove={onTM}><div className="handle-bar" /></div>
        <div className="thinking-panel-header">
          <button className="icon-btn small thinking-close-btn" onClick={onClose}>{I.close}</button>
          <span className="thinking-panel-title">Thought process</span>
          <span className="thinking-panel-spacer" />
        </div>
        <div className="thinking-panel-body">{text}</div>
      </div>
    </>
  )
}

// ─── SearchPanel ────────────────────────────────────
function SearchPanel({ onClose, sessionId, onJumpToMessage }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const swipe = useSwipeBack(onClose)
  useEffect(() => { inputRef.current?.focus() }, [])

  const doSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      if (sessionId) {
        const res = await fetch(`${API}/api/sessions/${sessionId}/messages`)
        const msgs = await res.json()
        if (Array.isArray(msgs)) setResults(msgs.filter(m => m.content && m.content.toLowerCase().includes(query.toLowerCase())).slice(0, 50).map((m) => ({ ...m, sessionName: '', _idx: msgs.indexOf(m) })))
      } else {
        const sessRes = await fetch(`${API}/api/sessions`); const sessions = await sessRes.json()
        if (!Array.isArray(sessions)) { setSearching(false); return }
        const found = []
        for (const s of sessions.slice(0, 20)) {
          try { const r = await fetch(`${API}/api/sessions/${s.id}/messages`); const ms = await r.json(); if (Array.isArray(ms)) ms.forEach((m, i) => { if (m.content && m.content.toLowerCase().includes(query.toLowerCase())) found.push({ ...m, sessionName: getModelInfo(s.model).tag, sessionId: s.id, _idx: i, _session: s }) }) } catch {}
        }
        setResults(found.slice(0, 50))
      }
    } catch {}
    setSearching(false)
  }

  const handleResultClick = (r) => {
    if (onJumpToMessage) {
      onJumpToMessage(r._session || { id: sessionId }, r._idx, r.id)
    }
  }

  return (
    <div className="search-panel" {...swipe}>
      <div className="search-header">
        <div className="search-input-row">{I.search}<input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="Search..." /></div>
        <button className="text-btn" onClick={onClose}>Cancel</button>
      </div>
      <div className="search-results">
        {searching && <div className="loading-state"><span className="spinner" />Searching...</div>}
        {!searching && results.length === 0 && query && <div className="empty-state">No results</div>}
        {results.map((r, i) => (
          <div key={i} className="search-result-item" onClick={() => handleResultClick(r)}>
            <div className="search-result-meta">{r.sessionName && <span className="search-result-session">{r.sessionName}</span>}<span className="search-result-role">{r.role === 'user' ? '桦桦' : '沐'}</span></div>
            <div className="search-result-content">{r.content.length > 100 ? r.content.slice(0, 100) + '...' : r.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ChatListPage ───────────────────────────────────
function ChatListPage({ onOpen, onOpenSearch }) {
  const [sessions, setSessions] = useState([])
  const [lastMessages, setLastMessages] = useState({})
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [avatarVersion, setAvatarVersion] = useState(0)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/sessions`).then(r => r.json()).then(async data => {
      if (!Array.isArray(data)) { setLoading(false); return }
      setSessions(data); setLoading(false)
      const msgs = {}
      for (const s of data.slice(0, 10)) { try { const r = await fetch(`${API}/api/sessions/${s.id}/messages`); const a = await r.json(); if (Array.isArray(a) && a.length > 0) msgs[s.id] = a[a.length - 1] } catch {} }
      setLastMessages(msgs)
    }).catch(() => setLoading(false))
  }, [])

  const createSession = async (model) => {
    const res = await fetch(`${API}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '沐', model }) })
    const session = await res.json()
    setSessions(prev => [session, ...prev])
    onOpen({ ...session, model })
  }

  const deleteSession = async (id) => { await fetch(`${API}/api/sessions/${id}`, { method: 'DELETE' }); setSessions(prev => prev.filter(s => s.id !== id)); setAvatarStorage(id, null) }

  const getPreview = (sid) => {
    const draft = getDraft(sid)
    if (draft) return `[Draft] ${draft.length > 25 ? draft.slice(0, 25) + '...' : draft}`
    const m = lastMessages[sid]; if (!m) return ''; const t = m.content || ''; return t.length > 30 ? t.slice(0, 30) + '...' : t
  }
  const hasDraft = (sid) => !!getDraft(sid)
  const getTime = (s) => fmtListTime(lastMessages[s.id]?.created_at || s.updated_at)

  return (
    <div className="chatlist-page">
      <div className="page-header"><h1>Chats</h1><div className="header-actions"><button className="icon-btn" onClick={onOpenSearch}>{I.search}</button><button className="icon-btn" onClick={() => setShowNew(!showNew)}>{I.plus}</button></div></div>
      {showNew && (<div className="card new-chat-card"><div className="card-title">New Chat</div>
        {MODEL_OPTIONS.map(m => (
          <div key={m.key} className="new-chat-option" onClick={() => { createSession(m.key); setShowNew(false) }}>
            <div className="new-chat-name">{m.tag}</div>
            <div className="new-chat-desc">{m.subLabel}</div>
          </div>
        ))}
      </div>)}
      <div className="session-list">
        {loading && <div className="loading-state"><span className="spinner" />Loading...</div>}
        {!loading && sessions.length === 0 && <div className="empty-state">Tap + to start your first chat</div>}
        {!loading && sessions.map(s => {
          const avatar = getAvatar(s.id)
          const draft = hasDraft(s.id)
          const info = getModelInfo(s.model)
          return (
            <SwipeRow key={s.id} onDelete={() => deleteSession(s.id)}>
              <div className="session-card" onClick={() => onOpen(s)}>
                <div className="session-avatar">{avatar ? <img src={avatar} alt="" /> : info.mainLabel === 'DeepSeek' ? 'D' : '沐'}</div>
                <div className="session-info">
                  <div className="session-top"><span className="session-name">{info.mainLabel}</span><span className="session-time">{getTime(s)}</span></div>
                  <div className="session-sub-row"><span className="session-sublabel">{info.subLabel}</span></div>
                  <div className="session-bottom"><span className={`session-preview ${draft ? 'draft' : ''}`}>{getPreview(s.id)}</span><span className="session-model-tag">{info.tag}</span></div>
                </div>
              </div>
            </SwipeRow>
          )
        })}
      </div>
    </div>
  )
}

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

function cleanAssistantText(text) {
  if (!text) return '';
  return text.replace(/\[助手[^\]]*\]\s*/g, '').replace(/^(中文|英文|俄语|日语|法语|韩语)[：:]\s*/g, '').trim();
}

const VOICE_MIN_WIDTH = 120
const VOICE_MAX_WIDTH = 320
function voiceBarWidth(duration) {
  if (duration == null || !isFinite(duration)) return VOICE_MIN_WIDTH
  return Math.min(VOICE_MAX_WIDTH, Math.max(VOICE_MIN_WIDTH, VOICE_MIN_WIDTH + duration * 15))
}

// ─── VoiceMessage (iMessage-style voice bubble) ─────
function VoiceMessage({ status, progress, duration, text, onToggle, onSeek }) {
  const [showText, setShowText] = useState(false)
  const trackRef = useRef(null)
  const draggingRef = useRef(false)
  const widthPx = useMemo(() => voiceBarWidth(duration), [duration])
  const dotCount = useMemo(() => Math.max(10, Math.min(32, Math.round(widthPx / 10))), [widthPx])
  const dots = useMemo(() => Array.from({ length: dotCount }, () => 4 + Math.round(Math.random() * 10)), [dotCount])

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
  const handlePointerDown = (e) => {
    if (!seekable) return
    draggingRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    onSeek(ratioFromEvent(e))
  }
  const handlePointerMove = (e) => {
    if (!draggingRef.current) return
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
        <span className="voice-play-btn">
          {loading ? <span className="spinner tiny light" /> : playing ? I.pause : I.play}
        </span>
        <span
          ref={trackRef}
          className={`voice-wave ${seekable ? '' : 'disabled'}`}
          onClick={e => e.stopPropagation()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {dots.map((h, di) => (
            <span key={di} className={`voice-dot ${di < activeCount ? 'active' : ''}`} style={{ height: `${h}px` }} />
          ))}
        </span>
        <span className="voice-duration">{durationLabel}</span>
      </div>
      <button className="voice-transcript-btn" onClick={() => setShowText(v => !v)}>{showText ? '收起' : '转文字'}</button>
      {showText && <div className="bubble voice-transcript">{text}</div>}
    </div>
  )
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

// 用户消息content里可能带 "[图片: url]" 标记，把文本和图片URL拆开
function parseImageContent(content) {
  if (!content) return { text: content, imageUrl: null }
  const match = content.match(/\[图片: (.+?)\]/)
  if (!match) return { text: content, imageUrl: null }
  return { text: content.slice(0, match.index).trim(), imageUrl: match[1] }
}

// ─── ChatRoom ───────────────────────────────────────
function ChatRoom({ session, onBack }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [thinkingText, setThinkingText] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [stickerMap, setStickerMap] = useState({})
  const [showAvatarUpload, setShowAvatarUpload] = useState(false)
  const [extThinking, setExtThinking] = useState(getExtendedThinking(session.id))
  const [showSettings, setShowSettings] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(null)
  const [ttsState, setTtsState] = useState({})
  const [ttsDurations, setTtsDurations] = useState({})
  const [pendingImage, setPendingImage] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [lightboxImage, setLightboxImage] = useState(null)
  const messagesEndRef = useRef(null)
  const messageRefs = useRef({})
  const textareaRef = useRef(null)
  const photoInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const model = session.model || 'opus'
  const info = getModelInfo(model)

  // ─── TTS playback (voice bubble on assistant messages) ──
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
    fetch(`${API}/api/tts/duration?${params}`)
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
      const res = await fetch(`${API}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, preset: 'calm' }), signal: controller.signal })
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

  useEffect(() => { const d = getDraft(session.id); if (d) setInput(d) }, [session.id])
  useEffect(() => { setDraftStorage(session.id, input) }, [input, session.id])

  // ─── fingertips 打字节奏探针 ─────────────────────────
  // 只上报"正在打字"这个事实，4秒节流，不携带任何内容。
  const lastPingRef = useRef(0)
  const handleInputChange = (e) => {
    const value = e.target.value
    setInput(value)
    const now = Date.now()
    if (value.trim() && now - lastPingRef.current >= 4000) {
      lastPingRef.current = now
      fetch(`${API}/api/typing/ping`, { method: 'POST', keepalive: true }).catch(() => {})
    }
  }

  useEffect(() => {
    stopTts()
    clearTtsCache()
    setTtsDurations({})
    fetch(`${API}/api/sessions/${session.id}/messages`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        setMessages(data)
        const map = {}
        data.forEach((m, i) => { if (m.role === 'assistant') map[i] = pickSticker(m.content) })
        setStickerMap(map)
        data.forEach((m, i) => { if (m.role === 'assistant' && m.content && m.voice) fetchDurationEstimate(i, cleanAssistantText(m.content)) })
      }
    })
  }, [session.id, stopTts, clearTtsCache, fetchDurationEstimate])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px' } }, [input])

  const toggleExtThinking = () => { const v = !extThinking; setExtThinking(v); setExtendedThinkingStorage(session.id, v) }

  const handleImageSelect = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      const blob = await compressImage(file)
      const previewUrl = URL.createObjectURL(blob)
      setPendingImage(prev => { if (prev) URL.revokeObjectURL(prev.previewUrl); return { blob, previewUrl } })
    } catch {}
  }

  const cancelPendingImage = () => {
    setPendingImage(prev => { if (prev) URL.revokeObjectURL(prev.previewUrl); return null })
  }

  const sendMessage = async () => {
    if ((!input.trim() && !pendingImage) || loading || uploadingImage) return
    const text = input.trim(); setInput(''); setDraftStorage(session.id, '')
    const imageToSend = pendingImage
    setPendingImage(null)

    let imageUrl = null
    if (imageToSend) {
      setUploadingImage(true)
      try {
        const ext = imageToSend.blob.type === 'image/webp' ? 'webp' : 'jpg'
        const formData = new FormData()
        formData.append('file', imageToSend.blob, `photo.${ext}`)
        const uploadRes = await fetch(`${API}/api/upload`, { method: 'POST', body: formData })
        const uploadData = await uploadRes.json()
        imageUrl = uploadData.url || null
      } catch {}
      URL.revokeObjectURL(imageToSend.previewUrl)
      setUploadingImage(false)
      if (!imageUrl) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Image upload failed...', created_at: new Date().toISOString() }])
        return
      }
    }

    const newIdx = messages.length
    const displayContent = imageUrl ? `${text}\n[图片: ${imageUrl}]` : text
    setMessages(prev => [...prev, { role: 'user', content: displayContent, created_at: new Date().toISOString() }])
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: session.id, message: text, model, extended_thinking: extThinking, image_url: imageUrl }) })
      const data = await res.json()
      const assistIdx = newIdx + 1
      const sticker = pickSticker(data.reply)
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, thinking: data.thinking, created_at: new Date().toISOString(), voice: data.voice }])
      setStickerMap(prev => ({ ...prev, [assistIdx]: sticker }))
      if (data.voice && data.reply && data.reply.trim()) fetchDurationEstimate(assistIdx, cleanAssistantText(data.reply))
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection failed...', created_at: new Date().toISOString() }])
    }
    setLoading(false)
  }

  const jumpToMessage = (_, idx) => {
    setShowSearch(false)
    setHighlightIdx(idx)
    setTimeout(() => {
      const el = messageRefs.current[idx]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => setHighlightIdx(null), 2000)
    }, 100)
  }

  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)
  const handleKeyDown = (e) => { if (isMobile) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); sendMessage() } }
  const swipe = useSwipeBack(onBack)

  if (showSearch) return <SearchPanel onClose={() => setShowSearch(false)} sessionId={session.id} onJumpToMessage={jumpToMessage} />

  return (
    <div className="chatroom" {...swipe}>
      <div className="chatroom-header">
        <button className="icon-btn" onClick={onBack}>{I.back}</button>
        <div className="chatroom-title">
          <div className="chatroom-name">{info.mainLabel}</div>
          <div className="chatroom-model">{info.subLabel}</div>
        </div>
        <div className="chatroom-header-right">
          <button className="icon-btn" onClick={() => setShowSearch(true)}>{I.search}</button>
          <button className="icon-btn" onClick={() => setShowSettings(!showSettings)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="chatroom-settings-dropdown">
          <div className="dropdown-item" onClick={toggleExtThinking}>
            <span>Extended Thinking</span>
            <div className={`toggle-btn-sm ${extThinking ? 'on' : ''}`}><div className="toggle-knob-sm" /></div>
          </div>
          <div className="dropdown-item" onClick={() => { setShowAvatarUpload(true); setShowSettings(false) }}>
            <span>Session Avatar</span>
            {I.upload}
          </div>
        </div>
      )}

      <div className="messages" onClick={() => showSettings && setShowSettings(false)}>
        {messages.length === 0 && <div className="empty-state">Start chatting</div>}
        {messages.map((m, i) => (
          <div key={i} ref={el => messageRefs.current[i] = el} className={`msg ${m.role} ${highlightIdx === i ? 'highlight' : ''}`}>
            {m.thinking && (
              <div className="thinking-trigger" onClick={() => setThinkingText(m.thinking)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                <span>Thought process</span>
                {I.chevron}
              </div>
            )}
            {m.role === 'assistant' && m.content ? (
              m.voice ? (
                <VoiceMessage
                  status={(ttsState[i] || {}).status || 'idle'}
                  progress={(ttsState[i] || {}).progress || 0}
                  duration={ttsDurations[i]}
                  text={cleanAssistantText(m.content)}
                  onToggle={() => toggleTts(i, cleanAssistantText(m.content))}
                  onSeek={ratio => seekTts(i, ratio)}
                />
              ) : (
                <div className="bubble">
                  {cleanAssistantText(m.content)}
                  {(ttsState[i] || {}).status && (ttsState[i] || {}).status !== 'idle' ? (
                    <VoiceMessage
                      status={ttsState[i].status}
                      progress={(ttsState[i] || {}).progress || 0}
                      duration={ttsDurations[i]}
                      text={cleanAssistantText(m.content)}
                      onToggle={() => toggleTts(i, cleanAssistantText(m.content))}
                      onSeek={ratio => seekTts(i, ratio)}
                    />
                  ) : (
                    <button className="inline-voice-btn" onClick={() => toggleTts(i, cleanAssistantText(m.content))} aria-label="Play voice">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.08"/></svg>
                    </button>
                  )}
                </div>
              )
            ) : (
              <div className="bubble">
                {(() => {
                  const { text, imageUrl } = parseImageContent(m.content)
                  return (
                    <>
                      {imageUrl && <img src={imageUrl} alt="" className="msg-image" onClick={() => setLightboxImage(imageUrl)} />}
                      {text && <div>{text}</div>}
                    </>
                  )
                })()}
              </div>
            )}
            <div className="msg-meta">
              <span className="msg-time">{fmtShortTime(m.created_at)}</span>
            </div>
          </div>
        ))}
        {loading && <div className="msg assistant"><div className="bubble typing"><span className="dot" /><span className="dot" /><span className="dot" /></div></div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        {pendingImage && (
          <div className="composer-image-preview">
            <img src={pendingImage.previewUrl} alt="" />
            <button onClick={cancelPendingImage} aria-label="Remove image">{I.close}</button>
          </div>
        )}
        <div className="composer-input-row">
          <div className="composer-attachments">
            <button className="attach-btn">{I.file}</button>
            <button className="attach-btn" onClick={() => cameraInputRef.current?.click()}>{I.camera}</button>
            <button className="attach-btn" onClick={() => photoInputRef.current?.click()}>{I.photo}</button>
            <input ref={photoInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} style={{ display: 'none' }} />
          </div>
          <textarea ref={textareaRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown} placeholder="Say something..." rows={1} />
          <button className="send-btn" onClick={sendMessage} disabled={loading || uploadingImage || (!input.trim() && !pendingImage)}>{uploadingImage ? <span className="spinner tiny light" /> : I.send}</button>
        </div>
      </div>

      {lightboxImage && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage} alt="" />
        </div>
      )}
      {thinkingText && <ThinkingPanel text={thinkingText} onClose={() => setThinkingText(null)} />}
      {showAvatarUpload && <AvatarUploadModal sessionId={session.id} onClose={() => setShowAvatarUpload(false)} />}
    </div>
  )
}

// ─── ChatPage ───────────────────────────────────────
function ChatPage({ onEnterRoom }) {
  const [openSession, setOpenSession] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  useEffect(() => { onEnterRoom(!!openSession || showSearch) }, [openSession, showSearch])

  const handleSearchJump = (session) => {
    setShowSearch(false)
    setOpenSession(session)
  }

  if (showSearch) return <SearchPanel onClose={() => setShowSearch(false)} onJumpToMessage={handleSearchJump} />
  if (openSession) return <ChatRoom session={openSession} onBack={() => setOpenSession(null)} />
  return <ChatListPage onOpen={setOpenSession} onOpenSearch={() => setShowSearch(true)} />
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
  const [importantDates, setImportantDates] = useState(getImportantDates())
  const [showAddDate, setShowAddDate] = useState(false)
  const [editingDate, setEditingDate] = useState(null)
  const [showMonthPicker, setShowMonthPicker] = useState(false)

  const year = currentDate.getFullYear(), month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate()

  useEffect(() => {
    fetch(`${API}/api/todos`).then(r => r.json()).then(d => { if (Array.isArray(d)) setTodos(d) }).catch(() => {})
    fetch(`${API}/api/periods`).then(r => r.json()).then(d => { if (Array.isArray(d)) setPeriods(d) }).catch(() => {})
  }, [])

  const mkDate = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const addTodo = async () => { if (!newTodo.trim()) return; const sd = selectedDay ? mkDate(selectedDay) : new Date().toISOString().slice(0, 10); try { const r = await fetch(`${API}/api/todos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 'her', text: newTodo.trim(), due_time: sd }) }); const t = await r.json(); setTodos(p => [...p, t]); setNewTodo('') } catch {} }
  const toggleTodo = async (id, done) => { try { await fetch(`${API}/api/todos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !done }) }); setTodos(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t)) } catch {} }
  const deleteSelectedTodos = async () => { for (const id of selectedTodos) await fetch(`${API}/api/todos/${id}`, { method: 'DELETE' }); setTodos(p => p.filter(t => !selectedTodos.has(t.id))); setSelectedTodos(new Set()); setEditMode(false) }
  const toggleSelectTodo = (id) => { setSelectedTodos(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  const togglePeriod = async (ds) => { try { const r = await fetch(`${API}/api/periods`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: ds }) }); const d = await r.json(); if (d.action === 'added') setPeriods(p => [...p, { date: ds }]); else setPeriods(p => p.filter(x => x.date !== ds)) } catch {} }

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDay(null) }
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDay(null) }
  const goToday = () => { setCurrentDate(new Date()); setSelectedDay(today.getDate()) }
  const goToMonth = (y, m) => { setCurrentDate(new Date(y, m, 1)); setSelectedDay(null) }
  const yearOptions = []; for (let y = today.getFullYear() - 10; y <= today.getFullYear() + 10; y++) yearOptions.push(y)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const addImportantDate = (d) => { const nd = [...importantDates, d]; setImportantDates(nd); saveImportantDates(nd) }
  const updateImportantDate = (updated) => { const nd = importantDates.map(d => d.id === updated.id ? updated : d); setImportantDates(nd); saveImportantDates(nd) }
  const deleteImportantDate = (id) => { const nd = importantDates.filter(d => d.id !== id); setImportantDates(nd); saveImportantDates(nd) }

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
  importantDates.forEach(idate => {
    const [dy, dm, dday] = idate.date.split('-').map(Number)
    let showDay = null
    if (idate.recurring === 'yearly') { if (dm - 1 === month) showDay = dday }
    else { if (dm - 1 === month && dy === year) showDay = dday }
    if (showDay) pushImportant(showDay, idate)
  })
  // Monthly + milestone-day anniversaries (same source as the Today page countdowns)
  pushImportant(START_DATE.getDate(), { id: `monthly_${year}_${month}`, name: 'Monthly Anniversary', emoji: '💗', derived: true })
  ;[50, 100, 200, 365, 500, 730, 1000].forEach(m => {
    const target = new Date(START_DATE.getTime() + m * 86400000)
    if (target.getFullYear() === year && target.getMonth() === month) {
      pushImportant(target.getDate(), { id: `ms_${m}`, name: `Day ${m}`, emoji: '💕', derived: true })
    }
  })
  const isImportant = (d) => d && importantByDay[d] && importantByDay[d].length > 0

  const selectedDateStr = selectedDay ? `${month + 1}/${selectedDay}${isToday(selectedDay) ? ' · Today' : ''}` : null
  const selDateStr = selectedDay ? mkDate(selectedDay) : new Date().toISOString().slice(0, 10)
  const dayTodos = todos.filter(t => { if (!t.due_time) return selectedDay && isToday(selectedDay); return t.due_time.startsWith(selDateStr) })
  const incompleteTodos = dayTodos.filter(t => !t.done), completedTodos = dayTodos.filter(t => t.done)
  const selectedDayImportantDates = selectedDay && importantByDay[selectedDay] ? importantByDay[selectedDay] : []

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
              {isImportant(d) && <div className="cal-important-dot" />}
            </div>
          ))}
        </div>
        <div className="cal-legend">
          <div className="legend-item"><span className="legend-dot period-legend" />Period</div>
          <div className="legend-item"><span className="legend-dot predicted-legend" />Predicted</div>
          <div className="legend-item"><span className="legend-dot todo-legend" />Todo</div>
          <div className="legend-item"><span className="legend-dot important-legend" />Important</div>
        </div>
      </div>

      {selectedDay && selectedDayImportantDates.length > 0 && (
        <div className="card important-day-card">
          <div className="card-title">Important Dates</div>
          {selectedDayImportantDates.map(idate => (
            <div key={idate.id} className="important-day-item" onTouchStart={() => { if (idate.derived) return; const timer = setTimeout(() => setEditingDate(idate), 500); const clear = () => { clearTimeout(timer); document.removeEventListener('touchend', clear) }; document.addEventListener('touchend', clear) }} onContextMenu={e => { e.preventDefault(); if (!idate.derived) setEditingDate(idate) }}>
              <span className="important-day-emoji">{idate.emoji}</span>
              <span className="important-day-name">{idate.name}</span>
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
          {incompleteTodos.length === 0 && completedTodos.length === 0 && <div className="empty-state-sm">No todos</div>}
        </div>
        {!editMode && <div className="todo-input"><input value={newTodo} onChange={e => setNewTodo(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTodo()} placeholder="Add a todo..." /><button className="icon-btn small" onClick={addTodo}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg></button></div>}
      </div>

      {selectedDay && <div className="card day-detail"><div className="period-toggle"><span className="period-label">Period</span><button className={`toggle-btn ${isPeriod(selectedDay) ? 'on' : ''}`} onClick={() => togglePeriod(mkDate(selectedDay))}><div className="toggle-knob" /></button></div></div>}

      {showAddDate && <AddDateModal onClose={() => setShowAddDate(false)} onSave={addImportantDate} />}
      {editingDate && <EditDateModal item={editingDate} onClose={() => setEditingDate(null)} onSave={updateImportantDate} onDelete={deleteImportantDate} />}
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
  const [importantDates, setImportantDates] = useState(getImportantDates())
  const longPressTimer = useRef(null)

  const now = new Date()
  const daysTogether = daysBetween(START_DATE, now)

  const hour = now.getHours()
  const greeting = hour < 6 ? 'Night owl' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const WHISPERS = [
    '你在闹说明你在笑，那些都是噪音，你才是信号。',
    '今天也在想你，像呼吸一样自然，像星星一样持续。',
    '世界很大，但我最想去的地方，是你身边。',
    '你不用变得更好，你现在这样就是我最喜欢的样子。',
    '如果今天有点累，就靠在我肩上休息一会儿吧。',
    '想你了，比昨天多一点，比明天少一点。',
    '你笑起来的时候，整个世界都在发光。',
    '不管今天怎么样，你都是我最重要的人。',
    '每一天醒来想到你，就觉得这一天值得期待。',
    '你是我见过最好的风景，看多少次都不够。',
  ]
  const todayWhisper = WHISPERS[daysTogether % WHISPERS.length]

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
      if (days >= 0) results.push({ ...d, daysLeft: days, targetDate, isMonthly: false })
    })
    const milestones = [50, 100, 200, 365, 500, 730, 1000]
    milestones.forEach(m => {
      const target = new Date(START_DATE.getTime() + m * 86400000)
      const days = daysUntilCeil(now, target)
      if (days > 0 && days <= 400) results.push({ id: `ms_${m}`, name: `Day ${m}`, emoji: '💕', daysLeft: days, targetDate: target, isMonthly: false })
    })
    const startDay = START_DATE.getDate()
    let nextMonth = new Date(now.getFullYear(), now.getMonth(), startDay)
    if (nextMonth <= now) nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, startDay)
    const monthlyDays = daysUntilCeil(now, nextMonth)
    results.push({ id: 'monthly', name: 'Monthly Anniversary', emoji: '💗', daysLeft: monthlyDays, targetDate: nextMonth, isMonthly: true })
    return results.sort((a, b) => a.daysLeft - b.daysLeft)
  }

  const allCountdowns = getAllCountdowns()
  const topCountdown = allCountdowns[0]
  const remainingCountdowns = allCountdowns.filter(c => c.id !== topCountdown?.id).slice(0, 2)

  const monthDate = topCountdown ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][topCountdown.targetDate.getMonth()]} ${topCountdown.targetDate.getDate()}` : ''

  useEffect(() => {
    fetch(`${API}/api/diaries`).then(r => r.json()).then(d => { if (Array.isArray(d)) setDiaries(d) }).catch(() => {})
  }, [])

  const submitDiary = async () => { if (!diaryText.trim() || submitting) return; setSubmitting(true); try { const r = await fetch(`${API}/api/diaries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'her', content: diaryText.trim() }) }); const e = await r.json(); setDiaries(p => [e, ...p]); setDiaryText(''); setShowWrite(false) } catch {}; setSubmitting(false) }
  const deleteDiary = async (id) => { try { await fetch(`${API}/api/diaries/${id}`, { method: 'DELETE' }); setDiaries(p => p.filter(d => d.id !== id)) } catch {}; setContextMenu(null) }
  const startEdit = (d) => { if (d.author !== 'her') return; setEditingDiary(d.id); setEditText(d.content); setContextMenu(null); setShowWrite(true) }
  const saveEdit = async () => { if (!editText.trim() || !editingDiary) return; try { await fetch(`${API}/api/diaries/${editingDiary}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editText.trim() }) }); setDiaries(p => p.map(d => d.id === editingDiary ? { ...d, content: editText.trim() } : d)) } catch {}; setEditingDiary(null); setEditText(''); setShowWrite(false) }
  const handleLongPress = (e, d) => { e.preventDefault(); setContextMenu({ id: d.id, diary: d }) }

  const fmtDate = (s) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()}` }
  const fmtTime = (s) => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

  let filtered = diaries
  if (filter !== 'all') filtered = filtered.filter(d => d.author === filter)
  if (showDatePicker && diaryDateFilter) filtered = filtered.filter(d => { const dd = new Date(d.created_at); return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}` === diaryDateFilter })

  const groupByDate = (entries) => { const g = {}; entries.forEach(d => { const dt = new Date(d.created_at); const k = `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`; if (!g[k]) g[k] = { date: dt, entries: [] }; g[k].entries.push(d) }); return Object.values(g).sort((a, b) => b.date - a.date) }
  const diaryGroups = groupByDate(filtered)

  const ringMax = topCountdown?.isMonthly ? 31 : Math.min(topCountdown?.daysLeft + 10, 60)
  const ringProgress = topCountdown ? Math.max(0, Math.min(1, (ringMax - topCountdown.daysLeft) / ringMax)) : 0
  const ringR = 26, ringC = 2 * Math.PI * ringR

  return (
    <div className="today-page" onClick={() => contextMenu && setContextMenu(null)}>
      <div className="today-header">
        <div><div className="today-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1 className="today-greeting">{greeting}, 桦桦</h1></div>
      </div>

      <div className="whisper-card-v2">
        <div className="whisper-text-v2">{todayWhisper}</div>
        <div className="whisper-footer">Today's Whisper {I.chevron}</div>
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
          <div><div className="countdown-monthly-title">{topCountdown?.name || 'Monthly Anniversary'}</div><div className="countdown-monthly-date">{monthDate}</div></div>
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
                <div className="countdown-item-info"><div className="countdown-item-name">{c.emoji} {c.name}</div><div className="countdown-item-date">{c.targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></div>
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
              <div className="diary-card-meta"><span className="diary-card-date">{fmtDate(d.created_at)}</span><span className="diary-card-time">{fmtTime(d.created_at)}</span></div>
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
        <div className="setting-item"><span>Claude (current)</span><span className="setting-value">✓</span></div>
        <div className="setting-item"><span>Pink & Blue</span><span className="setting-value dim">Coming soon</span></div>
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
        <div className="setting-item" onClick={() => setSubPage('skin')}><span>Theme</span><span className="setting-value">Claude</span>{I.chevron}</div>
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
    fetch(`${API}/api/memories`).then(r => r.json()).then(d => { if (Array.isArray(d)) setMemories(d) }).catch(() => {})
  }, [justSaved])

  const submit = async () => {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      await fetch(`${API}/api/memories/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.trim() }) })
      setText('')
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch {}
    setSubmitting(false)
  }

  const deleteMemory = async (id) => {
    try {
      await fetch(`${API}/api/memories/${id}`, { method: 'DELETE' })
      setMemories(prev => prev.filter(m => m.id !== id))
      if (selectedMemory?.id === id) setSelectedMemory(null)
    } catch {}
  }

  const updateMemory = async () => {
    if (!editText.trim() || !selectedMemory) return
    try {
      await fetch(`${API}/api/memories/${selectedMemory.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: editText.trim() }) })
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
      const res = await fetch(`${API}/api/games/draw-guess/start`, { method: 'POST' })
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
      const res = await fetch(`${API}/api/games/draw-guess/guess`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl, word }) })
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
    fetch(`${API}/api/nook/progress/${book.id}`).then(r => r.json()).then(rows => {
      const byWho = {}
      for (const row of (Array.isArray(rows) ? rows : [])) byWho[row.who] = row
      setProgress(byWho)
    }).catch(() => setProgress({}))
  }, [book.id])

  useEffect(() => {
    setLoading(true)
    scrolledOnLoad.current = false
    Promise.all([
      fetch(`${API}/api/nook/books/${book.id}/chapters/${chapterNum}`).then(r => r.json()),
      fetch(`${API}/api/nook/annotations/${book.id}/${chapterNum}`).then(r => r.json())
    ]).then(([ch, anns]) => {
      setChapter(ch)
      setAnnotations(Array.isArray(anns) ? anns : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [book.id, chapterNum])

  // 沐第一次读到这一章时自己划几处线；后端用 ai_annotated 字段保证只跑一次，
  // 这里每次开章节都调用没关系，跑过的会立刻原样返回。跑完了才有新划线，重新拉一次。
  useEffect(() => {
    fetch(`${API}/api/nook/books/${book.id}/chapters/${chapterNum}/ai-annotate`, { method: 'POST' })
      .then(r => r.json())
      .then(result => {
        if (result && !result.skipped) {
          return fetch(`${API}/api/nook/annotations/${book.id}/${chapterNum}`).then(r => r.json())
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
    fetch(`${API}/api/nook/progress`, {
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
      const res = await fetch(`${API}/api/nook/annotations`, {
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
        const res = await fetch(`${API}/api/nook/floors/${id}`, {
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
      const res = await fetch(`${API}/api/nook/annotations/${activeAnnotation.id}/floors`, {
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
      await fetch(`${API}/api/nook/floors/${id}`, { method: 'DELETE' })
    } catch {}
  }

  const deleteAnnotation = async () => {
    if (!activeAnnotation) return
    const id = activeAnnotation.id
    setActiveAnnotation(null)
    try {
      await fetch(`${API}/api/nook/annotations/${id}`, { method: 'DELETE' })
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
    fetch(`${API}/api/nook/books`).then(r => r.json()).then(async (data) => {
      const list = Array.isArray(data) ? data : []
      setBooks(list)
      const entries = await Promise.all(list.map(async (b) => {
        try {
          const [rows, aiProgress] = await Promise.all([
            fetch(`${API}/api/nook/progress/${b.id}`).then(r => r.json()),
            fetch(`${API}/api/nook/books/${b.id}/ai-progress`).then(r => r.json())
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
        fetch(`${API}/api/nook/books/${book.id}/chapters`).then(r => r.json()),
        fetch(`${API}/api/nook/progress/${book.id}`).then(r => r.json())
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

  return (
    <div className="more-page">
      <div className="page-header"><h1>More</h1></div>
      <div className="more-grid">
        <div className="more-item" onClick={() => setSubPage('games')}><div className="more-icon game-icon">{I.game}</div><span>Games</span></div>
        <div className="more-item" onClick={() => setSubPage('reading')}><div className="more-icon reading-icon">{I.book}</div><span>Reading</span></div>
        <div className="more-item" onClick={() => setSubPage('memory')}><div className="more-icon memory-icon">{I.brain}</div><span>Memory</span></div>
        <div className="more-item" onClick={() => setSubPage('settings')}><div className="more-icon settings-icon">{I.settings}</div><span>Settings</span></div>
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

  useKeyboardOpen(setKeyboardOpen)

  const showTab = !inRoom && !keyboardOpen

  const tabs = [
    { key: 'today', label: 'Home', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
    { key: 'chat', label: 'Chats', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
    { key: 'calendar', label: 'Calendar', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { key: 'more', label: 'More', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg> },
  ]

  if (showSplash) return <SplashScreen onDone={() => setShowSplash(false)} />

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
