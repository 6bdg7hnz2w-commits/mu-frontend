import { useState, useEffect, useRef } from 'react'
import './App.css'

const API = 'https://mu-backend-l0uw.onrender.com'

// ─── Chat: 会话列表 ─────────────────────────────────
function ChatListPage({ onOpen }) {
  const [sessions, setSessions] = useState([])
  const [lastMessages, setLastMessages] = useState({})

  useEffect(() => {
    fetch(`${API}/api/sessions`).then(r => r.json()).then(async data => {
      if (!Array.isArray(data)) return
      setSessions(data)
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
    })
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

  const deleteSession = async (e, id) => {
    e.stopPropagation()
    await fetch(`${API}/api/sessions/${id}`, { method: 'DELETE' })
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  const [showNew, setShowNew] = useState(false)

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
        <button className="icon-btn" onClick={() => setShowNew(!showNew)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
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
        {sessions.map(s => (
          <div key={s.id} className="session-row" onClick={() => onOpen(s)}>
            <div className="session-avatar">{(s.name || '沐').charAt(0)}</div>
            <div className="session-info">
              <div className="session-top">
                <span className="session-name">{s.name || '沐'}</span>
                <span className="session-time">{getTime(s)}</span>
              </div>
              <div className="session-preview">{getPreview(s.id)}</div>
            </div>
            <button className="delete-btn" onClick={(e) => deleteSession(e, s.id)}>×</button>
          </div>
        ))}
        {sessions.length === 0 && <div className="empty-state">点 + 开始第一个对话</div>}
      </div>
    </div>
  )
}

// ─── Chat: 聊天室（不显示tab）────────────────────────
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
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, message: text, model })
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        role: 'assistant', content: data.reply, thinking: data.thinking
      }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: '连接失败了...' }])
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

  return (
    <div className="chatroom">
      <div className="chatroom-header">
        <button className="icon-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                <span>Thought process</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{transform: expandedThinking[i] ? 'rotate(180deg)' : '', transition: 'transform .2s'}}><path d="M6 9l6 6 6-6"/></svg>
              </div>
            )}
            {expandedThinking[i] && m.thinking && (
              <div className="thinking-content">{m.thinking}</div>
            )}
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {loading && <div className="msg assistant"><div className="bubble typing">
          <span className="dot"/><span className="dot"/><span className="dot"/>
        </div></div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="说点什么..."
          rows={1}
        />
        <button className="send-btn" onClick={sendMessage} disabled={loading || !input.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>
  )
}

function ChatPage({ onEnterRoom }) {
  const [openSession, setOpenSession] = useState(null)

  useEffect(() => {
    onEnterRoom(!!openSession)
  }, [openSession])

  if (openSession) {
    return <ChatRoom session={openSession} onBack={() => setOpenSession(null)} />
  }
  return <ChatListPage onOpen={setOpenSession} />
}
// ─── Tab: Calendar ───────────────────────────────────
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
          <button className="icon-btn small" onClick={prevMonth}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span className="cal-month">{year}年{month+1}月</span>
          <button className="icon-btn small" onClick={nextMonth}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
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
                <div className="todo-check checked">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                </div>
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
    </div>
  )
}
// ─── Tab: Today ──────────────────────────────────────
function TodayPage() {
  const [diaries, setDiaries] = useState([])
  const [todos, setTodos] = useState([])
  const [showWrite, setShowWrite] = useState(false)
  const [diaryText, setDiaryText] = useState('')
  const [diaryAuthor, setDiaryAuthor] = useState('her')
  const [filter, setFilter] = useState('all')
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
        body: JSON.stringify({ author: diaryAuthor, content: diaryText.trim() })
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

  const filteredDiaries = filter === 'all' ? diaries : diaries.filter(d => d.author === filter)
  const showWriteBtn = filter !== 'all'
  const todayTodos = todos.filter(t => !t.done)

  return (
    <div className="today-page" onClick={() => contextMenu && setContextMenu(null)}>
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

      <div className="section-header">
        <h2>日记</h2>
      </div>

      <div className="diary-filter">
        {[['all','全部'],['her','桦桦'],['mu','沐']].map(([k,v]) => (
          <button key={k} className={`filter-btn ${filter===k?'active':''}`}
            onClick={() => { setFilter(k); setShowWrite(false); setDiaryText('') }}>{v}</button>
        ))}
      </div>

      {filter !== 'all' && (
        <div className="write-inline">
          {editingDiary ? (
            <div className="card write-card">
              <textarea className="write-area" value={editText} onChange={e => setEditText(e.target.value)} rows={4} />
              <div className="write-actions">
                <button className="btn-ghost" onClick={() => { setEditingDiary(null); setEditText('') }}>取消</button>
                <button className="btn-primary" onClick={saveEdit} disabled={!editText.trim()}>保存</button>
              </div>
            </div>
          ) : showWrite ? (
            <div className="card write-card">
              <textarea className="write-area" value={diaryText}
                onChange={e => setDiaryText(e.target.value)}
                placeholder={filter === 'her' ? '写点什么...' : '沐想说...'}
                rows={4} />
              <div className="write-actions">
                <button className="btn-ghost" onClick={() => { setShowWrite(false); setDiaryText('') }}>取消</button>
                <button className="btn-primary" onClick={submitDiary} disabled={!diaryText.trim() || submitting}>
                  {submitting ? '...' : '记上'}
                </button>
              </div>
            </div>
          ) : (
            <button className="write-trigger" onClick={() => { setShowWrite(true); setDiaryAuthor(filter) }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              <span>写日记</span>
            </button>
          )}
        </div>
      )}

      <div className="diary-timeline">
        {filteredDiaries.length === 0 && <div className="empty-state">还没有日记</div>}
        {filteredDiaries.map(d => (
          <div key={d.id} className={`diary-entry ${d.author}`}
            onContextMenu={(e) => handleLongPress(e, d)}
            onTouchStart={() => {
              longPressTimer.current = setTimeout(() => setContextMenu({ id: d.id, diary: d }), 500)
            }}
            onTouchEnd={() => clearTimeout(longPressTimer.current)}
            onTouchMove={() => clearTimeout(longPressTimer.current)}>
            <div className="diary-meta">
              <span className="diary-author">{d.author === 'her' ? '桦桦' : '沐'}</span>
              <span className="diary-date">{formatDate(d.created_at)} {formatTime(d.created_at)}</span>
            </div>
            <div className="diary-content">{d.content}</div>

            {contextMenu && contextMenu.id === d.id && (
              <div className="context-menu" onClick={e => e.stopPropagation()}>
                <button onClick={() => startEdit(d)}>编辑</button>
                <button className="danger" onClick={() => deleteDiary(d.id)}>删除</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Settings ───────────────────────────────────
function SettingsPage() {
  return (
    <div className="settings-page">
      <div className="page-header"><h1>设置</h1></div>

      <div className="card settings-card">
        <div className="setting-item" onClick={() => window.open('https://openrouter.ai/settings/keys','_blank')}>
          <span>OpenRouter API</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div className="setting-item" onClick={() => window.open('https://platform.deepseek.com','_blank')}>
          <span>DeepSeek API</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
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
          <span className="setting-value dim">0.3.1</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────
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
