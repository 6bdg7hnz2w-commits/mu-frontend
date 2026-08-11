import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const API = 'https://mu-backend-l0uw.onrender.com'

// ─── 图标组件 ───────────────────────────────────────
const Icons = {
  back: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>,
  plus: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="#fff" strokeWidth="2"/><path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="#fff" strokeWidth="2"/></svg>,
  more: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>,
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
  camera: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  photo: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
  file: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  chevron: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>,
  check: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>,
  avatar: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  close: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>,
  thinking: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
  down: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>,
}

// ─── 左滑删除组件 ────────────────────────────────────
function SwipeRow({ children, onDelete }) {
  const rowRef = useRef(null)
  const startX = useRef(0)
  const currentX = useRef(0)
  const swiping = useRef(false)

  const onTouchStart = (e) => {
    startX.current = e.touches[0].clientX
    currentX.current = 0
    swiping.current = false
  }

  const onTouchMove = (e) => {
    const dx = e.touches[0].clientX - startX.current
    if (dx < -10) {
      swiping.current = true
      currentX.current = Math.max(dx, -80)
      if (rowRef.current) rowRef.current.style.transform = `translateX(${currentX.current}px)`
    }
  }

  const onTouchEnd = () => {
    if (rowRef.current) {
      if (currentX.current < -50) {
        rowRef.current.style.transform = 'translateX(-80px)'
      } else {
        rowRef.current.style.transform = 'translateX(0)'
      }
    }
    setTimeout(() => { swiping.current = false }, 50)
  }

  const handleClick = (e) => {
    if (swiping.current || currentX.current < -20) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  return (
    <div className="swipe-container">
      <div className="swipe-delete" onClick={onDelete}>删除</div>
      <div
        ref={rowRef}
        className="swipe-content"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClickCapture={handleClick}
        style={{ transition: 'transform .2s' }}
      >
        {children}
      </div>
    </div>
  )
}

// ─── Chat: 会话列表 ─────────────────────────────────
function ChatListPage({ onOpen, onOpenMenu }) {
  const [sessions, setSessions] = useState([])
  const [lastMessages, setLastMessages] = useState({})
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/sessions`).then(r => r.json()).then(async data => {
      if (!Array.isArray(data)) { setLoading(false); return }
      setSessions(data)
      setLoading(false)
      const msgs = {}
      for (const s of data.slice(0, 10)) {
        try {
          const res = await fetch(`${API}/api/sessions/${s.id}/messages`)
          const arr = await res.json()
          if (Array.isArray(arr) && arr.length > 0) {
            msgs[s.id] = arr[arr.length - 1]
          }
        } catch(e) {}
      }
      setLastMessages(msgs)
    }).catch(() => setLoading(false))
  }, [])

  const createSession = async (model) => {
    const names = { opus: '沐', sonnet: 'Sonnet', deepseek: 'DeepSeek' }
    const res = await fetch(`${API}/api/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: names[model] || '新对话', model })
    })
    const session = await res.json()
    setSessions(prev => [session, ...prev])
    onOpen({ ...session, model })
  }

  const deleteSession = async (id) => {
    await fetch(`${API}/api/sessions/${id}`, { method: 'DELETE' })
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  const formatTime = (t) => {
    if (!t) return ''
    const d = new Date(t)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
    }
    return `${d.getMonth()+1}/${d.getDate()}`
  }

  const getPreview = (sid) => {
    const m = lastMessages[sid]
    if (!m) return ''
    const text = m.content || ''
    return text.length > 30 ? text.slice(0, 30) + '...' : text
  }

  const getTime = (s) => {
    const m = lastMessages[s.id]
    return formatTime(m?.created_at || s.updated_at)
  }

  return (
    <div className="chatlist-page">
      <div className="page-header">
        <h1>Chats</h1>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => onOpenMenu && onOpenMenu()}>
            {Icons.more}
          </button>
          <button className="icon-btn" onClick={() => setShowNew(!showNew)}>
            {Icons.plus}
          </button>
        </div>
      </div>

      {showNew && (
        <div className="card new-chat-card">
          <div className="card-title">新对话</div>
          {[
            { key: 'opus', label: '沐', desc: 'Claude Opus' },
            { key: 'sonnet', label: 'Sonnet', desc: 'Claude Sonnet' },
            { key: 'deepseek', label: 'DeepSeek', desc: 'DeepSeek Chat' },
          ].map(m => (
            <div key={m.key} className="new-chat-option" onClick={() => { createSession(m.key); setShowNew(false) }}>
              <div className="new-chat-name">{m.label}</div>
              <div className="new-chat-desc">{m.desc}</div>
            </div>
          ))}
        </div>
      )}

      <div className="session-list-v2">
        {loading && <div className="loading-state"><span className="spinner" />加载中...</div>}
        {!loading && sessions.length === 0 && <div className="empty-state">点 + 开始第一个对话</div>}
        {!loading && sessions.map(s => (
          <SwipeRow key={s.id} onDelete={() => deleteSession(s.id)}>
            <div className="session-row" onClick={() => onOpen(s)}>
              <div className="session-avatar">{(s.name || '沐').charAt(0)}</div>
              <div className="session-info">
                <div className="session-top">
                  <span className="session-name">{s.name || '沐'}</span>
                  <span className="session-time">{getTime(s)}</span>
                </div>
                <div className="session-preview">{getPreview(s.id)}</div>
              </div>
            </div>
          </SwipeRow>
        ))}
      </div>
    </div>
  )
}

// ─── 菜单弹窗 ───────────────────────────────────────
function ChatMenu({ onClose, onSearch }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="chat-menu-panel">
        <div className="menu-item" onClick={() => { onSearch(); onClose() }}>
          {Icons.search}
          <span>搜索聊天记录</span>
        </div>
        <div className="menu-item" onClick={onClose}>
          {Icons.avatar}
          <span>设置头像</span>
          <span className="menu-dim">即将推出</span>
        </div>
        <div className="menu-item" onClick={onClose}>
          {Icons.photo}
          <span>文件与照片</span>
          <span className="menu-dim">即将推出</span>
        </div>
      </div>
    </>
  )
}

// ─── 搜索面板 ───────────────────────────────────────
function SearchPanel({ onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const doSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      // 搜索所有session的messages
      const sessRes = await fetch(`${API}/api/sessions`)
      const sessions = await sessRes.json()
      if (!Array.isArray(sessions)) { setSearching(false); return }

      const found = []
      for (const s of sessions.slice(0, 20)) {
        try {
          const msgRes = await fetch(`${API}/api/sessions/${s.id}/messages`)
          const msgs = await msgRes.json()
          if (!Array.isArray(msgs)) continue
          for (const m of msgs) {
            if (m.content && m.content.toLowerCase().includes(query.toLowerCase())) {
              found.push({ ...m, sessionName: s.name })
            }
          }
        } catch(e) {}
      }
      setResults(found.slice(0, 50))
    } catch(e) {}
    setSearching(false)
  }

  return (
    <div className="search-panel">
      <div className="search-header">
        <div className="search-input-row">
          {Icons.search}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="搜索聊天记录..."
          />
        </div>
        <button className="text-btn" onClick={onClose}>取消</button>
      </div>
      <div className="search-results">
        {searching && <div className="loading-state"><span className="spinner" />搜索中...</div>}
        {!searching && results.length === 0 && query && <div className="empty-state">没有找到</div>}
        {results.map((r, i) => (
          <div key={i} className="search-result-item">
            <div className="search-result-meta">
              <span className="search-result-session">{r.sessionName || '对话'}</span>
              <span className="search-result-role">{r.role === 'user' ? '桦桦' : '沐'}</span>
            </div>
            <div className="search-result-content">{r.content.length > 100 ? r.content.slice(0, 100) + '...' : r.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Chat: 聊天室 ───────────────────────────────────
function ChatRoom({ session, onBack }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedThinking, setExpandedThinking] = useState({})
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const model = session.model || 'opus'

  useEffect(() => {
    fetch(`${API}/api/sessions/${session.id}/messages`)
      .then(r => r.json()).then(data => {
        if (Array.isArray(data)) setMessages(data)
      })
  }, [session.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text, created_at: new Date().toISOString() }])
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, message: text, model })
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        role: 'assistant', content: data.reply, thinking: data.thinking, created_at: new Date().toISOString()
      }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: '连接失败了...', created_at: new Date().toISOString() }])
    }
    setLoading(false)
  }

  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)
  const handleKeyDown = (e) => {
    if (isMobile) return
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      sendMessage()
    }
  }

  const toggleThinking = (i) => {
    setExpandedThinking(prev => ({ ...prev, [i]: !prev[i] }))
  }

  const formatMsgTime = (t) => {
    if (!t) return ''
    const d = new Date(t)
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  return (
    <div className="chatroom">
      <div className="chatroom-header">
        <button className="icon-btn" onClick={onBack}>
          {Icons.back}
        </button>
        <div className="chatroom-title">
          <div className="chatroom-name">{session.name || '沐'}</div>
        </div>
        <div style={{width: 36}} />
      </div>

      <div className="messages">
        {messages.length === 0 && <div className="empty-state">开始对话</div>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.thinking && (
              <div className="thinking-toggle" onClick={() => toggleThinking(i)}>
                {Icons.thinking}
                <span>Thought process</span>
                <span style={{transform: expandedThinking[i] ? 'rotate(180deg)' : '', transition: 'transform .2s', display: 'flex'}}>{Icons.down}</span>
              </div>
            )}
            {expandedThinking[i] && m.thinking && (
              <div className="thinking-content">{m.thinking}</div>
            )}
            <div className="bubble">{m.content}</div>
            <div className="msg-time">{formatMsgTime(m.created_at)}</div>
          </div>
        ))}
        {loading && <div className="msg assistant"><div className="bubble typing">
          <span className="dot"/><span className="dot"/><span className="dot"/>
        </div></div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        <div className="composer-attachments">
          <button className="attach-btn" title="拍照">{Icons.camera}</button>
          <button className="attach-btn" title="照片">{Icons.photo}</button>
          <button className="attach-btn" title="文件">{Icons.file}</button>
        </div>
        <div className="composer-input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="说点什么..."
            rows={1}
          />
          <button className="send-btn" onClick={sendMessage} disabled={loading || !input.trim()}>
            {Icons.send}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatPage({ onEnterRoom }) {
  const [openSession, setOpenSession] = useState(null)
  const [showMenu, setShowMenu] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  useEffect(() => {
    onEnterRoom(!!openSession || showSearch)
  }, [openSession, showSearch])

  if (showSearch) {
    return <SearchPanel onClose={() => setShowSearch(false)} />
  }

  if (openSession) {
    return <ChatRoom session={openSession} onBack={() => setOpenSession(null)} />
  }

  return (
    <>
      <ChatListPage
        onOpen={setOpenSession}
        onOpenMenu={() => setShowMenu(true)}
      />
      {showMenu && (
        <ChatMenu
          onClose={() => setShowMenu(false)}
          onSearch={() => setShowSearch(true)}
        />
      )}
    </>
  )
}

// ─── Tab: Calendar ──────────────────────────────────
function CalendarPage() {
  const today = new Date()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(today.getDate())
  const [todos, setTodos] = useState([])
  const [periods, setPeriods] = useState([])
  const [newTodo, setNewTodo] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedTodos, setSelectedTodos] = useState(new Set())

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  useEffect(() => {
    fetch(`${API}/api/todos`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setTodos(data)
    }).catch(() => {})
    fetch(`${API}/api/periods`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setPeriods(data)
    }).catch(() => {})
  }, [])

  const addTodo = async () => {
    if (!newTodo.trim()) return
    try {
      const res = await fetch(`${API}/api/todos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side: 'her', text: newTodo.trim() })
      })
      const todo = await res.json()
      setTodos(prev => [...prev, todo])
      setNewTodo('')
    } catch (e) {}
  }

  const toggleTodo = async (id, done) => {
    try {
      await fetch(`${API}/api/todos/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !done })
      })
      setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t))
    } catch (e) {}
  }

  const deleteSelectedTodos = async () => {
    for (const id of selectedTodos) {
      await fetch(`${API}/api/todos/${id}`, { method: 'DELETE' })
    }
    setTodos(prev => prev.filter(t => !selectedTodos.has(t.id)))
    setSelectedTodos(new Set())
    setEditMode(false)
  }

  const toggleSelectTodo = (id) => {
    setSelectedTodos(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const togglePeriod = async (dateStr) => {
    try {
      const res = await fetch(`${API}/api/periods`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr })
      })
      const data = await res.json()
      if (data.action === 'added') {
        setPeriods(prev => [...prev, { date: dateStr }])
      } else {
        setPeriods(prev => prev.filter(p => p.date !== dateStr))
      }
    } catch (e) {}
  }

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDay(null) }
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDay(null) }
  const goToday = () => {
    setCurrentDate(new Date())
    setSelectedDay(today.getDate())
  }

  const days = ['日', '一', '二', '三', '四', '五', '六']
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
  const periodSet = new Set(periods.map(p => p.date))
  const dateStr = (d) => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  const isPeriod = (d) => d && periodSet.has(dateStr(d))

  const selectedDateStr = selectedDay ? `${month+1}月${selectedDay}日${isToday(selectedDay) ? ' · 今天' : ''}` : null

  const incompleteTodos = todos.filter(t => !t.done)
  const completedTodos = todos.filter(t => t.done)

  return (
    <div className="calendar-page">
      <div className="page-header">
        <div>
          <h1>日历</h1>
          <div className="page-subtitle">{year}年{month+1}月</div>
        </div>
        <div className="header-actions">
          <button className="text-btn" onClick={goToday}>今天</button>
        </div>
      </div>

      <div className="card cal-card">
        <div className="cal-nav">
          <button className="icon-btn small" onClick={prevMonth}>{Icons.back}</button>
          <span className="cal-month">{year}年{month+1}月</span>
          <button className="icon-btn small" onClick={nextMonth}>{Icons.chevron}</button>
        </div>
        <div className="cal-grid">
          {days.map(d => <div key={d} className="cal-head">{d}</div>)}
          {cells.map((d, i) => (
            <div key={i}
              className={`cal-day ${d ? '' : 'empty'} ${isToday(d) ? 'today' : ''} ${selectedDay === d && !isToday(d) ? 'selected' : ''} ${isPeriod(d) ? 'period' : ''}`}
              onClick={() => d && setSelectedDay(d === selectedDay ? null : d)}>
              {d || ''}
            </div>
          ))}
        </div>
      </div>

      {/* 待办卡片 */}
      <div className="card todo-card">
        <div className="todo-header">
          <div className="card-title">待办</div>
          <div className="todo-actions">
            {editMode && selectedTodos.size > 0 && (
              <button className="text-btn danger" onClick={deleteSelectedTodos}>删除 ({selectedTodos.size})</button>
            )}
            <button className="text-btn" onClick={() => { setEditMode(!editMode); setSelectedTodos(new Set()) }}>
              {editMode ? '完成' : '编辑'}
            </button>
          </div>
        </div>
        <div className="todo-list">
          {incompleteTodos.map(t => (
            <div key={t.id} className="todo-item" onClick={() => editMode ? toggleSelectTodo(t.id) : toggleTodo(t.id, t.done)}>
              {editMode ? (
                <div className={`todo-select ${selectedTodos.has(t.id) ? 'selected' : ''}`} />
              ) : (
                <div className="todo-check" />
              )}
              <span>{t.text}</span>
            </div>
          ))}
          {completedTodos.map(t => (
            <div key={t.id} className="todo-item done" onClick={() => editMode ? toggleSelectTodo(t.id) : toggleTodo(t.id, t.done)}>
              {editMode ? (
                <div className={`todo-select ${selectedTodos.has(t.id) ? 'selected' : ''}`} />
              ) : (
                <div className="todo-check checked">{Icons.check}</div>
              )}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        {!editMode && (
          <div className="todo-input">
            <input value={newTodo} onChange={e => setNewTodo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTodo()}
              placeholder="记一条..." />
            <button className="icon-btn small" onClick={addTodo}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        )}
      </div>

      {/* 经期卡片 — 移到待办下面 */}
      {selectedDay && (
        <div className="card day-detail">
          <div className="card-title">{selectedDateStr}</div>
          <div className="period-toggle">
            <span className="period-label">经期</span>
            <button className={`toggle-btn ${isPeriod(selectedDay) ? 'on' : ''}`}
              onClick={() => togglePeriod(dateStr(selectedDay))}>
              <div className="toggle-knob" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Today ─────────────────────────────────────
function TodayPage() {
  const [diaries, setDiaries] = useState([])
  const [todos, setTodos] = useState([])
  const [showWrite, setShowWrite] = useState(false)
  const [diaryText, setDiaryText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [editingDiary, setEditingDiary] = useState(null)
  const [editText, setEditText] = useState('')
  const longPressTimer = useRef(null)

  const startDate = new Date('2026-07-27')
  const daysTogether = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24))

  useEffect(() => {
    fetch(`${API}/api/diaries`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setDiaries(data)
    }).catch(() => {})
    fetch(`${API}/api/todos`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setTodos(data)
    }).catch(() => {})
  }, [])

  const submitDiary = async () => {
    if (!diaryText.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/api/diaries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'her', content: diaryText.trim() })
      })
      const entry = await res.json()
      setDiaries(prev => [entry, ...prev])
      setDiaryText('')
      setShowWrite(false)
    } catch (e) {}
    setSubmitting(false)
  }

  const deleteDiary = async (id) => {
    try {
      await fetch(`${API}/api/diaries/${id}`, { method: 'DELETE' })
      setDiaries(prev => prev.filter(d => d.id !== id))
    } catch (e) {}
    setContextMenu(null)
  }

  const startEdit = (d) => {
    if (d.author !== 'her') return // 只能编辑自己的
    setEditingDiary(d.id)
    setEditText(d.content)
    setContextMenu(null)
  }

  const saveEdit = async () => {
    if (!editText.trim() || !editingDiary) return
    try {
      await fetch(`${API}/api/diaries/${editingDiary}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText.trim() })
      })
      setDiaries(prev => prev.map(d => d.id === editingDiary ? { ...d, content: editText.trim() } : d))
    } catch (e) {}
    setEditingDiary(null)
    setEditText('')
  }

  const handleLongPress = (e, d) => {
    e.preventDefault()
    setContextMenu({ id: d.id, diary: d })
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr)
    return `${d.getMonth()+1}月${d.getDate()}日`
  }

  const formatTime = (dateStr) => {
    const d = new Date(dateStr)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  // 按日期分组
  const groupByDate = (entries) => {
    const groups = {}
    entries.forEach(d => {
      const date = new Date(d.created_at)
      const key = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`
      if (!groups[key]) groups[key] = { date, entries: [] }
      groups[key].entries.push(d)
    })
    return Object.values(groups).sort((a, b) => b.date - a.date)
  }

  const todayTodos = todos.filter(t => !t.done)
  const diaryGroups = groupByDate(diaries)

  return (
    <div className="today-page" onClick={() => contextMenu && setContextMenu(null)}>
      {/* 纪念日卡片 */}
      <div className="anniversary-widget glass">
        <div className="anni-label">在 一 起</div>
        <div className="anni-days">{daysTogether}</div>
        <div className="anni-unit">天</div>
        <div className="anni-since">2026.07.27</div>
      </div>

      {todayTodos.length > 0 && (
        <div className="card">
          <div className="card-title">今日事宜</div>
          {todayTodos.slice(0, 5).map(t => (
            <div key={t.id} className="today-todo-item">
              <div className="today-todo-dot" />
              <span>{t.text}</span>
            </div>
          ))}
          {todayTodos.length > 5 && (
            <div className="today-todo-more">还有 {todayTodos.length - 5} 项</div>
          )}
        </div>
      )}

      {/* 日记区 */}
      <div className="section-header">
        <h2>日记</h2>
        <button className="write-trigger-btn" onClick={() => setShowWrite(!showWrite)}>
          {Icons.plus}
        </button>
      </div>

      {/* 写日记（只能写桦桦的，沐的由AI生成） */}
      {showWrite && (
        <div className="card write-card">
          {editingDiary ? (
            <>
              <textarea className="write-area" value={editText} onChange={e => setEditText(e.target.value)} rows={4} />
              <div className="write-actions">
                <button className="btn-ghost" onClick={() => { setEditingDiary(null); setEditText('') }}>取消</button>
                <button className="btn-primary" onClick={saveEdit} disabled={!editText.trim()}>保存</button>
              </div>
            </>
          ) : (
            <>
              <textarea className="write-area" value={diaryText}
                onChange={e => setDiaryText(e.target.value)}
                placeholder="写点什么..."
                rows={4} />
              <div className="write-actions">
                <button className="btn-ghost" onClick={() => { setShowWrite(false); setDiaryText('') }}>取消</button>
                <button className="btn-primary" onClick={submitDiary} disabled={!diaryText.trim() || submitting}>
                  {submitting ? '...' : '记上'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 时间轴日记 */}
      <div className="diary-timeline-v2">
        {diaryGroups.length === 0 && <div className="empty-state">还没有日记</div>}
        {diaryGroups.map((group, gi) => (
          <div key={gi} className="timeline-day">
            <div className="timeline-date-col">
              <div className="timeline-date-num">{group.date.getDate()}</div>
              <div className="timeline-date-month">{group.date.getMonth()+1}月</div>
            </div>
            <div className="timeline-line" />
            <div className="timeline-entries">
              {group.entries.map(d => (
                <div key={d.id}
                  className={`timeline-entry ${d.author}`}
                  onContextMenu={(e) => handleLongPress(e, d)}
                  onTouchStart={() => {
                    longPressTimer.current = setTimeout(() => setContextMenu({ id: d.id, diary: d }), 500)
                  }}
                  onTouchEnd={() => clearTimeout(longPressTimer.current)}
                  onTouchMove={() => clearTimeout(longPressTimer.current)}>
                  <div className="timeline-entry-header">
                    <span className={`timeline-author ${d.author}`}>{d.author === 'her' ? '桦桦' : '沐'}</span>
                    <span className="timeline-time">{formatTime(d.created_at)}</span>
                  </div>
                  <div className="timeline-entry-content">{d.content}</div>

                  {contextMenu && contextMenu.id === d.id && (
                    <div className="context-menu" onClick={e => e.stopPropagation()}>
                      {d.author === 'her' && <button onClick={() => startEdit(d)}>编辑</button>}
                      <button className="danger" onClick={() => deleteDiary(d.id)}>删除</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Settings ──────────────────────────────────
function SettingsPage() {
  return (
    <div className="settings-page">
      <div className="page-header"><h1>设置</h1></div>

      <div className="card settings-card">
        <div className="setting-item" onClick={() => window.open('https://openrouter.ai/settings/keys','_blank')}>
          <span>OpenRouter API</span>
          {Icons.chevron}
        </div>
        <div className="setting-item" onClick={() => window.open('https://platform.deepseek.com','_blank')}>
          <span>DeepSeek API</span>
          {Icons.chevron}
        </div>
        <div className="setting-item">
          <span>皮肤</span>
          <span className="setting-value">Claude</span>
        </div>
        <div className="setting-item">
          <span>MCP 连接</span>
          <span className="setting-value dim">待接入</span>
        </div>
      </div>

      <div className="card settings-card">
        <div className="setting-item">
          <span>版本</span>
          <span className="setting-value dim">0.4.0</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ───────────────────────────────────────
function App() {
  const [tab, setTab] = useState('chat')
  const [inRoom, setInRoom] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      setKeyboardOpen(vv.height < window.innerHeight * 0.75)
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  const showTab = !inRoom && !keyboardOpen

  const tabs = [
    { key: 'chat', label: 'Chat', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
    { key: 'calendar', label: '日历', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> },
    { key: 'today', label: 'Today', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    { key: 'settings', label: '设置', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  ]

  return (
    <div className="app">
      <div className="page-container">
        {tab === 'chat' && <ChatPage onEnterRoom={setInRoom} />}
        {tab === 'calendar' && <CalendarPage />}
        {tab === 'today' && <TodayPage />}
        {tab === 'settings' && <SettingsPage />}
      </div>

      {showTab && (
        <nav className="tab-bar">
          {tabs.map(t => (
            <button key={t.key} className={`tab-item ${tab===t.key?'active':''}`}
              onClick={() => setTab(t.key)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

export default App
