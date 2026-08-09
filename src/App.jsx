import { useState, useEffect, useRef } from 'react'
import './App.css'

const API = 'https://mu-backend-l0uw.onrender.com'

function ChatPage() {
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [model, setModel] = useState('opus')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/api/sessions`).then(r => r.json()).then(data => {
      setSessions(data)
      if (data.length > 0) setCurrentSession(data[0])
    })
  }, [])

  useEffect(() => {
    if (currentSession) {
      fetch(`${API}/api/sessions/${currentSession.id}/messages`)
        .then(r => r.json()).then(setMessages)
    }
  }, [currentSession])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const createSession = async () => {
    const res = await fetch(`${API}/api/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新对话' })
    })
    const session = await res.json()
    setSessions(prev => [session, ...prev])
    setCurrentSession(session)
    setMessages([])
    setShowSidebar(false)
  }

  const deleteSession = async (id) => {
    await fetch(`${API}/api/sessions/${id}`, { method: 'DELETE' })
    setSessions(prev => prev.filter(s => s.id !== id))
    if (currentSession?.id === id) {
      setCurrentSession(null)
      setMessages([])
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || !currentSession || loading) return
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: currentSession.id, message: text, model })
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
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

  const modelCycle = { opus: 'sonnet', sonnet: 'deepseek', deepseek: 'opus' }
  const modelLabel = { opus: 'Opus', sonnet: 'Sonnet', deepseek: 'DS' }

  return (
    <div className="chat-page">
      {showSidebar && <div className="overlay" onClick={() => setShowSidebar(false)} />}
      <div className={`sidebar ${showSidebar ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>对话</h2>
          <button className="icon-btn" onClick={createSession}>+</button>
        </div>
        <div className="session-list">
          {sessions.map(s => (
            <div key={s.id}
              className={`session-item ${currentSession?.id === s.id ? 'active' : ''}`}
              onClick={() => { setCurrentSession(s); setShowSidebar(false) }}>
              <span>{s.name}</span>
              <button className="delete-btn" onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-main">
        <div className="chat-header">
          <button className="icon-btn" onClick={() => setShowSidebar(!showSidebar)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
          </button>
          <h1>沐</h1>
          <div className="header-actions">
            <button className="model-tag" onClick={() => setModel(m => modelCycle[m])}>
              {modelLabel[model]}
            </button>
            <button className="icon-btn" onClick={() => {
              if (currentSession) fetch(`${API}/api/sessions/${currentSession.id}/messages`).then(r => r.json()).then(setMessages)
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
            </button>
          </div>
        </div>

        <div className="messages">
          {messages.length === 0 && <div className="empty-state">开始对话</div>}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble">{m.content}</div>
            </div>
          ))}
          {loading && <div className="msg assistant"><div className="bubble typing">
            <span className="dot" /><span className="dot" /><span className="dot" />
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [todos, setTodos] = useState([])
  const [newTodo, setNewTodo] = useState('')

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()

  useEffect(() => {
    fetch(`${API}/api/todos`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setTodos(data)
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

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))

  const days = ['日', '一', '二', '三', '四', '五', '六']
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  const incompleteTodos = todos.filter(t => !t.done)
  const completedTodos = todos.filter(t => t.done)

  return (
    <div className="calendar-page">
      <div className="page-header">
        <h1>日历</h1>
      </div>

      <div className="card todo-card">
        <div className="card-title">待办</div>
        <div className="todo-list">
          {incompleteTodos.map(t => (
            <div key={t.id} className="todo-item" onClick={() => toggleTodo(t.id, t.done)}>
              <div className="todo-check" />
              <span>{t.text}</span>
            </div>
          ))}
          {completedTodos.map(t => (
            <div key={t.id} className="todo-item done" onClick={() => toggleTodo(t.id, t.done)}>
              <div className="todo-check checked">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        <div className="todo-input">
          <input
            value={newTodo}
            onChange={e => setNewTodo(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTodo()}
            placeholder="记一条..."
          />
          <button className="icon-btn small" onClick={addTodo}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>

      <div className="card cal-card">
        <div className="cal-nav">
          <button className="icon-btn small" onClick={prevMonth}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span className="cal-month">{year}年{month + 1}月</span>
          <button className="icon-btn small" onClick={nextMonth}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
        <div className="cal-grid">
          {days.map(d => <div key={d} className="cal-head">{d}</div>)}
          {cells.map((d, i) => (
            <div key={i} className={`cal-day ${d ? '' : 'empty'} ${isToday(d) ? 'today' : ''}`}>
              {d || ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
function TodayPage() {
  const [diaries, setDiaries] = useState([])
  const [showWrite, setShowWrite] = useState(false)
  const [diaryText, setDiaryText] = useState('')
  const [diaryAuthor, setDiaryAuthor] = useState('her')

  const startDate = new Date('2026-07-27')
  const daysTogether = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24))

  useEffect(() => {
    fetch(`${API}/api/diaries`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setDiaries(data)
    }).catch(() => {})
  }, [])

  const submitDiary = async () => {
    if (!diaryText.trim()) return
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
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  const formatTime = (dateStr) => {
    const d = new Date(dateStr)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="today-page">
      <div className="anniversary-widget">
        <div className="anni-label">在一起</div>
        <div className="anni-days">{daysTogether}</div>
        <div className="anni-unit">天</div>
        <div className="anni-since">2026.07.27</div>
      </div>

      <div className="section-header">
        <h2>日记</h2>
        <button className="icon-btn" onClick={() => setShowWrite(!showWrite)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>

      {showWrite && (
        <div className="card write-card">
          <div className="write-tabs">
            <button className={`write-tab ${diaryAuthor === 'her' ? 'active' : ''}`}
              onClick={() => setDiaryAuthor('her')}>桦桦</button>
            <button className={`write-tab ${diaryAuthor === 'mu' ? 'active' : ''}`}
              onClick={() => setDiaryAuthor('mu')}>沐</button>
          </div>
          <textarea
            className="write-area"
            value={diaryText}
            onChange={e => setDiaryText(e.target.value)}
            placeholder={diaryAuthor === 'her' ? '写点什么...' : '沐想说...'}
            rows={4}
          />
          <div className="write-actions">
            <button className="btn-ghost" onClick={() => { setShowWrite(false); setDiaryText('') }}>取消</button>
            <button className="btn-primary" onClick={submitDiary} disabled={!diaryText.trim()}>记上</button>
          </div>
        </div>
      )}

      <div className="diary-timeline">
        {diaries.length === 0 && <div className="empty-state">还没有日记</div>}
        {diaries.map(d => (
          <div key={d.id} className={`diary-entry ${d.author}`}>
            <div className="diary-meta">
              <span className="diary-author">{d.author === 'her' ? '桦桦' : '沐'}</span>
              <span className="diary-date">{formatDate(d.created_at)} {formatTime(d.created_at)}</span>
            </div>
            <div className="diary-content">{d.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsPage() {
  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>设置</h1>
      </div>

      <div className="card settings-card">
        <div className="setting-item" onClick={() => window.open('https://console.anthropic.com', '_blank')}>
          <span>Anthropic API</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div className="setting-item" onClick={() => window.open('https://platform.deepseek.com', '_blank')}>
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
          <span className="setting-value dim">0.2.0</span>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [tab, setTab] = useState('chat')

  const tabs = [
    { key: 'chat', label: 'Chat', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
    { key: 'calendar', label: '日历', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> },
    { key: 'today', label: 'Today', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    { key: 'settings', label: '设置', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  ]

  return (
    <div className="app">
      <div className="page-container">
        {tab === 'chat' && <ChatPage />}
        {tab === 'calendar' && <CalendarPage />}
        {tab === 'today' && <TodayPage />}
        {tab === 'settings' && <SettingsPage />}
      </div>

      <nav className="tab-bar">
        {tabs.map(t => (
          <button key={t.key}
            className={`tab-item ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
