import { useState, useEffect, useRef } from 'react'
import './App.css'

const API = 'https://mu-backend-l0uw.onrender.com'

function App() {
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [composing, setComposing] = useState(false)
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
    const handleVisibility = () => {
      if (!document.hidden) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])


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

  return (
    <div className="app">
      {showSidebar && <div className="overlay" onClick={() => setShowSidebar(false)} />}

      <div className={`sidebar ${showSidebar ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>对话</h2>
          <button className="new-chat" onClick={createSession}>+</button>
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

      <div className="main">
        <div className="header">
          <button className="menu-btn" onClick={() => setShowSidebar(!showSidebar)}>☰</button>
          <h1>沐</h1>
          <button className="model-btn" onClick={() => setModel(m => m === 'opus' ? 'sonnet' : m === 'sonnet' ? 'deepseek' : 'opus')}>
  {model === 'opus' ? 'Opus' : model === 'sonnet' ? 'Sonnet' : 'DS'}
</button>
          <button className="refresh-btn" onClick={() => { if (currentSession) { fetch(`${API}/api/sessions/${currentSession.id}/messages`).then(r => r.json()).then(setMessages) } }}>↻</button>
        </div>


        <div className="messages">
          {messages.length === 0 && (
            <div className="empty">开始和沐对话吧</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="bubble">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="message assistant">
              <div className="bubble typing">沐在思考...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            placeholder="说点什么..."
            rows={1}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()}>发送</button>
        </div>
      </div>
    </div>
  )
}

export default App
