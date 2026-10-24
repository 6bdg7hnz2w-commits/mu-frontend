import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { I } from '../../App.jsx'
import { CcFileIcon, fmtFileSize } from './CcChat.jsx'

// 输入框上面待发的图和文件那一排：左右滑着看；长按一张（不动 300ms）拿起来，左右拖换位置，松手放下。
// 发送、存草稿都按这一排的顺序。拿起来以后挡住浏览器的横向滚动，别的几张让位时滑过去
const CC_LIFT_MS = 300
export function CcPendingRow({ items, onReorder, onOpen, onRemove }) {
  const rowRef = useRef(null)
  const els = useRef(new Map())
  const drag = useRef(null) // { key, id, x0, y0, timer, on, grab, x }
  const [dragKey, setDragKey] = useState(null)
  const before = useRef(null) // 换位置前各张的位置，换完从旧位置滑到新位置
  const follow = () => { // 被拖的那张跟着手指走（offsetLeft 不受 transform 影响，是它在排里的位置）
    const d = drag.current, row = rowRef.current, el = d && els.current.get(d.key)
    if (!d?.on || !row || !el) return
    const left = d.x - row.getBoundingClientRect().left + row.scrollLeft - d.grab
    el.style.transform = `translateX(${left - el.offsetLeft}px) scale(1.06)`
    return left + el.offsetWidth / 2
  }
  const move = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    if (!d.on) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) { clearTimeout(d.timer); drag.current = null } return }
    d.x = e.clientX
    const row = rowRef.current, r = row.getBoundingClientRect()
    if (e.clientX < r.left + 28) row.scrollLeft -= 8; else if (e.clientX > r.right - 28) row.scrollLeft += 8
    const mid = follow()
    const rest = items.filter(p => p.key !== d.key)
    const at = rest.filter(p => { const el = els.current.get(p.key); return el && el.offsetLeft + el.offsetWidth / 2 < mid }).length
    if (items[at]?.key !== d.key) {
      before.current = new Map([...els.current].map(([k, el]) => [k, el.offsetLeft]))
      const it = items.find(p => p.key === d.key)
      onReorder([...rest.slice(0, at), it, ...rest.slice(at)])
    }
  }
  const drop = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    clearTimeout(d.timer); drag.current = null
    if (!d.on) return
    const el = els.current.get(d.key)
    if (el) { el.style.transition = 'transform .18s ease'; el.style.transform = '' }
    setDragKey(null)
    drag.current = { dropped: true }; setTimeout(() => { if (drag.current?.dropped) drag.current = null }, 50) // 松手那下的 click 不当成点开大图
  }
  const down = (e) => {
    const item = e.target.closest('[data-pk]')
    if (!item || e.target.closest('button') || drag.current) return
    const key = item.dataset.pk, id = e.pointerId
    drag.current = { key, id, x0: e.clientX, y0: e.clientY, x: e.clientX }
    drag.current.timer = setTimeout(() => {
      const d = drag.current, row = rowRef.current, el = els.current.get(key)
      if (!d || d.key !== key || !row || !el) return
      d.on = true
      d.grab = d.x - row.getBoundingClientRect().left + row.scrollLeft - el.offsetLeft
      el.style.transition = 'none'
      try { row.setPointerCapture(id) } catch {}
      navigator.vibrate?.(10)
      setDragKey(key); follow()
    }, CC_LIFT_MS)
  }
  // 拿起来以后手指再动，iOS 会当成横向滚动接走（随后 pointercancel）；touchmove 要非被动监听才拦得住
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const stop = (e) => { if (drag.current?.on) e.preventDefault() }
    row.addEventListener('touchmove', stop, { passive: false })
    return () => row.removeEventListener('touchmove', stop)
  }, [])
  useLayoutEffect(() => {
    const old = before.current
    before.current = null
    if (old) els.current.forEach((el, k) => {
      if (k === drag.current?.key || !old.has(k) || old.get(k) === el.offsetLeft) return
      el.style.transition = 'none'
      el.style.transform = `translateX(${old.get(k) - el.offsetLeft}px)`
      void el.offsetWidth
      el.style.transition = 'transform .2s ease'
      el.style.transform = ''
    })
    follow()
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (key) => (el) => { if (el) els.current.set(key, el); else els.current.delete(key) }
  return (
    <div className="cc-pending" ref={rowRef} onPointerDown={down} onPointerMove={move} onPointerUp={drop} onPointerCancel={drop}
      onClickCapture={e => { if (drag.current?.dropped) { e.stopPropagation(); e.preventDefault() } }} onContextMenu={e => e.preventDefault()}>
      {items.map(p => p.kind === 'file' ? (
        <div key={p.key} ref={keep(p.key)} data-pk={p.key} className={`composer-image-preview cc-pending-file${dragKey === p.key ? ' dragging' : ''}`} title={p.file.name}>
          <CcFileIcon name={p.file.name} />
          <span className="cc-file-info">
            <span className="cc-file-name">{p.file.name}</span>
            <span className="cc-file-size">{fmtFileSize(p.file.size)}</span>
          </span>
          <button onClick={() => onRemove(p.key)} aria-label="Remove file">{I.close}</button>
        </div>
      ) : (
        <div key={p.key} ref={keep(p.key)} data-pk={p.key} className={`composer-image-preview${dragKey === p.key ? ' dragging' : ''}`}>
          <img src={p.previewUrl} alt="" draggable={false} data-lb={p.previewUrl} onClick={() => onOpen(p)} />
          <button onClick={() => onRemove(p.key)} aria-label="Remove image">{I.close}</button>
        </div>
      ))}
    </div>
  )
}
