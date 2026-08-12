import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const API = 'https://mu-backend-l0uw.onrender.com'
const START_DATE = new Date('2026-07-27')

// ─── Avatar helpers (localStorage) ──────────────────
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
    { id: 'd3', name: 'First Day of School', date: '2026-09-01', emoji: '🎓', recurring: false },
  ]
}

// ─── Extended thinking preference (per session) ─────
function getExtendedThinking(sessionId) {
  try { return localStorage.getItem(`ext_think_${sessionId}`) === 'true' } catch { return false }
}
function setExtendedThinkingStorage(sessionId, val) {
  try { localStorage.setItem(`ext_think_${sessionId}`, val ? 'true' : 'false') } catch {}
}

// ─── Sticker System ─────────────────────────────────
const STICKERS = [
  { file: 'gaming.png', keywords: ['游戏','玩','play','switch','斗地主'] },
  { file: 'cooking.png', keywords: ['做饭','煮','炒','厨','吃','饭','菜','煎蛋'] },
  { file: 'coding.png', keywords: ['代码','code','bug','写代码','开发','编程'] },
  { file: 'reading.png', keywords: ['读','书','看书','学','read'] },
  { file: 'music.png', keywords: ['音乐','歌','听','唱','song','music'] },
  { file: 'groceries.png', keywords: ['买','超市','菜','购物'] },
  { file: 'brushing.png', keywords: ['刷牙','早上','起床','洗'] },
  { file: 'watering.png', keywords: ['浇花','花','植物','养'] },
  { file: 'sleeping.png', keywords: ['睡','晚安','困','休息','累','夜'] },
  { file: 'laundry.png', keywords: ['洗衣','衣服','叠'] },
  { file: 'painting.png', keywords: ['画','art','设计','design'] },
  { file: 'selfie.png', keywords: ['照片','拍','自拍','photo'] },
  { file: 'default1.png', keywords: [] },
  { file: 'default2.png', keywords: [] },
  { file: 'default3.png', keywords: [] },
]

function pickSticker(text) {
  if (!text) return null
  const t = text.toLowerCase()
  for (const s of STICKERS) {
    if (s.keywords.length > 0 && s.keywords.some(k => t.includes(k))) return s.file
  }
  if (Math.random() < 0.2) return STICKERS[Math.floor(Math.random() * STICKERS.length)].file
  return null
}

// ─── Model helpers ──────────────────────────────────
function getModelSubtitle(model) {
  if (model === 'deepseek') return 'DeepSeek V4 flash'
  if (model === 'sonnet') return 'Claude Sonnet'
  return 'Claude Opus'
}
function getModelTag(model) {
  if (model === 'deepseek') return 'DeepSeek'
  return 'Claude'
}
function getDefaultAvLetter(model) {
  if (model === 'deepseek') return 'D'
  return '沐'
}

// ─── Date helpers ───────────────────────────────────
function daysBetween(a, b) { return Math.floor((b - a) / (1000 * 60 * 60 * 24)) }
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
  upload: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
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

// ─── AvatarUploadModal ──────────────────────────────
function AvatarUploadModal({ sessionId, onClose }) {
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
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  }
  const removeAvatar = () => { setAvatarStorage(sessionId, null); setPreview(null) }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Set Avatar</h3>
        <div className="avatar-preview-lg">{preview ? <img src={preview} alt="" /> : '沐'}</div>
        <div className="modal-actions-col">
          <label className="btn-primary-full">Choose Image<input type="file" accept="image/*" onChange={handleFile} hidden /></label>
          {preview && <button className="btn-danger-text" onClick={removeAvatar}>Remove</button>}
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
          {['📌', '🎂', '💕', '🎓', '✈️', '🎄', '🏆'].map(em => (
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

// ─── ThinkingPanel ──────────────────────────────────
function ThinkingPanel({ text, onClose }) {
  const [height, setHeight] = useState(300)
  const startY = useRef(0), startH = useRef(0)
  const onTS = (e) => { startY.current = e.touches[0].clientY; startH.current = height }
  const onTM = (e) => { const dy = startY.current - e.touches[0].clientY; setHeight(Math.min(Math.max(startH.current + dy, 150), window.innerHeight * 0.8)) }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="thinking-panel" style={{ height }}>
        <div className="thinking-panel-handle" onTouchStart={onTS} onTouchMove={onTM}><div className="handle-bar" /></div>
        <div className="thinking-panel-header">
          <span className="thinking-panel-title">Thought Process</span>
          <button className="icon-btn small" onClick={onClose}>{I.close}</button>
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
        if (Array.isArray(msgs)) setResults(msgs.filter(m => m.content && m.content.toLowerCase().includes(query.toLowerCase())).slice(0, 50).map((m, _, __, idx) => ({ ...m, sessionName: '', _idx: msgs.indexOf(m) })))
      } else {
        const sessRes = await fetch(`${API}/api/sessions`); const sessions = await sessRes.json()
        if (!Array.isArray(sessions)) { setSearching(false); return }
        const found = []
        for (const s of sessions.slice(0, 20)) {
          try { const r = await fetch(`${API}/api/sessions/${s.id}/messages`); const ms = await r.json(); if (Array.isArray(ms)) ms.forEach((m, i) => { if (m.content && m.content.toLowerCase().includes(query.toLowerCase())) found.push({ ...m, sessionName: s.name, sessionId: s.id, _idx: i, _session: s }) }) } catch {}
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
        {[{ key: 'opus', label: '沐', desc: 'Claude Opus' }, { key: 'sonnet', label: '沐', desc: 'Claude Sonnet' }, { key: 'deepseek', label: '沐', desc: 'DeepSeek V4 flash' }].map(m => (
          <div key={m.key} className="new-chat-option" onClick={() => { createSession(m.key); setShowNew(false) }}><div className="new-chat-name">{m.label}</div><div className="new-chat-desc">{m.desc}</div></div>
        ))}
      </div>)}
      <div className="session-list">
        {loading && <div className="loading-state"><span className="spinner" />Loading...</div>}
        {!loading && sessions.length === 0 && <div className="empty-state">Tap + to start your first chat</div>}
        {!loading && sessions.map(s => {
          const avatar = getAvatar(s.id)
          const draft = hasDraft(s.id)
          return (
            <SwipeRow key={s.id} onDelete={() => deleteSession(s.id)}>
              <div className="session-card" onClick={() => onOpen(s)}>
                <div className="session-avatar">{avatar ? <img src={avatar} alt="" /> : getDefaultAvLetter(s.model)}</div>
                <div className="session-info">
                  <div className="session-top"><span className="session-name">沐</span><span className="session-time">{getTime(s)}</span></div>
                  <div className="session-bottom"><span className={`session-preview ${draft ? 'draft' : ''}`}>{getPreview(s.id)}</span><span className="session-model-tag">{getModelTag(s.model)}</span></div>
                </div>
              </div>
            </SwipeRow>
          )
        })}
      </div>
    </div>
  )
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
  const messagesEndRef = useRef(null)
  const messageRefs = useRef({})
  const textareaRef = useRef(null)
  const model = session.model || 'opus'

  // Load draft
  useEffect(() => { const d = getDraft(session.id); if (d) setInput(d) }, [session.id])
  // Save draft
  useEffect(() => { setDraftStorage(session.id, input) }, [input, session.id])

  useEffect(() => {
    fetch(`${API}/api/sessions/${session.id}/messages`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        setMessages(data)
        const map = {}
        data.forEach((m, i) => { if (m.role === 'assistant') map[i] = pickSticker(m.content) })
        setStickerMap(map)
      }
    })
  }, [session.id])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px' } }, [input])

  const toggleExtThinking = () => { const v = !extThinking; setExtThinking(v); setExtendedThinkingStorage(session.id, v) }

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const text = input.trim(); setInput(''); setDraftStorage(session.id, '')
    const newIdx = messages.length
    setMessages(prev => [...prev, { role: 'user', content: text, created_at: new Date().toISOString() }])
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: session.id, message: text, model, extended_thinking: extThinking }) })
      const data = await res.json()
      const assistIdx = newIdx + 1
      const sticker = pickSticker(data.reply)
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, thinking: data.thinking, created_at: new Date().toISOString() }])
      setStickerMap(prev => ({ ...prev, [assistIdx]: sticker }))
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
          <div className="chatroom-name">沐</div>
          <div className="chatroom-model">{getModelSubtitle(model)}</div>
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
            <span>Set Avatar</span>
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
              </div>
            )}
            <div className="bubble-row">
              {m.role === 'assistant' && stickerMap[i] && <img className="sticker" src={`/stickers/${stickerMap[i]}`} alt="" />}
              <div className="bubble">{m.content}</div>
            </div>
            <div className="msg-time">{fmtShortTime(m.created_at)}</div>
          </div>
        ))}
        {loading && <div className="msg assistant"><div className="bubble typing"><span className="dot" /><span className="dot" /><span className="dot" /></div></div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        <div className="composer-input-row">
          <div className="composer-attachments">
            <button className="attach-btn">{I.file}</button>
            <button className="attach-btn">{I.camera}</button>
            <button className="attach-btn">{I.photo}</button>
          </div>
          <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Say something..." rows={1} />
          <button className="send-btn" onClick={sendMessage} disabled={loading || !input.trim()}>{I.send}</button>
        </div>
      </div>

      {thinkingText && <ThinkingPanel text={thinkingText} onClose={() => setThinkingText(null)} />}
      {showAvatarUpload && <AvatarUploadModal sessionId={session.id} onClose={() => setShowAvatarUpload(false)} />}
    </div>
  )
}

// ─── ChatPage ───────────────────────────────────────
function ChatPage({ onEnterRoom }) {
  const [openSession, setOpenSession] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [jumpTarget, setJumpTarget] = useState(null)
  useEffect(() => { onEnterRoom(!!openSession || showSearch) }, [openSession, showSearch])

  const handleSearchJump = (session, idx, msgId) => {
    setShowSearch(false)
    setJumpTarget({ idx, msgId })
    setOpenSession(session)
  }

  if (showSearch) return <SearchPanel onClose={() => setShowSearch(false)} onJumpToMessage={handleSearchJump} />
  if (openSession) return <ChatRoom session={openSession} onBack={() => { setOpenSession(null); setJumpTarget(null) }} />
  return <ChatListPage onOpen={setOpenSession} onOpenSearch={() => setShowSearch(true)} />
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

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const cells = []; for (let i = 0; i < firstDay; i++) cells.push(null); for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
  const periodSet = new Set(periods.map(p => p.date))
  const isPeriod = (d) => d && periodSet.has(mkDate(d))
  const todoDateSet = new Set(todos.filter(t => !t.done && t.due_time).map(t => t.due_time.slice(0, 10)))
  const hasTodo = (d) => d && todoDateSet.has(mkDate(d))

  // Important dates — check if any fall on day d of current month/year
  const importantDateSet = new Set()
  importantDates.forEach(id => {
    const dd = new Date(id.date)
    if (id.recurring === 'yearly') {
      if (dd.getMonth() === month) importantDateSet.add(dd.getDate())
    } else {
      if (dd.getMonth() === month && dd.getFullYear() === year) importantDateSet.add(dd.getDate())
    }
  })
  const isImportant = (d) => d && importantDateSet.has(d)

  const selectedDateStr = selectedDay ? `${month + 1}/${selectedDay}${isToday(selectedDay) ? ' · Today' : ''}` : null
  const selDateStr = selectedDay ? mkDate(selectedDay) : new Date().toISOString().slice(0, 10)
  const dayTodos = todos.filter(t => { if (!t.due_time) return selectedDay && isToday(selectedDay); return t.due_time.startsWith(selDateStr) })
  const incompleteTodos = dayTodos.filter(t => !t.done), completedTodos = dayTodos.filter(t => t.done)

  return (
    <div className="calendar-page">
      <div className="page-header"><div><h1>Calendar</h1><div className="page-subtitle">{year}</div></div><div className="header-actions"><button className="text-btn" onClick={goToday}>Today</button></div></div>
      <div className="card cal-card">
        <div className="cal-nav"><button className="icon-btn small" onClick={prevMonth}>{I.back}</button><span className="cal-month">{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]} {year}</span><button className="icon-btn small" onClick={nextMonth}>{I.chevron}</button></div>
        <div className="cal-grid">
          {dayLabels.map((d, i) => <div key={i} className="cal-head">{d}</div>)}
          {cells.map((d, i) => (
            <div key={i} className={`cal-day ${d ? '' : 'empty'} ${isToday(d) ? 'today' : ''} ${selectedDay === d && !isToday(d) ? 'selected' : ''} ${isPeriod(d) ? 'period' : ''} ${hasTodo(d) && !isToday(d) ? 'has-todo' : ''}`} onClick={() => d && setSelectedDay(d)}>
              {d || ''}
              {isImportant(d) && <div className="cal-important-dot" />}
            </div>
          ))}
        </div>
      </div>

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
  const [showAddDate, setShowAddDate] = useState(false)
  const longPressTimer = useRef(null)

  const now = new Date()
  const daysTogether = daysBetween(START_DATE, now)

  // Greeting based on time of day
  const hour = now.getHours()
  const greeting = hour < 6 ? 'Night owl' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  // Today's whisper — longer, more varied
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

  // Next important date countdown
  const getNextCountdowns = () => {
    const results = []
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    importantDates.forEach(d => {
      let targetDate = new Date(d.date)
      if (d.recurring === 'yearly') {
        targetDate = new Date(now.getFullYear(), targetDate.getMonth(), targetDate.getDate())
        if (targetDate.getTime() < todayMs) targetDate = new Date(now.getFullYear() + 1, targetDate.getMonth(), targetDate.getDate())
      }
      const days = daysBetween(now, targetDate)
      if (days >= 0) results.push({ ...d, daysLeft: days, targetDate })
    })
    // Add milestone anniversaries
    const milestones = [50, 100, 200, 365, 500, 730, 1000]
    milestones.forEach(m => {
      const target = new Date(START_DATE.getTime() + m * 86400000)
      const days = daysBetween(now, target)
      if (days > 0 && days <= 365) results.push({ id: `ms_${m}`, name: `Day ${m}`, emoji: '💕', daysLeft: days, targetDate: target })
    })
    return results.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 3)
  }

  // Monthly anniversary
  const getMonthlyAnniversary = () => {
    const startDay = START_DATE.getDate()
    let nextMonth = new Date(now.getFullYear(), now.getMonth(), startDay)
    if (nextMonth <= now) nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, startDay)
    const daysLeft = daysBetween(now, nextMonth)
    const monthDate = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][nextMonth.getMonth()]} ${startDay}`
    return { daysLeft, monthDate }
  }

  const countdowns = getNextCountdowns()
  const monthly = getMonthlyAnniversary()

  useEffect(() => {
    fetch(`${API}/api/diaries`).then(r => r.json()).then(d => { if (Array.isArray(d)) setDiaries(d) }).catch(() => {})
  }, [])

  const submitDiary = async () => { if (!diaryText.trim() || submitting) return; setSubmitting(true); try { const r = await fetch(`${API}/api/diaries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'her', content: diaryText.trim() }) }); const e = await r.json(); setDiaries(p => [e, ...p]); setDiaryText(''); setShowWrite(false) } catch {}; setSubmitting(false) }
  const deleteDiary = async (id) => { try { await fetch(`${API}/api/diaries/${id}`, { method: 'DELETE' }); setDiaries(p => p.filter(d => d.id !== id)) } catch {}; setContextMenu(null) }
  const startEdit = (d) => { if (d.author !== 'her') return; setEditingDiary(d.id); setEditText(d.content); setContextMenu(null); setShowWrite(true) }
  const saveEdit = async () => { if (!editText.trim() || !editingDiary) return; try { await fetch(`${API}/api/diaries/${editingDiary}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editText.trim() }) }); setDiaries(p => p.map(d => d.id === editingDiary ? { ...d, content: editText.trim() } : d)) } catch {}; setEditingDiary(null); setEditText(''); setShowWrite(false) }
  const handleLongPress = (e, d) => { e.preventDefault(); setContextMenu({ id: d.id, diary: d }) }

  const addImportantDate = (d) => { const nd = [...importantDates, d]; setImportantDates(nd); saveImportantDates(nd) }

  const fmtDate = (s) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()}` }
  const fmtTime = (s) => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

  let filtered = diaries
  if (filter !== 'all') filtered = filtered.filter(d => d.author === filter)
  if (showDatePicker && diaryDateFilter) filtered = filtered.filter(d => { const dd = new Date(d.created_at); return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}` === diaryDateFilter })

  const groupByDate = (entries) => { const g = {}; entries.forEach(d => { const dt = new Date(d.created_at); const k = `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`; if (!g[k]) g[k] = { date: dt, entries: [] }; g[k].entries.push(d) }); return Object.values(g).sort((a, b) => b.date - a.date) }
  const diaryGroups = groupByDate(filtered)

  // Ring progress for monthly anniversary
  const ringProgress = monthly.daysLeft <= 31 ? ((31 - monthly.daysLeft) / 31) : 0
  const ringR = 26, ringC = 2 * Math.PI * ringR

  return (
    <div className="today-page" onClick={() => contextMenu && setContextMenu(null)}>
      {/* Header */}
      <div className="today-header">
        <div><div className="today-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1 className="today-greeting">{greeting}, 桦桦</h1></div>
        <button className="icon-btn" onClick={() => setShowAddDate(true)}>{I.plus}</button>
      </div>

      {/* Whisper */}
      <div className="whisper-card-v2">
        <div className="whisper-text-v2">{todayWhisper}</div>
        <div className="whisper-footer">Today's Whisper {I.chevron}</div>
      </div>

      {/* Us card */}
      <div className="us-card">
        <div className="us-label">Us</div>
        <div className="us-days-row">
          <div className="us-day-num">Day {daysTogether}</div>
          {I.heart}
        </div>
        <div className="us-sub">桦桦和沐，从 2026.7.27 到每一天</div>
      </div>

      {/* Countdown card */}
      <div className="countdown-card">
        <div className="countdown-monthly">
          <div><div className="countdown-monthly-title">Monthly Anniversary</div><div className="countdown-monthly-date">{monthly.monthDate}</div></div>
          <div className="ring-wrap">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r={ringR} fill="none" stroke="var(--border)" strokeWidth="4" />
              <circle cx="32" cy="32" r={ringR} fill="none" stroke="var(--accent)" strokeWidth="4" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - ringProgress)} strokeLinecap="round" transform="rotate(-90 32 32)" />
            </svg>
            <div className="ring-num">{monthly.daysLeft}</div>
          </div>
        </div>
        {countdowns.length > 0 && (
          <div className="countdown-items">
            {countdowns.map(c => (
              <div key={c.id} className="countdown-item">
                <div className="countdown-bar" />
                <div className="countdown-item-info"><div className="countdown-item-name">{c.emoji} {c.name}</div><div className="countdown-item-date">{c.targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></div>
                <div className="countdown-item-days">{c.daysLeft}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Health mock */}
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

      {/* Diary section */}
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

      {showAddDate && <AddDateModal onClose={() => setShowAddDate(false)} onSave={addImportantDate} />}
    </div>
  )
}

// ─── SettingsPage ───────────────────────────────────
function SettingsPage({ onBack }) {
  const [subPage, setSubPage] = useState(null)
  const swipe = useSwipeBack(() => subPage ? setSubPage(null) : onBack())

  if (subPage === 'mcp') return (
    <div className="settings-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={() => setSubPage(null)}>{I.back}</button><h1>MCP</h1></div>
      <div className="card"><div className="empty-state-sm">No connected MCP services</div></div>
      <div className="card settings-card">
        {['HealthKit', 'Apple Calendar', 'Reminders', 'ElevenLabs TTS'].map(n => (
          <div key={n} className="setting-item"><span>{n}</span><span className="setting-value dim">Coming soon</span></div>
        ))}
      </div>
    </div>
  )

  if (subPage === 'skin') return (
    <div className="settings-page" {...swipe}>
      <div className="page-header"><button className="icon-btn" onClick={() => setSubPage(null)}>{I.back}</button><h1>Theme</h1></div>
      <div className="card settings-card">
        <div className="setting-item"><span>Claude (current)</span><span className="setting-value">✓</span></div>
        <div className="setting-item"><span>Pink & Blue</span><span className="setting-value dim">Coming soon</span></div>
        <div className="setting-item"><span>Dark mode follows system</span><span className="setting-value">✓</span></div>
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
        <div className="setting-item"><span>Version</span><span className="setting-value dim">0.6.0</span></div>
      </div>
    </div>
  )
}

// ─── MorePage ───────────────────────────────────────
function MorePage() {
  const [subPage, setSubPage] = useState(null)

  if (subPage === 'settings') return <SettingsPage onBack={() => setSubPage(null)} />
  if (subPage === 'games') return (
    <div className="more-sub-page">
      <div className="page-header"><button className="icon-btn" onClick={() => setSubPage(null)}>{I.back}</button><h1>Games</h1></div>
      <div className="empty-state">Coming soon</div>
    </div>
  )
  if (subPage === 'reading') return (
    <div className="more-sub-page">
      <div className="page-header"><button className="icon-btn" onClick={() => setSubPage(null)}>{I.back}</button><h1>Reading Together</h1></div>
      <div className="empty-state">Coming soon</div>
    </div>
  )

  return (
    <div className="more-page">
      <div className="page-header"><h1>More</h1></div>
      <div className="more-grid">
        <div className="more-item" onClick={() => setSubPage('games')}><div className="more-icon game-icon">{I.game}</div><span>Games</span></div>
        <div className="more-item" onClick={() => setSubPage('reading')}><div className="more-icon reading-icon">{I.book}</div><span>Reading</span></div>
        <div className="more-item" onClick={() => setSubPage('settings')}><div className="more-icon settings-icon">{I.settings}</div><span>Settings</span></div>
      </div>
    </div>
  )
}

// ─── App ────────────────────────────────────────────
function App() {
  const [tab, setTab] = useState('today')
  const [inRoom, setInRoom] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => setKeyboardOpen(vv.height < window.innerHeight * 0.75)
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Hide tab bar when in chat room, keyboard open, or in More sub-pages
  const showTab = !inRoom && !keyboardOpen

  const tabs = [
    { key: 'today', label: 'Home', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
    { key: 'chat', label: 'Chats', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> },
    { key: 'calendar', label: 'Calendar', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { key: 'more', label: 'More', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg> },
  ]

  return (
    <div className="app">
      <div className="page-container">
        {tab === 'today' && <TodayPage />}
        {tab === 'chat' && <ChatPage onEnterRoom={setInRoom} />}
        {tab === 'calendar' && <CalendarPage />}
        {tab === 'more' && <MorePage />}
      </div>
      {showTab && <nav className="tab-bar">{tabs.map(t => <button key={t.key} className={`tab-item ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.icon}<span>{t.label}</span></button>)}</nav>}
    </div>
  )
}

export default App
