import { useEffect, useRef, useState } from 'react'
import { getPasscode, apiJson, ensureImportantMigrated, importantFromEvent, eventFirstDay, eventLastDay, shDateOf, shTimeOf, addDaysStr, daysBetweenStr, predictNextPeriod } from '../App.jsx'
import { V, MONS, MONF, ActionSheet, useToast } from './ui.jsx'

// ─── Calendar ───────────────────────────────────────
// 和 Clawd 的 CalendarPage 同一套接口：/api/events（日程 + kind=important 的重要日期）、/api/todos、/api/periods。
// 日程卡片点一下翻到备注，长按出 Edit / Delete；手机日历同步来的只能看

const pad2 = (n) => String(n).padStart(2, '0')
const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const minToHm = (n) => { const v = ((n % 1440) + 1440) % 1440; return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}` }
const nextWholeHour = () => `${pad2((Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date())) + 1) % 24)}:00`
const errText = (e) => e?.message === 'locked' || e?.status === 401 ? 'Passcode expired — unlock and try again'
  : e?.status === 400 || e?.status === 403 ? `Not saved: ${e.message}` : 'Not saved — try again later'

// 待办输入框点开键盘后：整张待办卡片的底边落在键盘上方 24px（键盘弹出要一会儿，等两次再对齐）
function keepAboveKeyboard(card) {
  const align = () => {
    const page = card?.closest('.v-page'), vv = window.visualViewport
    if (!page || !vv) return
    const gap = card.getBoundingClientRect().bottom - (vv.height - 24)
    if (Math.abs(gap) > 2) page.scrollTo({ top: page.scrollTop + gap, behavior: 'smooth' })
  }
  setTimeout(align, 300); setTimeout(align, 650)
}

// 画布上的样子：居中的卡片，标题居中，底下一行 Delete … Cancel [Save]
function Modal({ title, onClose, children }) {
  return (
    <div className="v-modal" onClick={onClose}>
      <div className="v-modal-card" onClick={e => e.stopPropagation()}>
        <div className="v-modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

// 新建 / 编辑日程（event 为空是新建）
function EventSheet({ event, defaultDate, onClose, onSaved }) {
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
  const changeStart = (v) => { if (v && start && end) setEnd(minToHm(hmToMin(end) + hmToMin(v) - hmToMin(start))); setStart(v) }
  const save = async () => {
    if (!title.trim() || busy) return
    if (!date || (!allDay && !start)) { setError('Date and start time are needed'); return }
    const body = { title: title.trim(), all_day: allDay, location: location.trim() || null, notes: notes.trim() || null }
    if (allDay) {
      body.start_date = date
      const origStart = event?.series_start_date ?? event?.start_date, origEnd = event?.series_end_date ?? event?.end_date
      body.end_date = event?.all_day && origEnd ? addDaysStr(date, daysBetweenStr(origStart, origEnd)) : null
    } else {
      body.starts_at = `${date}T${start}`
      body.ends_at = end ? `${end < start ? addDaysStr(date, 1) : date}T${end}` : null
    }
    setBusy(true); setError('')
    try {
      await (event ? apiJson('PUT', `/api/events/${event.series_id ?? event.id}`, body) : apiJson('POST', '/api/events', body))
      onSaved(); onClose()
    } catch (e) { setError(errText(e)); setBusy(false) }
  }
  return (
    <Modal title={readOnly ? 'Event' : event ? 'Edit Event' : 'New Event'} onClose={onClose}>
      <input className="v-field" placeholder="What's happening" value={title} onChange={e => setTitle(e.target.value)} disabled={readOnly} />
      <div className="v-seg small">
        <div className="v-seg-thumb" style={{ transform: `translateX(${allDay ? '0' : '100%'})` }} />
        <button className={allDay ? 'on' : ''} onClick={() => setAllDay(true)} disabled={readOnly}>All day</button>
        <button className={allDay ? '' : 'on'} onClick={() => setAllDay(false)} disabled={readOnly}>Timed</button>
      </div>
      <input className="v-field" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={readOnly} />
      {!allDay && (
        <div className="v-field-row">
          <input className="v-field" type="time" value={start} onChange={e => changeStart(e.target.value)} disabled={readOnly} aria-label="Start" />
          <span>–</span>
          <input className="v-field" type="time" value={end} onChange={e => setEnd(e.target.value)} disabled={readOnly} aria-label="End" />
        </div>
      )}
      <input className="v-field" placeholder="Location (optional)" value={location} onChange={e => setLocation(e.target.value)} disabled={readOnly} />
      <textarea className="v-field" rows={3} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} />
      {error && <div className="v-error">{error}</div>}
      {readOnly
        ? <div className="v-modal-actions"><span className="v-modal-note">From your phone calendar — edit it on your phone</span><button className="v-text-btn acc" data-back onClick={onClose}>Close</button></div>
        : <div className="v-modal-actions">
            <button className="v-text-btn" data-back onClick={onClose}>Cancel</button>
            <button className="v-btn" onClick={save} disabled={!title.trim() || busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>}
    </Modal>
  )
}

// 新建 / 编辑重要日期（item 为空是新建）
function DateSheet({ item, onClose, onSave, onDelete }) {
  const [name, setName] = useState(item?.name || '')
  const [date, setDate] = useState(item?.date || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn) => { if (busy) return; setBusy(true); setError(''); try { await fn(); onClose() } catch (e) { setError(errText(e)); setBusy(false) } }
  return (
    <Modal title={item ? 'Edit Date' : 'Add Important Date'} onClose={onClose}>
      <input className="v-field" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <input className="v-field" type="date" value={date} onChange={e => setDate(e.target.value)} />
      {error && <div className="v-error">{error}</div>}
      <div className="v-modal-actions">
        {item && <button className="v-text-btn danger" onClick={() => run(() => onDelete(item.id))} disabled={busy}>Delete</button>}
        <span className="v-modal-gap" />
        <button className="v-text-btn" data-back onClick={onClose}>Cancel</button>
        <button className="v-btn" onClick={() => name.trim() && date && run(() => onSave({ ...item, name: name.trim(), date }))} disabled={!name.trim() || !date || busy}>Save</button>
      </div>
    </Modal>
  )
}

function MonthSheet({ year, month, onPick, onClose }) {
  const now = new Date().getFullYear()
  const years = []; for (let y = now - 10; y <= now + 10; y++) years.push(y)
  return (
    <Modal title="Jump to Month" onClose={onClose}>
      <div className="v-field-row">
        <select className="v-field" value={month} onChange={e => onPick(year, Number(e.target.value))}>
          {MONS.map((m, i) => <option key={m} value={i}>{m.charAt(0)}{m.slice(1).toLowerCase()}</option>)}
        </select>
        <select className="v-field" value={year} onChange={e => onPick(Number(e.target.value), month)}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <button className="v-btn wide" data-back onClick={onClose}>Done</button>
    </Modal>
  )
}

function EventCard({ e, flipped, onFlip, onMenu }) {
  const lp = useRef({ t: null, fired: false })
  const press = (ev) => { if (ev.button > 0) return; clearTimeout(lp.current.t); lp.current.fired = false; lp.current.t = setTimeout(() => { lp.current.fired = true; onMenu(e) }, 500) }
  const release = () => clearTimeout(lp.current.t)
  return (
    <div className="v-ev" onClick={() => { if (lp.current.fired) { lp.current.fired = false; return } if (e.notes) onFlip() }}
      onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
      onContextMenu={ev => { ev.preventDefault(); release(); lp.current.fired = true; onMenu(e) }}>
      <div className="v-ev-face front" style={{ transform: `rotateY(${flipped ? '-180deg' : '0deg'})` }}>
        <div className="v-ev-time">
          {e.all_day ? <span>All day</span> : <><span>{shTimeOf(e.starts_at)}</span><em>{e.ends_at ? shTimeOf(e.ends_at) : ''}</em></>}
        </div>
        <div className="v-ev-bar" />
        <div className="v-ev-main">
          <div className="v-ev-title"><span>{e.title}</span>{e.source === 'phone' && <em>Phone</em>}{e.source === 'mu' && <em>Soren</em>}</div>
          {e.location && <div className="v-ev-loc">{e.location}</div>}
        </div>
        {e.notes && <div className="v-ev-ribbon" />}
      </div>
      <div className="v-ev-face back" style={{ transform: `rotateY(${flipped ? '0deg' : '180deg'})` }}>
        <div className="v-ev-note-head"><span>NOTE</span><i /><em>{e.title}</em></div>
        <div className="v-ev-note">{e.notes}</div>
      </div>
    </div>
  )
}

export default function CalendarTab() {
  const now = new Date()
  const todayKey = localDay(now)
  const [cur, setCur] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [sel, setSel] = useState(todayKey)
  const [todos, setTodos] = useState([])
  const [periods, setPeriods] = useState([])
  const [events, setEvents] = useState({ key: null, list: [] })
  const [reloadN, setReloadN] = useState(0)
  const [newTodo, setNewTodo] = useState('')
  const [editTodos, setEditTodos] = useState(false)
  const [picked, setPicked] = useState(new Set())
  const [flip, setFlip] = useState({})
  const [modal, setModal] = useState(null) // { type: 'event', event?, date } | { type: 'date', item? } | { type: 'month' }
  const [evMenu, setEvMenu] = useState(null)
  const [toast, showToast] = useToast()

  const year = cur.getFullYear(), month = cur.getMonth()
  const dim = new Date(year, month + 1, 0).getDate()
  const mk = (d) => `${year}-${pad2(month + 1)}-${pad2(d)}`
  const from = mk(1), to = mk(dim)

  useEffect(() => {
    if (!getPasscode()) return
    apiJson('GET', '/api/todos').then(d => { if (Array.isArray(d)) setTodos(d) }).catch(() => {})
    apiJson('GET', '/api/periods').then(d => { if (Array.isArray(d)) setPeriods(d) }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!getPasscode()) return
    let alive = true
    ensureImportantMigrated()
      .then(() => apiJson('GET', `/api/events?from=${from}&to=${to}`))
      .then(list => { if (alive) setEvents({ key: from, list }) })
      .catch(() => { if (alive) showToast("Couldn't load events") })
    return () => { alive = false }
  }, [from, to, reloadN]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setReloadN(n => n + 1)

  const monthEvents = events.key === from ? events.list : []
  const schedule = monthEvents.filter(e => e.kind === 'event')
  const importantByDay = {}
  monthEvents.filter(e => e.kind === 'important').forEach(e => { const i = importantFromEvent(e); (importantByDay[i.shownOn] ||= []).push(i) })
  const eventDays = new Set()
  schedule.forEach(e => { const last = eventLastDay(e); for (let d = eventFirstDay(e) < from ? from : eventFirstDay(e); d <= last && d <= to; d = addDaysStr(d, 1)) eventDays.add(d) })
  const periodSet = new Set(periods.map(p => p.date))
  const predicted = new Set(predictNextPeriod(periods))
  const todoDays = new Set(todos.filter(t => !t.done && t.due_time).map(t => t.due_time.slice(0, 10)))

  const dayEvents = schedule.filter(e => eventFirstDay(e) <= sel && eventLastDay(e) >= sel)
    .sort((a, b) => (a.all_day ? 0 : 1) - (b.all_day ? 0 : 1) || Date.parse(a.starts_at || 0) - Date.parse(b.starts_at || 0))
  const dayTodos = todos.filter(t => t.due_time ? t.due_time.startsWith(sel) : sel === todayKey)
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
  const dayImportant = importantByDay[sel] || []
  const selD = new Date(`${sel}T00:00:00`)

  const goMonth = (y, m) => setCur(new Date(y, m, 1))
  // 月历左右划换月：往左划下个月，往右划上个月（横向要明显多过竖向，免得和上下滚动打架）
  const swipeAt = useRef(null)
  const monthSwipe = {
    onTouchStart: (e) => { const p = e.touches[0]; swipeAt.current = { x: p.clientX, y: p.clientY } },
    onTouchEnd: (e) => {
      const s = swipeAt.current; swipeAt.current = null
      if (!s) return
      const p = e.changedTouches[0], dx = p.clientX - s.x, dy = Math.abs(p.clientY - s.y)
      if (Math.abs(dx) < 50 || dy > Math.abs(dx) * 0.6) return
      goMonth(cur.getFullYear(), cur.getMonth() + (dx < 0 ? 1 : -1))
    },
  }
  const addTodo = async () => {
    if (!newTodo.trim()) return
    try { const t = await apiJson('POST', '/api/todos', { side: 'her', text: newTodo.trim(), due_time: sel }); setTodos(p => [...p, t]); setNewTodo('') } catch (e) { showToast(errText(e)) }
  }
  const toggleTodo = async (t) => {
    try { await apiJson('PUT', `/api/todos/${t.id}`, { done: !t.done }); setTodos(p => p.map(x => x.id === t.id ? { ...x, done: !x.done } : x)) } catch (e) { showToast(errText(e)) }
  }
  const deleteTodos = async () => {
    const gone = new Set()
    for (const id of picked) { try { await apiJson('DELETE', `/api/todos/${id}`); gone.add(id) } catch {} }
    setTodos(p => p.filter(t => !gone.has(t.id))); setPicked(new Set()); setEditTodos(false)
  }
  const togglePeriod = async () => {
    try { const d = await apiJson('POST', '/api/periods', { date: sel }); setPeriods(p => d.action === 'added' ? [...p, { date: sel }] : p.filter(x => x.date !== sel)) } catch (e) { showToast(errText(e)) }
  }
  const deleteEvent = async (e) => {
    setEvMenu(null)
    try { await apiJson('DELETE', `/api/events/${e.series_id ?? e.id}`); reload() } catch (err) { showToast(errText(err)) }
  }

  const cells = []
  for (let i = 0; i < cur.getDay(); i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push(d)

  return (
    <>
    <div className="v-page v-cal">
      <div className="v-cal-top">
        <div className="v-diary-titles">
          <div className="v-diary-title">Calendar</div>
          {year !== now.getFullYear() && <div className="v-caps">{year}</div>}
        </div>
        <div className="v-cal-actions">
          <button className="v-today" onClick={() => { goMonth(now.getFullYear(), now.getMonth()); setSel(todayKey) }}>Today</button>
          <button className="v-sq big" onClick={() => setModal({ type: 'date' })} aria-label="Add important date">{V.plus}</button>
        </div>
      </div>

      <div className="v-card v-month" {...monthSwipe}>
        <div className="v-month-nav">
          <button onClick={() => goMonth(year, month - 1)} aria-label="Previous month">{V.left}</button>
          <div className="v-month-label" onClick={() => setModal({ type: 'month' })}>{MONF[month].charAt(0)}{MONF[month].slice(1).toLowerCase()}{year !== now.getFullYear() ? ` ${year}` : ''}</div>
          <button onClick={() => goMonth(year, month + 1)} aria-label="Next month">{V.right}</button>
        </div>
        <div className="v-month-head">{['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => <div key={d}>{d}</div>)}</div>
        <div key={`${year}-${month}`} className="v-month-grid">
          {cells.map((d, i) => {
            if (!d) return <div key={`x${i}`} className="v-mc" />
            const k = mk(d), isT = k === todayKey, isS = k === sel, isP = periodSet.has(k), isPr = predicted.has(k) && !isP
            return (
              <div key={k} className="v-mc" onClick={() => { setSel(k); setEditTodos(false); setPicked(new Set()) }}>
                <div className={`v-mc-num ${isT ? 'today' : ''} ${isS && !isT ? 'sel' : ''} ${isP && !isT ? 'period' : ''} ${isPr ? 'pred' : ''}`}>{d}</div>
                <div className="v-mc-dots">
                  {importantByDay[k] && V.heartFill}
                  {eventDays.has(k) && <i className="evt" />}
                  {todoDays.has(k) && <i className="todo" />}
                </div>
              </div>
            )
          })}
        </div>
        <div className="v-legend">
          <span><i className="period" />Period</span>
          <span><i className="pred" />Predicted</span>
          <span><i className="todo" />Todo</span>
          <span><svg width="9" height="9" viewBox="0 0 24 24"><path fill="#c4a06a" d="M12 21s-9-5.6-9-12.2A5 5 0 0 1 12 5.6a5 5 0 0 1 9 3.2C21 15.4 12 21 12 21z" /></svg>Important</span>
          <span><i className="evt" />Events</span>
        </div>
      </div>

      {dayImportant.length > 0 && (
        <div className="v-card v-list-card">
          <div className="v-card-title">Important Dates</div>
          <div className="v-list">
            {dayImportant.map(i => (
              <div key={i.id} className="v-imp" onClick={() => setModal({ type: 'date', item: i })}>
                {V.heartFill}<span>{i.name}</span><em>{i.recurring === 'yearly' ? 'Every year' : i.recurring === 'monthly' ? 'Every month' : 'Once'}</em>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="v-card v-list-card">
        <div className="v-card-head">
          <div className="v-card-title">Events</div>
          <button className="v-round" onClick={() => setModal({ type: 'event', date: sel })} aria-label="New event">{V.plus}</button>
        </div>
        <div className="v-evs">
          {dayEvents.map(e => <EventCard key={e.id} e={e} flipped={!!flip[e.id]} onFlip={() => setFlip(f => ({ ...f, [e.id]: !f[e.id] }))} onMenu={setEvMenu} />)}
        </div>
        {dayEvents.length === 0 && <div className="v-nothing">Nothing planned</div>}
      </div>

      <div className="v-card v-list-card">
        <div className="v-card-head">
          <div className="v-card-title">Todos <span className="v-hint">{selD.getMonth() + 1}/{selD.getDate()}{sel === todayKey ? ' · Today' : ''}</span></div>
          <div className="v-card-links">
            {editTodos && picked.size > 0 && <button className="v-text-btn danger" onClick={deleteTodos}>Delete ({picked.size})</button>}
            <button className="v-text-btn acc" onClick={() => { setEditTodos(e => !e); setPicked(new Set()) }}>{editTodos ? 'Done' : 'Edit'}</button>
          </div>
        </div>
        <div className="v-todos">
          {dayTodos.map(t => {
            const on = editTodos ? picked.has(t.id) : t.done
            return (
              <div key={t.id} className={`v-todo ${t.done ? 'done' : ''}`} onClick={() => editTodos ? setPicked(p => { const n = new Set(p); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n }) : toggleTodo(t)}>
                <div className={`v-todo-box ${on ? (editTodos ? 'picked' : 'on') : ''}`}>{V.tick}</div>
                <span>{t.text}</span>
              </div>
            )
          })}
          {dayTodos.length === 0 && <div className="v-nothing">No todos</div>}
        </div>
        {!editTodos && (
          <div className="v-todo-input">
            <input value={newTodo} onChange={e => setNewTodo(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTodo()} placeholder="Add a todo..."
              onFocus={e => keepAboveKeyboard(e.currentTarget.closest('.v-card'))} />
            <button className={newTodo.trim() ? 'on' : ''} onClick={addTodo} aria-label="Add">{V.send}</button>
          </div>
        )}
      </div>

      <div className="v-card v-period">
        <span>Period</span>
        <button className={`v-switch ${periodSet.has(sel) ? 'on' : ''}`} onClick={togglePeriod} aria-label="Toggle period"><i /></button>
      </div>

      {modal?.type === 'event' && <EventSheet event={modal.event} defaultDate={modal.date} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.type === 'date' && (
        <DateSheet item={modal.item} onClose={() => setModal(null)}
          onSave={d => (d.id
            ? apiJson('PUT', `/api/events/${d.id}`, { title: d.name, start_date: d.date })
            : apiJson('POST', '/api/events', { title: d.name, all_day: true, start_date: d.date, kind: 'important', repeat: 'none' })).then(reload)}
          onDelete={id => apiJson('DELETE', `/api/events/${id}`).then(reload)} />
      )}
      {modal?.type === 'month' && <MonthSheet year={year} month={month} onPick={goMonth} onClose={() => setModal(null)} />}
      {evMenu && (
        <ActionSheet title={evMenu.title} onClose={() => setEvMenu(null)}
          actions={[
            { label: evMenu.source === 'phone' ? 'View' : 'Edit', onClick: () => { setModal({ type: 'event', event: evMenu }); setEvMenu(null) } },
            evMenu.source !== 'phone' && { label: 'Delete', danger: true, onClick: () => deleteEvent(evMenu) },
          ]} />
      )}
      {toast}
    </div>
    </>
  )
}
