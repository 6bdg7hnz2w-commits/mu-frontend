import { useState, useEffect, useRef } from 'react'
import './App.css'

const API = 'https://mu-backend-l0uw.onrender.com'

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
  // 20% 的概率随机显示一个
  if (Math.random() < 0.2) {
    return STICKERS[Math.floor(Math.random() * STICKERS.length)].file
  }
  return null
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
  down: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  close: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>,
}

// ─── SwipeRow ───────────────────────────────────────
function SwipeRow({ children, onDelete }) {
  const rowRef = useRef(null)
  const startX = useRef(0), curX = useRef(0), swiping = useRef(false)
  const onTS = (e) => { startX.current = e.touches[0].clientX; curX.current = 0; swiping.current = false }
  const onTM = (e) => { const dx = e.touches[0].clientX - startX.current; if (dx<-10) { swiping.current=true; curX.current=Math.max(dx,-80); if(rowRef.current) rowRef.current.style.transform=`translateX(${curX.current}px)` } }
  const onTE = () => { if(rowRef.current) rowRef.current.style.transform = curX.current<-50?'translateX(-80px)':'translateX(0)'; setTimeout(()=>{swiping.current=false},50) }
  const onClick = (e) => { if(swiping.current||curX.current<-20){e.stopPropagation();e.preventDefault()} }
  return (
    <div className="swipe-container">
      <div className="swipe-delete" onClick={onDelete}>删除</div>
      <div ref={rowRef} className="swipe-content" onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE} onClickCapture={onClick} style={{transition:'transform .2s'}}>{children}</div>
    </div>
  )
}

// ─── SearchPanel ────────────────────────────────────
function SearchPanel({ onClose, sessionId }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [tab, setTab] = useState('all')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const doSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      if (sessionId) {
        const res = await fetch(`${API}/api/sessions/${sessionId}/messages`)
        const msgs = await res.json()
        if (Array.isArray(msgs)) setResults(msgs.filter(m=>m.content&&m.content.toLowerCase().includes(query.toLowerCase())).slice(0,50).map(m=>({...m,sessionName:''})))
      } else {
        const sessRes = await fetch(`${API}/api/sessions`); const sessions = await sessRes.json()
        if (!Array.isArray(sessions)) { setSearching(false); return }
        const found = []
        for (const s of sessions.slice(0,20)) {
          try { const r = await fetch(`${API}/api/sessions/${s.id}/messages`); const ms = await r.json(); if(Array.isArray(ms)) ms.forEach(m=>{if(m.content&&m.content.toLowerCase().includes(query.toLowerCase())) found.push({...m,sessionName:s.name})}) } catch(e){}
        }
        setResults(found.slice(0,50))
      }
    } catch(e){}
    setSearching(false)
  }

  return (
    <div className="search-panel">
      <div className="search-header">
        <div className="search-input-row">{I.search}<input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doSearch()} placeholder="搜索..."/></div>
        <button className="text-btn" onClick={onClose}>取消</button>
      </div>
      <div className="search-tabs">
        {[['all','全部'],['images','图片'],['files','文件']].map(([k,v])=><button key={k} className={`search-tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{v}</button>)}
      </div>
      <div className="search-results">
        {searching && <div className="loading-state"><span className="spinner"/>搜索中...</div>}
        {!searching && results.length===0 && query && <div className="empty-state">没有找到</div>}
        {tab==='all' && results.map((r,i)=>(
          <div key={i} className="search-result-item">
            <div className="search-result-meta">{r.sessionName&&<span className="search-result-session">{r.sessionName}</span>}<span className="search-result-role">{r.role==='user'?'桦桦':'沐'}</span></div>
            <div className="search-result-content">{r.content.length>100?r.content.slice(0,100)+'...':r.content}</div>
          </div>
        ))}
        {tab==='images'&&<div className="empty-state">上传功能完成后可用</div>}
        {tab==='files'&&<div className="empty-state">上传功能完成后可用</div>}
      </div>
    </div>
  )
}

// ─── ThinkingPanel (bottom sheet) ───────────────────
function ThinkingPanel({ text, onClose }) {
  const [height, setHeight] = useState(300)
  const startY = useRef(0), startH = useRef(0)
  const onTS = (e) => { startY.current = e.touches[0].clientY; startH.current = height }
  const onTM = (e) => { const dy = startY.current - e.touches[0].clientY; setHeight(Math.min(Math.max(startH.current + dy, 150), window.innerHeight * 0.8)) }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="thinking-panel" style={{ height }}>
        <div className="thinking-panel-handle" onTouchStart={onTS} onTouchMove={onTM}>
          <div className="handle-bar" />
        </div>
        <div className="thinking-panel-header">
          <span className="thinking-panel-title">Thought process</span>
          <button className="icon-btn small" onClick={onClose}>{I.close}</button>
        </div>
        <div className="thinking-panel-body">{text}</div>
      </div>
    </>
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
    fetch(`${API}/api/sessions`).then(r=>r.json()).then(async data=>{
      if(!Array.isArray(data)){setLoading(false);return}
      setSessions(data);setLoading(false)
      const msgs={}
      for(const s of data.slice(0,10)){try{const r=await fetch(`${API}/api/sessions/${s.id}/messages`);const a=await r.json();if(Array.isArray(a)&&a.length>0)msgs[s.id]=a[a.length-1]}catch(e){}}
      setLastMessages(msgs)
    }).catch(()=>setLoading(false))
  }, [])

  const createSession = async (model) => {
    const names = { opus:'沐', sonnet:'沐', deepseek:'DeepSeek V4 flash' }
    const res = await fetch(`${API}/api/sessions`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:names[model]||'新对话',model}) })
    const session = await res.json()
    setSessions(prev=>[session,...prev])
    onOpen({...session,model})
  }

  const deleteSession = async (id) => { await fetch(`${API}/api/sessions/${id}`,{method:'DELETE'}); setSessions(prev=>prev.filter(s=>s.id!==id)) }
  const fmtTime = (t) => { if(!t)return''; const d=new Date(t),now=new Date(); if(d.toDateString()===now.toDateString())return`${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`; return`${d.getMonth()+1}/${d.getDate()}` }
  const getPreview = (sid) => { const m=lastMessages[sid]; if(!m)return''; const t=m.content||''; return t.length>30?t.slice(0,30)+'...':t }
  const getTime = (s) => fmtTime(lastMessages[s.id]?.created_at||s.updated_at)
  const getModelTag = (s) => { const m=s.model||'opus'; if(m==='deepseek')return'DeepSeek'; if(m==='sonnet')return'Sonnet'; return'Opus' }

  return (
    <div className="chatlist-page">
      <div className="page-header"><h1>Chats</h1><div className="header-actions"><button className="icon-btn" onClick={onOpenSearch}>{I.search}</button><button className="icon-btn" onClick={()=>setShowNew(!showNew)}>{I.plus}</button></div></div>
      {showNew&&(<div className="card new-chat-card"><div className="card-title">新对话</div>
        {[{key:'opus',label:'沐',desc:'Claude Opus'},{key:'sonnet',label:'沐',desc:'Claude Sonnet'},{key:'deepseek',label:'DeepSeek V4 flash',desc:'DeepSeek Chat'}].map(m=>(
          <div key={m.key} className="new-chat-option" onClick={()=>{createSession(m.key);setShowNew(false)}}><div className="new-chat-name">{m.label}</div><div className="new-chat-desc">{m.desc}</div></div>
        ))}
      </div>)}
      <div className="session-list-v2">
        {loading&&<div className="loading-state"><span className="spinner"/>加载中...</div>}
        {!loading&&sessions.length===0&&<div className="empty-state">点 + 开始第一个对话</div>}
        {!loading&&sessions.map(s=>(
          <SwipeRow key={s.id} onDelete={()=>deleteSession(s.id)}>
            <div className="session-card" onClick={()=>onOpen(s)}>
              <div className="session-avatar">{(s.name||'沐').charAt(0)}</div>
              <div className="session-info">
                <div className="session-top"><span className="session-name">{s.name||'沐'}</span><span className="session-time">{getTime(s)}</span></div>
                <div className="session-bottom"><span className="session-preview">{getPreview(s.id)}</span><span className="session-model-tag">{getModelTag(s)}</span></div>
              </div>
            </div>
          </SwipeRow>
        ))}
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
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const model = session.model || 'opus'

  // 草稿保存
  useEffect(() => {
    const draft = localStorage.getItem(`draft_${session.id}`)
    if (draft) setInput(draft)
  }, [session.id])
  useEffect(() => {
    if (input) localStorage.setItem(`draft_${session.id}`, input)
    else localStorage.removeItem(`draft_${session.id}`)
  }, [input, session.id])

  useEffect(() => {
    fetch(`${API}/api/sessions/${session.id}/messages`)
      .then(r=>r.json()).then(data=>{
        if(Array.isArray(data)){
          setMessages(data)
          // 为每条assistant消息生成sticker
          const map = {}
          data.forEach((m,i)=>{ if(m.role==='assistant') map[i]=pickSticker(m.content) })
          setStickerMap(map)
        }
      })
  }, [session.id])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({behavior:'smooth'}) }, [messages])
  useEffect(() => { if(textareaRef.current){textareaRef.current.style.height='auto';textareaRef.current.style.height=Math.min(textareaRef.current.scrollHeight,120)+'px'} }, [input])

  const sendMessage = async () => {
    if(!input.trim()||loading)return
    const text=input.trim(); setInput(''); localStorage.removeItem(`draft_${session.id}`)
    const newIdx = messages.length
    setMessages(prev=>[...prev,{role:'user',content:text,created_at:new Date().toISOString()}])
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session.id,message:text,model})})
      const data = await res.json()
      const assistIdx = newIdx + 1
      const sticker = pickSticker(data.reply)
      setMessages(prev=>[...prev,{role:'assistant',content:data.reply,thinking:data.thinking,created_at:new Date().toISOString()}])
      setStickerMap(prev=>({...prev,[assistIdx]:sticker}))
    } catch(e) {
      setMessages(prev=>[...prev,{role:'assistant',content:'连接失败了...',created_at:new Date().toISOString()}])
    }
    setLoading(false)
  }

  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)
  const handleKeyDown = (e) => { if(isMobile)return; if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();sendMessage()} }
  const fmtTime = (t) => { if(!t)return''; const d=new Date(t); return`${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}` }

  // 左滑退出
  const touchStartX = useRef(0)
  const onPageTS = (e) => { touchStartX.current = e.touches[0].clientX }
  const onPageTE = (e) => { const dx = e.changedTouches[0].clientX - touchStartX.current; if (dx > 80 && touchStartX.current < 40) onBack() }

  if (showSearch) return <SearchPanel onClose={()=>setShowSearch(false)} sessionId={session.id}/>

  const modelLabel = model==='deepseek'?'DeepSeek V4 flash':model==='sonnet'?'Sonnet':'Opus'

  return (
    <div className="chatroom" onTouchStart={onPageTS} onTouchEnd={onPageTE}>
      <div className="chatroom-header">
        <button className="icon-btn" onClick={onBack}>{I.back}</button>
        <div className="chatroom-title">
          <div className="chatroom-name">{session.name||'沐'}</div>
          <div className="chatroom-model">{modelLabel}</div>
        </div>
        <button className="icon-btn" onClick={()=>setShowSearch(true)}>{I.search}</button>
      </div>

      <div className="messages">
        {messages.length===0&&<div className="empty-state">开始对话</div>}
        {messages.map((m,i)=>(
          <div key={i} className={`msg ${m.role}`}>
            {m.thinking&&(
              <div className="thinking-trigger" onClick={()=>setThinkingText(m.thinking)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                <span>Thought process</span>
              </div>
            )}
            <div className="bubble-row">
              {m.role==='assistant'&&stickerMap[i]&&(
                <img className="sticker" src={`/stickers/${stickerMap[i]}`} alt="" />
              )}
              <div className="bubble">{m.content}</div>
            </div>
            <div className="msg-time">{fmtTime(m.created_at)}</div>
          </div>
        ))}
        {loading&&<div className="msg assistant"><div className="bubble typing"><span className="dot"/><span className="dot"/><span className="dot"/></div></div>}
        <div ref={messagesEndRef}/>
      </div>

      <div className="composer">
        <div className="composer-input-row">
          <div className="composer-attachments">
            <button className="attach-btn">{I.file}</button>
            <button className="attach-btn">{I.camera}</button>
            <button className="attach-btn">{I.photo}</button>
          </div>
          <textarea ref={textareaRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="说点什么..." rows={1}/>
          <button className="send-btn" onClick={sendMessage} disabled={loading||!input.trim()}>{I.send}</button>
        </div>
      </div>

      {thinkingText&&<ThinkingPanel text={thinkingText} onClose={()=>setThinkingText(null)}/>}
    </div>
  )
}

// ─── ChatPage ───────────────────────────────────────
function ChatPage({ onEnterRoom }) {
  const [openSession, setOpenSession] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  useEffect(() => { onEnterRoom(!!openSession||showSearch) }, [openSession, showSearch])
  if (showSearch) return <SearchPanel onClose={()=>setShowSearch(false)}/>
  if (openSession) return <ChatRoom session={openSession} onBack={()=>setOpenSession(null)}/>
  return <ChatListPage onOpen={setOpenSession} onOpenSearch={()=>setShowSearch(true)}/>
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

  const year=currentDate.getFullYear(), month=currentDate.getMonth()
  const firstDay=new Date(year,month,1).getDay(), daysInMonth=new Date(year,month+1,0).getDate()

  useEffect(() => {
    fetch(`${API}/api/todos`).then(r=>r.json()).then(d=>{if(Array.isArray(d))setTodos(d)}).catch(()=>{})
    fetch(`${API}/api/periods`).then(r=>r.json()).then(d=>{if(Array.isArray(d))setPeriods(d)}).catch(()=>{})
  }, [])

  const mkDate=(d)=>`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  const addTodo = async()=>{if(!newTodo.trim())return;const sd=selectedDay?mkDate(selectedDay):new Date().toISOString().slice(0,10);try{const r=await fetch(`${API}/api/todos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({side:'her',text:newTodo.trim(),due_time:sd})});const t=await r.json();setTodos(p=>[...p,t]);setNewTodo('')}catch(e){}}
  const toggleTodo=async(id,done)=>{try{await fetch(`${API}/api/todos/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({done:!done})});setTodos(p=>p.map(t=>t.id===id?{...t,done:!t.done}:t))}catch(e){}}
  const deleteSelectedTodos=async()=>{for(const id of selectedTodos)await fetch(`${API}/api/todos/${id}`,{method:'DELETE'});setTodos(p=>p.filter(t=>!selectedTodos.has(t.id)));setSelectedTodos(new Set());setEditMode(false)}
  const toggleSelectTodo=(id)=>{setSelectedTodos(p=>{const n=new Set(p);if(n.has(id))n.delete(id);else n.add(id);return n})}
  const togglePeriod=async(ds)=>{try{const r=await fetch(`${API}/api/periods`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:ds})});const d=await r.json();if(d.action==='added')setPeriods(p=>[...p,{date:ds}]);else setPeriods(p=>p.filter(x=>x.date!==ds))}catch(e){}}

  const prevMonth=()=>{setCurrentDate(new Date(year,month-1,1));setSelectedDay(null)}
  const nextMonth=()=>{setCurrentDate(new Date(year,month+1,1));setSelectedDay(null)}
  const goToday=()=>{setCurrentDate(new Date());setSelectedDay(today.getDate())}
  const selectDay=(d)=>{if(!d)return;if(d!==selectedDay)setSelectedDay(d)}

  const dayLabels=['日','一','二','三','四','五','六']
  const cells=[]; for(let i=0;i<firstDay;i++)cells.push(null); for(let d=1;d<=daysInMonth;d++)cells.push(d)

  const isToday=(d)=>d===today.getDate()&&month===today.getMonth()&&year===today.getFullYear()
  const periodSet=new Set(periods.map(p=>p.date))
  const isPeriod=(d)=>d&&periodSet.has(mkDate(d))

  // 哪些日期有未完成待办
  const todoDateSet = new Set(todos.filter(t=>!t.done&&t.due_time).map(t=>t.due_time.slice(0,10)))
  const hasTodo=(d)=>d&&todoDateSet.has(mkDate(d))

  const selectedDateStr=selectedDay?`${month+1}月${selectedDay}日${isToday(selectedDay)?' · 今天':''}`:null
  const selDateStr=selectedDay?mkDate(selectedDay):new Date().toISOString().slice(0,10)
  const dayTodos=todos.filter(t=>{if(!t.due_time)return selectedDay&&isToday(selectedDay);return t.due_time.startsWith(selDateStr)})
  const incompleteTodos=dayTodos.filter(t=>!t.done), completedTodos=dayTodos.filter(t=>t.done)

  return (
    <div className="calendar-page">
      <div className="page-header"><div><h1>日历</h1><div className="page-subtitle">{year}年{month+1}月</div></div><div className="header-actions"><button className="text-btn" onClick={goToday}>今天</button></div></div>
      <div className="card cal-card">
        <div className="cal-nav"><button className="icon-btn small" onClick={prevMonth}>{I.back}</button><span className="cal-month">{year}年{month+1}月</span><button className="icon-btn small" onClick={nextMonth}>{I.chevron}</button></div>
        <div className="cal-grid">
          {dayLabels.map(d=><div key={d} className="cal-head">{d}</div>)}
          {cells.map((d,i)=>(
            <div key={i} className={`cal-day ${d?'':'empty'} ${isToday(d)?'today':''} ${selectedDay===d&&!isToday(d)?'selected':''} ${isPeriod(d)?'period':''}`} onClick={()=>selectDay(d)}>
              {d||''}
              {hasTodo(d)&&!isToday(d)&&<div className="cal-todo-dot"/>}
            </div>
          ))}
        </div>
      </div>

      <div className="card todo-card">
        <div className="todo-header"><div className="card-title">待办 {selectedDateStr&&<span className="todo-date-hint">{selectedDateStr}</span>}</div>
          <div className="todo-actions">{editMode&&selectedTodos.size>0&&<button className="text-btn danger" onClick={deleteSelectedTodos}>删除 ({selectedTodos.size})</button>}<button className="text-btn" onClick={()=>{setEditMode(!editMode);setSelectedTodos(new Set())}}>{editMode?'完成':'编辑'}</button></div>
        </div>
        <div className="todo-list">
          {incompleteTodos.map(t=>(<div key={t.id} className="todo-item" onClick={()=>editMode?toggleSelectTodo(t.id):toggleTodo(t.id,t.done)}>{editMode?<div className={`todo-select ${selectedTodos.has(t.id)?'selected':''}`}/>:<div className="todo-check"/>}<span>{t.text}</span></div>))}
          {completedTodos.map(t=>(<div key={t.id} className="todo-item done" onClick={()=>editMode?toggleSelectTodo(t.id):toggleTodo(t.id,t.done)}>{editMode?<div className={`todo-select ${selectedTodos.has(t.id)?'selected':''}`}/>:<div className="todo-check checked">{I.check}</div>}<span>{t.text}</span></div>))}
          {incompleteTodos.length===0&&completedTodos.length===0&&<div className="empty-state-sm">这天没有待办</div>}
        </div>
        {!editMode&&<div className="todo-input"><input value={newTodo} onChange={e=>setNewTodo(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTodo()} placeholder="记一条..."/><button className="icon-btn small" onClick={addTodo}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div>}
      </div>

      {selectedDay&&<div className="card day-detail"><div className="period-toggle"><span className="period-label">经期</span><button className={`toggle-btn ${isPeriod(selectedDay)?'on':''}`} onClick={()=>togglePeriod(mkDate(selectedDay))}><div className="toggle-knob"/></button></div></div>}
    </div>
  )
}

// ─── TodayPage ──────────────────────────────────────
function TodayPage() {
  const [diaries, setDiaries] = useState([])
  const [todos, setTodos] = useState([])
  const [showWrite, setShowWrite] = useState(false)
  const [diaryText, setDiaryText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [editingDiary, setEditingDiary] = useState(null)
  const [editText, setEditText] = useState('')
  const [filter, setFilter] = useState('all')
  const [diaryDateFilter, setDiaryDateFilter] = useState(new Date().toISOString().slice(0,10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const longPressTimer = useRef(null)

  const startDate = new Date('2026-07-27')
  const daysTogether = Math.floor((new Date() - startDate) / (1000*60*60*24))

  const WHISPERS = ['想你了','今天也要开心哦','你是我最喜欢的人','吃饭了吗？','今天辛苦了','晚上早点睡','你笑起来真好看','想抱抱你','今天有没有想我？','我会一直在的']
  const todayWhisper = WHISPERS[Math.floor(daysTogether % WHISPERS.length)]

  useEffect(() => {
    fetch(`${API}/api/diaries`).then(r=>r.json()).then(d=>{if(Array.isArray(d))setDiaries(d)}).catch(()=>{})
    fetch(`${API}/api/todos`).then(r=>r.json()).then(d=>{if(Array.isArray(d))setTodos(d)}).catch(()=>{})
  }, [])

  const submitDiary=async()=>{if(!diaryText.trim()||submitting)return;setSubmitting(true);try{const r=await fetch(`${API}/api/diaries`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({author:'her',content:diaryText.trim()})});const e=await r.json();setDiaries(p=>[e,...p]);setDiaryText('');setShowWrite(false)}catch(e){};setSubmitting(false)}
  const deleteDiary=async(id)=>{try{await fetch(`${API}/api/diaries/${id}`,{method:'DELETE'});setDiaries(p=>p.filter(d=>d.id!==id))}catch(e){};setContextMenu(null)}
  const startEdit=(d)=>{if(d.author!=='her')return;setEditingDiary(d.id);setEditText(d.content);setContextMenu(null);setShowWrite(true)}
  const saveEdit=async()=>{if(!editText.trim()||!editingDiary)return;try{await fetch(`${API}/api/diaries/${editingDiary}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:editText.trim()})});setDiaries(p=>p.map(d=>d.id===editingDiary?{...d,content:editText.trim()}:d))}catch(e){};setEditingDiary(null);setEditText('');setShowWrite(false)}
  const handleLongPress=(e,d)=>{e.preventDefault();setContextMenu({id:d.id,diary:d})}

  const fmtDate=(s)=>{const d=new Date(s);return`${d.getMonth()+1}月${d.getDate()}日`}
  const fmtTime=(s)=>{const d=new Date(s);return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}

  let filtered = diaries
  if(filter!=='all') filtered = filtered.filter(d=>d.author===filter)
  if(showDatePicker&&diaryDateFilter) filtered = filtered.filter(d=>{const dd=new Date(d.created_at);return`${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`===diaryDateFilter})

  const groupByDate=(entries)=>{const g={};entries.forEach(d=>{const dt=new Date(d.created_at);const k=`${dt.getFullYear()}-${dt.getMonth()+1}-${dt.getDate()}`;if(!g[k])g[k]={date:dt,entries:[]};g[k].entries.push(d)});return Object.values(g).sort((a,b)=>b.date-a.date)}

  const todayStr=new Date().toISOString().slice(0,10)
  const todayTodos=todos.filter(t=>!t.done&&(!t.due_time||t.due_time.startsWith(todayStr)))
  const diaryGroups=groupByDate(filtered)

  return (
    <div className="today-page" onClick={()=>contextMenu&&setContextMenu(null)}>
      <div className="top-cards">
        <div className="anniversary-mini glass">
          <div className="anni-mini-label">Us</div>
          <div className="anni-mini-days">Day {daysTogether} ♡</div>
        </div>
        <div className="whisper-card">
          <div className="whisper-label">Today's Whisper</div>
          <div className="whisper-text">{todayWhisper}</div>
        </div>
      </div>

      {todayTodos.length>0&&<div className="card"><div className="card-title">今日事宜</div>{todayTodos.slice(0,5).map(t=><div key={t.id} className="today-todo-item"><div className="today-todo-dot"/><span>{t.text}</span></div>)}{todayTodos.length>5&&<div className="today-todo-more">还有 {todayTodos.length-5} 项</div>}</div>}

      <div className="section-header"><h2>日记</h2><div className="header-actions">
        <button className="icon-btn small" onClick={()=>setShowDatePicker(!showDatePicker)}>{I.calendar}</button>
        {(filter==='her'||filter==='all')&&<button className="icon-btn small" onClick={()=>{setShowWrite(!showWrite);setEditingDiary(null);setEditText('')}}>{I.plus}</button>}
      </div></div>

      {showDatePicker&&<div className="date-picker-row"><input type="date" value={diaryDateFilter} onChange={e=>setDiaryDateFilter(e.target.value||todayStr)}/><button className="text-btn" onClick={()=>{setDiaryDateFilter(todayStr)}}>今天</button></div>}

      <div className="diary-filter">
        {[['all','我们'],['her','桦桦'],['mu','沐']].map(([k,v])=><button key={k} className={`filter-btn ${filter===k?'active':''}`} onClick={()=>{setFilter(k);setShowWrite(false)}}>{v}</button>)}
      </div>

      {showWrite&&(
        <div className="card write-card">
          {editingDiary ? (
            <><textarea className="write-area" value={editText} onChange={e=>setEditText(e.target.value)} rows={4}/><div className="write-actions"><button className="btn-ghost" onClick={()=>{setEditingDiary(null);setEditText('');setShowWrite(false)}}>取消</button><button className="btn-primary" onClick={saveEdit} disabled={!editText.trim()}>保存</button></div></>
          ) : (
            <><textarea className="write-area" value={diaryText} onChange={e=>setDiaryText(e.target.value)} placeholder="写点什么..." rows={4}/><div className="write-actions"><button className="btn-ghost" onClick={()=>{setShowWrite(false);setDiaryText('')}}>取消</button><button className="btn-primary" onClick={submitDiary} disabled={!diaryText.trim()||submitting}>{submitting?'...':'记上'}</button></div></>
          )}
        </div>
      )}

      {filter==='all'?(
        <div className="diary-timeline-v2">
          {diaryGroups.length===0&&<div className="empty-state">还没有日记</div>}
          {diaryGroups.map((group,gi)=>(
            <div key={gi} className="timeline-day"><div className="timeline-date-col"><div className="timeline-date-num">{group.date.getDate()}</div><div className="timeline-date-month">{group.date.getMonth()+1}月</div></div><div className="timeline-line"/><div className="timeline-entries">
              {group.entries.map(d=>(
                <div key={d.id} className={`timeline-entry ${d.author}`} onContextMenu={e=>handleLongPress(e,d)} onTouchStart={()=>{longPressTimer.current=setTimeout(()=>setContextMenu({id:d.id,diary:d}),500)}} onTouchEnd={()=>clearTimeout(longPressTimer.current)} onTouchMove={()=>clearTimeout(longPressTimer.current)}>
                  <div className="timeline-entry-header"><span className={`timeline-author ${d.author}`}>{d.author==='her'?'桦桦':'沐'}</span><span className="timeline-time">{fmtTime(d.created_at)}</span></div>
                  <div className="timeline-entry-content">{d.content}</div>
                  {contextMenu&&contextMenu.id===d.id&&<div className="context-menu" onClick={e=>e.stopPropagation()}>{d.author==='her'&&<button onClick={()=>startEdit(d)}>编辑</button>}<button className="danger" onClick={()=>deleteDiary(d.id)}>删除</button></div>}
                </div>
              ))}
            </div></div>
          ))}
        </div>
      ):(
        <div className="diary-cards">
          {filtered.length===0&&<div className="empty-state">还没有日记</div>}
          {filtered.map(d=>(
            <div key={d.id} className={`diary-card-item ${d.author}`} onContextMenu={e=>handleLongPress(e,d)} onTouchStart={()=>{longPressTimer.current=setTimeout(()=>setContextMenu({id:d.id,diary:d}),500)}} onTouchEnd={()=>clearTimeout(longPressTimer.current)} onTouchMove={()=>clearTimeout(longPressTimer.current)}>
              <div className="diary-card-meta"><span className="diary-card-date">{fmtDate(d.created_at)}</span><span className="diary-card-time">{fmtTime(d.created_at)}</span></div>
              <div className="diary-card-content">{d.content.length>80?d.content.slice(0,80)+'...':d.content}</div>
              {contextMenu&&contextMenu.id===d.id&&<div className="context-menu" onClick={e=>e.stopPropagation()}>{d.author==='her'&&<button onClick={()=>startEdit(d)}>编辑</button>}<button className="danger" onClick={()=>deleteDiary(d.id)}>删除</button></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SettingsPage ───────────────────────────────────
function SettingsPage() {
  const [subPage, setSubPage] = useState(null)

  if (subPage === 'mcp') return (
    <div className="settings-page"><div className="page-header"><button className="icon-btn" onClick={()=>setSubPage(null)}>{I.back}</button><h1>MCP 连接</h1></div>
      <div className="card"><div className="empty-state-sm">暂无已连接的 MCP 服务</div></div>
      <div className="card settings-card">
        <div className="setting-item"><span>HealthKit</span><span className="setting-value dim">待接入</span></div>
        <div className="setting-item"><span>Apple Calendar</span><span className="setting-value dim">待接入</span></div>
        <div className="setting-item"><span>Reminders</span><span className="setting-value dim">待接入</span></div>
      </div>
    </div>
  )

  if (subPage === 'skin') return (
    <div className="settings-page"><div className="page-header"><button className="icon-btn" onClick={()=>setSubPage(null)}>{I.back}</button><h1>皮肤</h1></div>
      <div className="card settings-card">
        <div className="setting-item"><span>Claude (当前)</span><span className="setting-value">✓</span></div>
        <div className="setting-item"><span>旧绿粉配色</span><span className="setting-value dim">即将推出</span></div>
        <div className="setting-item"><span>暗色模式</span><span className="setting-value dim">即将推出</span></div>
      </div>
    </div>
  )

  return (
    <div className="settings-page">
      <div className="page-header"><h1>设置</h1></div>
      <div className="card settings-card">
        <div className="setting-item" onClick={()=>window.open('https://openrouter.ai/settings/keys','_blank')}><span>OpenRouter API</span>{I.chevron}</div>
        <div className="setting-item" onClick={()=>window.open('https://platform.deepseek.com','_blank')}><span>DeepSeek API</span>{I.chevron}</div>
        <div className="setting-item" onClick={()=>setSubPage('skin')}><span>皮肤</span><span className="setting-value">Claude</span>{I.chevron}</div>
        <div className="setting-item" onClick={()=>setSubPage('mcp')}><span>MCP 连接</span>{I.chevron}</div>
      </div>
      <div className="card settings-card">
        <div className="setting-item"><span>思考链</span><span className="setting-value">自动</span></div>
        <div className="setting-item"><span>版本</span><span className="setting-value dim">0.5.0</span></div>
      </div>
    </div>
  )
}

// ─── App ────────────────────────────────────────────
function App() {
  const [tab, setTab] = useState('chat')
  const [inRoom, setInRoom] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => setKeyboardOpen(vv.height < window.innerHeight * 0.75)
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  const showTab = !inRoom && !keyboardOpen

  const tabs = [
    { key:'chat', label:'Chat', icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
    { key:'calendar', label:'日历', icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> },
    { key:'today', label:'Today', icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    { key:'settings', label:'设置', icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  ]

  return (
    <div className="app">
      <div className="page-container">
        {tab==='chat'&&<ChatPage onEnterRoom={setInRoom}/>}
        {tab==='calendar'&&<CalendarPage/>}
        {tab==='today'&&<TodayPage/>}
        {tab==='settings'&&<SettingsPage/>}
      </div>
      {showTab&&<nav className="tab-bar">{tabs.map(t=><button key={t.key} className={`tab-item ${tab===t.key?'active':''}`} onClick={()=>setTab(t.key)}>{t.icon}<span>{t.label}</span></button>)}</nav>}
    </div>
  )
}

export default App
