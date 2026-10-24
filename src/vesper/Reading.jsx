import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../shell/data.js'

// ─── Reading ────────────────────────────────────────
// 书架（壁纸 + 平面封面 + 搜索 + 上次打开的那本）和羊皮纸阅读器（划线、楼层回复、目录、进度）。
// 接口和 Clawd 的 NookPage 一样：/api/nook/books、chapters、progress、ai-progress、annotations、floors

const ME = 'hua'
const LAST_KEY = 'mu_vesper_last_book'
const WK = "'V Dots','LXGW WenKai TC','Noto Serif SC',serif"
// 封面配色：按书名挑一组，同一本书每次都一样
const PALETTES = [
  { bg: '#2f5577', ink: '#f6ece9', acc: '#eac5c0' }, { bg: '#e39d9b', ink: '#2f3a5c', acc: '#f6e3c8' },
  { bg: '#827593', ink: '#f5ecef', acc: '#e2c2bd' }, { bg: '#e2c2bd', ink: '#5f5c83', acc: '#8789ab' },
  { bg: '#5b6f9c', ink: '#f3eef4', acc: '#ddb4b2' }, { bg: '#5f5c83', ink: '#f4e6e6', acc: '#e39d9b' },
  { bg: '#b2889c', ink: '#fbf2f4', acc: '#3c608c' },
]
const paletteOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTES[h % PALETTES.length] }
const bare = (t) => String(t || '').replace(/^《|》$/g, '')
const CN = n => { const d = '零一二三四五六七八九'; if (n < 10) return d[n]; if (n < 20) return '十' + (n % 10 ? d[n % 10] : ''); if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : ''); return String(n) }
const ROMAN = n => [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']].reduce((o, [v, r]) => { while (n >= v) { o += r; n -= v } return o }, '')
const fmtAt = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const getJson = (path) => apiFetch(path).then(r => r.json())
const sendJson = (method, path, body) => apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())

function Cover({ b, w }) {
  const p = paletteOf(b.title), t = bare(b.title)
  return (
    <div className="v-cover" style={{ width: w, background: p.bg, color: p.ink }}>
      <div className="v-cover-sheen" />
      <div className="v-cover-frame" style={{ borderColor: p.ink }} />
      <div className="v-cover-title" style={{ fontFamily: WK, fontSize: t.length > 5 ? w * 0.11 : t.length > 3 ? w * 0.13 : w * 0.17, letterSpacing: t.length > 5 ? '.04em' : '.14em' }}>{t}</div>
      <div className="v-cover-rule" style={{ width: w * 0.18, marginLeft: -w * 0.09 + 2, background: p.ink }} />
      {b.en_title && <div className="v-cover-en" style={{ fontSize: Math.max(8.5, w * 0.092) }}>{b.en_title}</div>}
      <div className="v-cover-author" style={{ fontFamily: WK, fontSize: Math.max(7.5, w * 0.07) }}>{b.author}</div>
    </div>
  )
}

function Progress({ her, mu, total }) {
  if (!total) return null
  return (
    <div className="v-prog">
      <i style={{ width: `${Math.min(100, ((her || 0) / total) * 100)}%` }} />
      {mu ? <b style={{ left: `${Math.min(100, (mu / total) * 100)}%` }} /> : null}
    </div>
  )
}

const ICON = (d) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">{d.map((x, i) => <path key={i} d={x} />)}</svg>

// ─── 阅读器 ───
function Reader({ book, chapters, startChapter, startSheet, progress, onBack }) {
  const [ch, setCh] = useState(startChapter)
  const [chapter, setChapter] = useState(null)
  const [anns, setAnns] = useState([])
  const [loading, setLoading] = useState(true)
  const [ui, setUi] = useState(true)
  const [sheet, setSheet] = useState(startSheet) // 'contents' | { ann }
  const [sel, setSel] = useState(null) // 选中一段文字：{ top, left, para, quote }
  const [reply, setReply] = useState('')
  const [herCh, setHerCh] = useState(progress?.hua?.chapter || 0)
  const muCh = progress?.mu?.chapter || 0
  const bodyRef = useRef(null)
  const paraRef = useRef(0)
  const dirty = useRef(false)
  const scrolled = useRef(false)
  const total = chapters.length
  const idx = chapters.findIndex(c => c.chapter_number === ch)

  useEffect(() => {
    let alive = true
    setLoading(true); scrolled.current = false
    Promise.all([getJson(`/api/nook/books/${book.id}/chapters/${ch}`), getJson(`/api/nook/annotations/${book.id}/${ch}`)])
      .then(([c, a]) => { if (alive) { setChapter(c); setAnns(Array.isArray(a) ? a : []) } })
      .catch(() => {}).finally(() => { if (alive) setLoading(false) })
    // 沐第一次读到这一章时自己划几处线（后端只跑一次），跑完再拉一次划线
    apiFetch(`/api/nook/books/${book.id}/chapters/${ch}/ai-annotate`, { method: 'POST' }).then(r => r.json())
      .then(r => r && !r.skipped ? getJson(`/api/nook/annotations/${book.id}/${ch}`) : null)
      .then(a => { if (alive && Array.isArray(a)) setAnns(a) }).catch(() => {})
    return () => { alive = false }
  }, [book.id, ch])

  const paras = useMemo(() => chapter?.content ? chapter.content.split(/\n{2,}/).map(p => p.trim()).filter(Boolean) : [], [chapter])

  // 回到上次读到的那一段
  useEffect(() => {
    if (loading || !paras.length || scrolled.current) return
    scrolled.current = true
    const own = progress?.hua
    const start = own && own.chapter === ch ? own.paragraph || 0 : 0
    paraRef.current = start
    if (start) requestAnimationFrame(() => bodyRef.current?.querySelector(`[data-para="${start}"]`)?.scrollIntoView({ block: 'start' }))
    else bodyRef.current?.scrollTo(0, 0)
    if (ch > herCh) setHerCh(ch)
    dirty.current = true
  }, [loading, paras]) // eslint-disable-line react-hooks/exhaustive-deps

  const report = useCallback(() => {
    sendJson('POST', '/api/nook/progress', { book_id: book.id, who: ME, chapter: ch, paragraph: paraRef.current }).catch(() => {})
  }, [book.id, ch])
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current) { dirty.current = false; report() } }, 3000)
    return () => { clearInterval(t); if (dirty.current) { dirty.current = false; report() } }
  }, [report])
  const onScroll = () => {
    const box = bodyRef.current
    if (!box) return
    const top = box.getBoundingClientRect().top
    let cur = paraRef.current
    for (const p of box.querySelectorAll('[data-para]')) { if (p.getBoundingClientRect().top - top <= 120) cur = Number(p.dataset.para); else break }
    if (cur !== paraRef.current) { paraRef.current = cur; dirty.current = true }
  }

  // 选中文字后弹一个 Underline；碰到已经划过的线就不弹
  const onSelectEnd = () => {
    const s = window.getSelection()
    if (!s || s.isCollapsed || !s.rangeCount) return
    const text = s.toString().trim()
    if (!text) return
    const range = s.getRangeAt(0)
    let node = range.commonAncestorContainer
    if (node.nodeType !== 1) node = node.parentElement
    const p = node?.closest?.('[data-para]')
    if (!p || !bodyRef.current?.contains(p)) return
    for (const m of p.querySelectorAll('.v-ul')) if (range.intersectsNode(m)) return
    const r = range.getBoundingClientRect()
    setSel({ top: r.top, left: r.left + r.width / 2, para: Number(p.dataset.para), quote: text.slice(0, 60) })
  }
  useEffect(() => {
    const on = () => { const s = window.getSelection(); if (!s || s.isCollapsed) setSel(null) }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [])
  const underline = async () => {
    if (!sel) return
    try {
      const a = await sendJson('POST', '/api/nook/annotations', { book_id: book.id, chapter: ch, anchor_para: sel.para, anchor_quote: sel.quote, who: ME })
      if (a?.id) setAnns(prev => [...prev, { floors: [], ...a }])
    } catch {}
    setSel(null); window.getSelection()?.removeAllRanges()
  }

  // 同一段只显示最早的那条划线
  const byPara = useMemo(() => {
    const m = {}
    for (const a of anns) if (!m[a.anchor_para] || new Date(a.created_at) < new Date(m[a.anchor_para].created_at)) m[a.anchor_para] = a
    return m
  }, [anns])

  const thread = sheet && sheet.ann ? anns.find(a => a.id === sheet.ann) : null
  const sendReply = async () => {
    const text = reply.trim()
    if (!text || !thread) return
    try {
      const f = await sendJson('POST', `/api/nook/annotations/${thread.id}/floors`, { who: ME, text })
      if (f?.id) setAnns(prev => prev.map(a => a.id === thread.id ? { ...a, floors: [...(a.floors || []), f] } : a))
      setReply('')
    } catch {}
  }
  const removeUnderline = async () => {
    if (!thread) return
    const id = thread.id
    setSheet(null)
    try { await apiFetch(`/api/nook/annotations/${id}`, { method: 'DELETE' }); setAnns(prev => prev.filter(a => a.id !== id)) } catch {}
  }
  const go = (n) => { if (n !== ch && chapters.some(c => c.chapter_number === n)) { report(); setCh(n) } setSheet(null) }

  const muAhead = muCh - ch
  const groups = book.parts?.length
    ? book.parts.map((p, i) => ({ name: p.name, i, list: chapters.filter(c => p.chapters.includes(c.chapter_number)) }))
    : [{ name: '', i: 0, list: chapters }]

  return (
    <div className="v-reader">
      <div className={`v-reader-bar top ${ui ? '' : 'hide'}`}>
        <button className="v-rd-btn" onClick={onBack} aria-label="Back">{ICON(['M14.5 5.5 8 12l6.5 6.5'])}</button>
        <div className="v-reader-crumb">《{bare(book.title)}》 · {chapter?.title || `第${CN(ch)}章`}</div>
        <button className="v-rd-btn" onClick={() => setSheet('contents')} aria-label="Contents">{ICON(['M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'])}</button>
      </div>
      <div className="v-reader-body" ref={bodyRef} onScroll={onScroll} onClick={() => { if (!window.getSelection()?.toString()) setUi(u => !u) }} onMouseUp={onSelectEnd} onTouchEnd={onSelectEnd}>
        <div className="v-reader-page">
          <div className="v-rd-kicker">CHAPTER {ROMAN(ch)}</div>
          <div className="v-rd-title">{chapter?.title || `第${CN(ch)}章`}</div>
          <div className="v-rd-orn"><span /><i /><span /></div>
          {loading ? <div className="v-rd-hint">Loading…</div> : (
            <div className="v-rd-text">
              {paras.map((text, i) => {
                const a = byPara[i]
                const at = a ? text.indexOf(a.anchor_quote) : -1
                if (at < 0) return <p key={i} data-para={i}>{text}</p>
                return (
                  <p key={i} data-para={i}>
                    {text.slice(0, at)}
                    <span className={`v-ul ${a.who === 'mu' ? 'mu' : 'her'}`} onClick={e => { e.stopPropagation(); setSheet({ ann: a.id }) }}>
                      {text.slice(at, at + a.anchor_quote.length)}<sup>{(a.floors || []).length || ''}</sup>
                    </span>
                    {text.slice(at + a.anchor_quote.length)}
                  </p>
                )
              })}
            </div>
          )}
          {!loading && (
            <div className="v-rd-mu"><i />{muAhead > 0 ? `Soren read ${muAhead} chapter${muAhead > 1 ? 's' : ''} ahead — no spoilers.` : muAhead === 0 ? 'Soren is on this chapter too.' : muCh ? `Soren is back at chapter ${muCh}.` : "Soren hasn't started yet."}</div>
          )}
          <div className="v-rd-hint">Select a line to underline it · tap the page to hide the bars</div>
        </div>
      </div>
      <div className={`v-reader-bar bottom ${ui ? '' : 'hide'}`}>
        <button className="v-rd-btn" disabled={idx <= 0} onClick={() => idx > 0 && go(chapters[idx - 1].chapter_number)} aria-label="Previous chapter">{ICON(['M15 6l-6 6 6 6'])}</button>
        <div className="v-reader-pos">Ch. {idx + 1} of {total}</div>
        <button className="v-rd-btn" disabled={idx < 0 || idx >= total - 1} onClick={() => idx < total - 1 && go(chapters[idx + 1].chapter_number)} aria-label="Next chapter">{ICON(['M9 6l6 6-6 6'])}</button>
      </div>
      {sel && <button className="v-rd-select" style={{ top: sel.top, left: sel.left }} onClick={underline}>Underline</button>}
      {sheet && (
        <div className="v-rd-sheet-wrap" data-back onClick={() => setSheet(null)}>
          <div className="v-rd-sheet" onClick={e => e.stopPropagation()}>
            <div className="v-rd-grip" />
            <div className="v-rd-sheet-head">
              <span>{sheet === 'contents' ? `CONTENTS · ${total} CHAPTERS` : 'UNDERLINE'}</span>
              {thread && thread.who === ME && <button onClick={removeUnderline}>Remove</button>}
            </div>
            {sheet === 'contents' ? (
              <div className="v-rd-toc">
                <div className="v-rd-keys"><span><i className="her" />Me</span><span><i className="mu" />Soren</span></div>
                {groups.map(g => (
                  <div key={g.name || 'all'} className="v-rd-part">
                    {g.name && <div className="v-rd-part-name">PART {ROMAN(g.i + 1)} · {g.name}</div>}
                    {g.list.map(c => (
                      <div key={c.chapter_number} className={`v-rd-toc-row ${c.chapter_number === ch ? 'here' : ''} ${c.chapter_number <= herCh ? 'read' : ''}`} onClick={() => go(c.chapter_number)}>
                        <em>{ROMAN(c.chapter_number)}</em><span>{c.title || `第${CN(c.chapter_number)}章`}</span>
                        {c.chapter_number === muCh && <i className="mu" />}
                        {c.chapter_number === herCh && <i className="her" />}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : thread && (
              <div className="v-rd-thread">
                <div className="v-rd-quote">{thread.anchor_quote}</div>
                {(thread.floors || []).length === 0 && <div className="v-rd-none">No replies yet</div>}
                {(thread.floors || []).map(f => (
                  <div key={f.id} className="v-rd-floor">
                    <i className={f.who === 'mu' ? 'mu' : 'her'} />
                    <div><div className="v-rd-floor-top"><b>{f.who === 'mu' ? 'Soren' : 'Me'}</b><span>{fmtAt(f.created_at)}</span></div><p>{f.text}</p></div>
                  </div>
                ))}
                <div className="v-rd-reply">
                  <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendReply()} placeholder="Reply..." />
                  <button onClick={sendReply} aria-label="Send" className={reply.trim() ? 'on' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 书架 ───
export default function ReadingPage({ onBack, onImmersive }) {
  const [books, setBooks] = useState(null)
  const [info, setInfo] = useState({}) // id → { her, mu, total, chapters, progress }
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // { book, ch, sheet }
  const [last, setLast] = useState(() => { try { return localStorage.getItem(LAST_KEY) } catch { return null } })

  const loadInfo = useCallback(async (b) => {
    try {
      const [rows, ai, chs] = await Promise.all([getJson(`/api/nook/progress/${b.id}`), getJson(`/api/nook/books/${b.id}/ai-progress`).catch(() => null), getJson(`/api/nook/books/${b.id}/chapters`)])
      const p = {}
      for (const r of Array.isArray(rows) ? rows : []) p[r.who] = r
      if (ai?.chapter) p.mu = { chapter: ai.chapter }
      const list = Array.isArray(chs) ? chs : []
      const pos = (n) => n ? list.findIndex(c => c.chapter_number === n) + 1 : 0
      setInfo(prev => ({ ...prev, [b.id]: { her: pos(p.hua?.chapter), mu: pos(p.mu?.chapter), total: list.length, chapters: list, progress: p } }))
    } catch {}
  }, [])
  useEffect(() => {
    getJson('/api/nook/books').then(d => { const list = Array.isArray(d) ? d : []; setBooks(list); list.forEach(loadInfo) }).catch(() => setBooks([]))
  }, [loadInfo])
  // 和画布一样：书架和阅读器都铺满整屏，不露底部标签栏
  useEffect(() => { onImmersive?.(true); return () => onImmersive?.(false) }, [onImmersive])

  const openBook = (b, sheet) => {
    const i = info[b.id]
    if (!i) return
    try { localStorage.setItem(LAST_KEY, b.id) } catch {}
    setLast(b.id)
    setOpen({ book: b, ch: i.progress.hua?.chapter || i.chapters[0]?.chapter_number || 1, sheet: sheet || null })
  }
  const query = q.trim().toLowerCase()
  const shown = (books || []).filter(b => !query || `${b.title} ${b.author || ''} ${b.translator || ''} ${b.en_title || ''}`.toLowerCase().includes(query))
  const hero = !query && books?.length ? books.find(b => b.id === last) || books[0] : null
  const hi = hero && info[hero.id]

  if (open) {
    const i = info[open.book.id]
    return <Reader book={open.book} chapters={i.chapters} startChapter={open.ch} startSheet={open.sheet} progress={i.progress}
      onBack={() => { setOpen(null); loadInfo(open.book) }} />
  }

  return (
    <div className="v-shelf">
      <img src="/vesper/shelf-bg.webp" alt="" className="v-shelf-bg" />
      <div className="v-shelf-shade" />
      <div className="v-shelf-head">
        <button className="v-gchip" onClick={onBack} aria-label="Back">{ICON(['M14.5 5.5 8 12l6.5 6.5'])}</button>
        <div className="v-shelf-title">Reading</div>
        <button className={`v-gchip ${searchOpen ? 'on' : ''}`} onClick={() => { setSearchOpen(o => !o); setQ('') }} aria-label="Search">{ICON(['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M20 20l-4.8-4.8'])}</button>
      </div>
      <div className="v-shelf-scroll">
        <div className="v-shelf-body">
          {searchOpen && (
            <div className="v-gsearch">
              {ICON(['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M20 20l-4.8-4.8'])}
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Title or author" />
              {q && <button onClick={() => setQ('')} aria-label="Clear"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg></button>}
            </div>
          )}
          {hero && (
            <div className="v-hero">
              <div className="v-hero-cover" onClick={() => openBook(hero)}><Cover b={hero} w={84} /></div>
              <div className="v-hero-main">
                <div className="v-hero-kicker">LAST OPENED</div>
                <div className="v-hero-title">《{bare(hero.title)}》</div>
                <div className="v-hero-author">{hero.author}{hero.translator ? ` · ${hero.translator}` : ''}</div>
                <Progress her={hi?.her} mu={hi?.mu} total={hi?.total} />
                <div className="v-hero-who"><span>{hi?.her ? `Me · Ch. ${hi.her}` : 'Me · Not started'}</span><span>{hi?.mu ? `Soren · Ch. ${hi.mu}` : 'Soren · Not started'}</span></div>
                <div className="v-hero-btns">
                  <button className="main" onClick={() => openBook(hero)}>{hi?.her ? 'Continue' : 'Start'}</button>
                  <button onClick={() => openBook(hero, 'contents')}>Contents</button>
                </div>
              </div>
            </div>
          )}
          <div className="v-shelf-label"><span>{query ? 'RESULTS' : 'SHELF'}</span><em>{books ? `${shown.length} book${shown.length === 1 ? '' : 's'}` : 'Loading…'}</em></div>
          {books && (shown.length ? (
            <div className="v-shelf-grid">
              {shown.map(b => {
                const i = info[b.id]
                return (
                  <div key={b.id} className="v-shelf-book" onClick={() => openBook(b)}>
                    <Cover b={b} w={104} />
                    <div className="v-shelf-name">{bare(b.title)}</div>
                    {i && (i.her || i.mu) ? <Progress her={i.her} mu={i.mu} total={i.total} /> : <div className="v-shelf-none">Not started</div>}
                  </div>
                )
              })}
            </div>
          ) : <div className="v-shelf-empty">{query ? `No book matches "${q.trim()}"` : 'No books yet'}</div>)}
        </div>
      </div>
    </div>
  )
}
