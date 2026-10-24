import { useEffect, useMemo, useRef, useState } from 'react'
import { I } from '../../App.jsx'
import { parseVoiceSegments, stripAudioTags } from './voice.jsx'

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
export function CopyButton({ getText, className = 'copy-btn', label }) {
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
export function messageCopyText(raw) {
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
export function MdBubble({ text, className = '' }) {
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
export function MdFlat({ text, className = '' }) {
  const blocks = useMemo(() => mdBlocks(text), [text])
  return <div className={`cc-md ${className}`}>{blocks.map(mdBlockEl)}</div>
}
