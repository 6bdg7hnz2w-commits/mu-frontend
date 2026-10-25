import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { I } from '../App.jsx'
import { ccImageCache, ccReduceMotion, fetchCcImage, useCcSay } from './chat/CcChat.jsx'
import { overridePageChrome } from './viewport.js'
import './lightbox.css'

// ─── ImageLightbox：点开的大图 ─────────────────────
// 和皮肤无关：手势、放大缩小、FLIP 动画、分享都在这里；样式在 lightbox.css（黑底全屏，两个皮肤一样）。
// 取图走聊天的缓存（chat/CcChat.jsx 的 ccImageCache / fetchCcImage），循环 import，只在函数里用，模块顶层不碰
// 点开的大图：右上角三个点 → 苹果原生分享面板（里面有"存储图像"），原图原画质
// 分享必须在点击的那一下同步调用（iOS 会拦掉异步之后的调用），所以一打开就先把图读成 File
const LIGHTBOX_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' }
// 一组图左右滑着看（聊天里她发过的所有图、草稿里待发的图），从点开的那张开始；横向 scroll-snap，手指滑就是系统原生的手感
// items：[{ path?, localUrl?, lb? }]。path 是 bridge 上的图：先用缩略图垫着，滑到附近了再取原图（分享的也是原图）。
// lb 是聊天里那张缩略图的 data-lb：打开时图从缩略图的位置和大小放大到全屏（FLIP），关的时候缩回去；找不到就原地淡入淡出。
// 手势照微信：单击关（等 250ms 确认不是双击）、按住往下拖跟手缩小、背景变淡，拖够远松手就关；双指捏合缩放，
// 双击在点的位置放大到 2 倍、再双击还原；放大以后单指拖着看，这时不左右翻页、往下拖也不关。
// 分享面板开着（以及刚收起的一下）点屏幕只收面板，不关图（skin-checklist 18）
const LB_MS = 300
const LB_EASE = 'cubic-bezier(.2,.8,.2,1)'
const lbThumb = (key) => { try { return key ? document.querySelector(`[data-lb="${CSS.escape(key)}"]`) : null } catch { return null } }
// 图在屏幕上按 contain 放下时的大小（不放大小于屏幕的缩略图也照原图比例铺满）
const lbFit = (w, h) => { const W = window.innerWidth, H = window.innerHeight, k = Math.min(W / w, H / h); return [w * k, h * k] }
// 从缩略图（rect，裁成方块的）到全屏那张图（box，没有 transform 时的位置）的变换：等比放到能盖住缩略图，再裁掉多出来的
function lbFrom(rect, box, radius = 12) {
  const s = Math.max(rect.width / box.width, rect.height / box.height)
  const dx = rect.left + rect.width / 2 - (box.left + box.width / 2), dy = rect.top + rect.height / 2 - (box.top + box.height / 2)
  const ix = (box.width - rect.width / s) / 2, iy = (box.height - rect.height / s) / 2
  return { transform: `translate(${dx}px,${dy}px) scale(${s})`, clipPath: `inset(${iy}px ${ix}px round ${radius / s}px)` }
}
export function ImageLightbox({ items, index = 0, onClose }) {
  const say = useCcSay()
  const [at, setAt] = useState(index)
  const atRef = useRef(index)
  const [files, setFiles] = useState({}) // 第几张 → 读好的 File（分享要在点的那一下同步调用）
  const [zoomed, setZoomed] = useState(false)
  const track = useRef(null), overlay = useRef(null), bg = useRef(null)
  const imgs = useRef(new Map()) // 第几张 → 它的 <img>
  const z = useRef({ s: 1, x: 0, y: 0 }) // 当前这张的缩放和位移
  const g = useRef({ pts: new Map() }) // 手势
  const closing = useRef(false)
  useLayoutEffect(() => { const el = track.current; if (el) el.scrollLeft = index * el.clientWidth }, [index])
  const onScroll = (e) => {
    const el = e.currentTarget, i = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))
    if (i !== atRef.current) { reset(false); atRef.current = i; setAt(i) }
  }
  const onFile = useCallback((i, f) => setFiles(prev => ({ ...prev, [i]: f })), [])
  const file = files[at]
  const sheet = useRef({ open: false, at: 0 }) // 分享面板开着 / 什么时候收起的
  const share = (e) => {
    e.stopPropagation()
    sheet.current.open = true
    navigator.share({ files: [file] }).catch(() => {}) // 她在面板里取消也会走到 catch，不用提示
      .finally(() => { sheet.current = { open: false, at: Date.now() } })
  }
  const sheetBusy = () => sheet.current.open || Date.now() - sheet.current.at < 600
  const cur = () => imgs.current.get(atRef.current)
  const setBg = (o, ms = 0) => { const el = bg.current; if (!el) return; el.style.transition = ms ? `opacity ${ms}ms ease-out` : 'none'; el.style.opacity = String(o) }
  const apply = (ms = 0) => {
    const el = cur(); if (!el) return
    const { s, x, y } = z.current
    el.style.transition = ms ? `transform ${ms}ms ${LB_EASE}` : 'none'
    el.style.transform = s === 1 && !x && !y ? '' : `translate(${x}px,${y}px) scale(${s})`
  }
  const reset = (anim = true) => { z.current = { s: 1, x: 0, y: 0 }; apply(anim ? 220 : 0); setZoomed(false) }
  // 放大以后别拖出图外太多：每边最多拖到图的边贴着屏幕边
  const clampPan = () => {
    const el = cur(); if (!el) return
    const { s } = z.current, W = window.innerWidth, H = window.innerHeight
    const mx = Math.max(0, (el.offsetWidth * s - W) / 2), my = Math.max(0, (el.offsetHeight * s - H) / 2)
    z.current.x = Math.min(mx, Math.max(-mx, z.current.x)); z.current.y = Math.min(my, Math.max(-my, z.current.y))
  }
  // 屏幕上的点 p 换成图上的点（以图的中心为原点、未缩放），缩放到 s 以后让它还在 p 下面
  const zoomAt = (p, s, base = z.current, c0 = p) => {
    const el = cur(); if (!el) return
    const r = el.parentElement.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const lx = (c0.x - cx - base.x) / base.s, ly = (c0.y - cy - base.y) / base.s
    z.current = { s, x: p.x - cx - s * lx, y: p.y - cy - s * ly }
  }

  // 打开：第一张图有了尺寸就从缩略图放大过来，背景同时从透明变黑
  const opened = useRef(false)
  const open = useCallback((el) => {
    if (opened.current || !el) return
    opened.current = true
    const th = lbThumb(items[index]?.lb), rect = th?.getBoundingClientRect()
    setBg(1, LB_MS)
    if (!rect?.width || ccReduceMotion()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }); return }
    const from = lbFrom(rect, el.getBoundingClientRect(), parseFloat(getComputedStyle(th).borderTopLeftRadius) || 12)
    el.animate([{ ...from, opacity: 1 }, { transform: 'none', clipPath: 'inset(0px 0px round 0px)', opacity: 1 }], { duration: LB_MS, easing: LB_EASE })
  }, [items, index])
  // 关：缩回聊天里那张缩略图的位置（不在屏幕上就原地缩小淡出），背景跟着变透明
  const close = () => {
    if (closing.current) return
    closing.current = true
    chrome.current?.() // html 底色先换回聊天的，顶边效果跟着背景一起淡回去
    const el = cur()
    if (!el) { onClose(); return }
    const now = getComputedStyle(el).transform
    el.style.transition = 'none'; el.style.transform = ''
    const box = el.getBoundingClientRect()
    const th = lbThumb(items[atRef.current]?.lb), rect = th?.getBoundingClientRect()
    const seen = rect?.width && rect.bottom > 0 && rect.top < window.innerHeight
    setBg(0, LB_MS)
    overlay.current?.classList.add('closing')
    const to = seen && !ccReduceMotion() ? lbFrom(rect, box, parseFloat(getComputedStyle(th).borderTopLeftRadius) || 12) : { transform: `${now === 'none' ? '' : now} scale(.9)`, opacity: 0 }
    const a = el.animate([{ transform: now, clipPath: 'inset(0px 0px round 0px)', opacity: 1 }, { opacity: 1, ...to }], { duration: LB_MS, easing: LB_EASE, fill: 'forwards' })
    let done = false
    const end = () => { if (!done) { done = true; onClose() } }
    a.onfinish = a.oncancel = end
    setTimeout(end, LB_MS + 250) // 动画事件没来（切到后台之类）也一定关掉
  }

  // 开着的时候 html / body 换成查看器的黑（theme-color 不管，iOS 不看它）：iOS 27 系统顶边效果取 html 的底色，不换顶上会是聊天壁纸色。
  // 交给 usePageChrome 记着（overridePageChrome），切 app 回来页面重刷颜色也还是黑（skin-checklist 18）。#root 不动（键盘工具栏，第 6 条）
  const chrome = useRef(null)
  useLayoutEffect(() => {
    overridePageChrome('#000')
    let done = false
    chrome.current = () => { if (!done) { done = true; overridePageChrome(null) } }
    return () => chrome.current()
  }, [])
  // 顶上两颗玻璃按钮用皮肤自己顶栏胶囊的材质：查看器挂在 body 上拿不到 .vesper 的变量，打开时抄过来
  useLayoutEffect(() => {
    const sk = document.querySelector('.vesper'), el = overlay.current
    if (!sk || !el) return
    const cs = getComputedStyle(sk)
    for (const k of ['--v-tabbar', '--v-tbLine', '--v-tbHi', '--v-ink']) { const v = cs.getPropertyValue(k).trim(); if (v) el.style.setProperty(k, v) }
  }, [])

  const tapTimer = useRef(0), lastTap = useRef(null)
  const down = (e) => {
    if (e.target.closest('button') || closing.current) return
    const st = g.current
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (st.pts.size === 1) Object.assign(st, { mode: null, p0: { x: e.clientX, y: e.clientY }, t0: Date.now(), base: { ...z.current }, moved: false, sheet: sheetBusy() })
  }
  const move = (e) => {
    const st = g.current
    if (!st.pts.has(e.pointerId) || closing.current) return
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (st.mode === 'pinch' || st.mode === 'after') return // 捏合走下面的 touch 事件
    const dx = e.clientX - st.p0.x, dy = e.clientY - st.p0.y
    if (!st.moved && Math.hypot(dx, dy) > 8) st.moved = true
    if (!st.moved) return
    if (st.base.s > 1) { // 放大了：拖着看
      st.mode = 'pan'
      z.current = { s: st.base.s, x: st.base.x + dx, y: st.base.y + dy }
      apply(); return
    }
    if (!st.mode) st.mode = dy > 0 && Math.abs(dy) > Math.abs(dx) ? 'drag' : 'none'
    if (st.mode !== 'drag') return
    // 往下拖：跟着手指走，越往下越小，背景越淡
    const H = window.innerHeight, k = Math.max(0, dy) / H
    z.current = { s: Math.max(0.45, 1 - k * 0.9), x: dx, y: dy }
    apply(); setBg(Math.max(0, 1 - k * 2.2))
  }
  const up = (e) => {
    const st = g.current
    if (!st.pts.has(e.pointerId)) return
    st.pts.delete(e.pointerId)
    if (st.mode === 'pinch' || st.mode === 'after') { if (!st.pts.size && st.mode === 'after') st.mode = null; return }
    if (st.mode === 'pan') { clampPan(); apply(220); return }
    if (st.mode === 'drag') {
      const dy = e.clientY - st.p0.y, fast = dy > 40 && dy / Math.max(1, Date.now() - st.t0) > 0.6
      if (dy > 110 || fast) close()
      else { reset(); setBg(1, 220) }
      return
    }
    if (st.moved || e.type === 'pointercancel' || Date.now() - st.t0 > 300) return
    if (st.sheet || sheetBusy()) return // 这一下是收分享面板的
    // 点了一下：250ms 里又点一下是双击（在点的位置放大到 2 倍 / 还原），不然就是单击，关
    const p = { x: e.clientX, y: e.clientY }, last = lastTap.current
    if (last && Date.now() - last.t < 250 && Math.hypot(p.x - last.x, p.y - last.y) < 30) {
      clearTimeout(tapTimer.current); lastTap.current = null
      if (z.current.s > 1) reset()
      else { zoomAt(p, 2, { s: 1, x: 0, y: 0 }); clampPan(); apply(260); setZoomed(true) }
      return
    }
    lastTap.current = { ...p, t: Date.now() }
    clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => { lastTap.current = null; close() }, 250)
  }
  useEffect(() => () => clearTimeout(tapTimer.current), [])
  // iOS 不认 user-scalable=no：双指的时候、放大以后自己拦住浏览器的缩放和滚动，手势全归这里
  useEffect(() => {
    const el = overlay.current
    if (!el) return
    // 捏合用 touch 事件算，不用 pointer：没放大时 track 能横着滚，两根手指一动 iOS 就当成翻页，给 pointer 发 pointercancel，捏合就断了（skin-checklist 18）
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1
    const tStart = (e) => {
      if (e.touches.length !== 2 || closing.current) return
      const st = g.current
      clearTimeout(tapTimer.current); lastTap.current = null
      if (st.mode === 'drag') { reset(false); setBg(1) }
      Object.assign(st, { mode: 'pinch', d0: dist(e.touches), c0: mid(e.touches), base: { ...z.current }, moved: true, sl: track.current?.scrollLeft })
    }
    const stop = (e) => {
      const st = g.current
      if (st.mode === 'pinch' && e.touches.length >= 2) {
        e.preventDefault()
        if (track.current && st.sl != null) track.current.scrollLeft = st.sl // 已经被带着滑了一点就拉回来
        const s = Math.min(5, Math.max(0.5, st.base.s * dist(e.touches) / st.d0)) // 捏的时候能缩到 1 倍以下，松手弹回
        zoomAt(mid(e.touches), s, st.base, st.c0)
        apply(); return
      }
      if (e.touches?.length > 1 || z.current.s !== 1 || st.mode === 'drag') e.preventDefault()
    }
    const tEnd = (e) => {
      const st = g.current
      if (st.mode !== 'pinch' || e.touches.length >= 2) return
      if (z.current.s <= 1.02) reset()
      else { if (z.current.s > 4) zoomAt(st.c0, 4); clampPan(); apply(220); setZoomed(true) }
      st.mode = e.touches.length ? 'after' : null // 还剩一根手指：抬起来之前不拖、不关
      if (!e.touches.length) st.pts.clear()
    }
    const noGesture = (e) => e.preventDefault()
    el.addEventListener('touchstart', tStart, { passive: true })
    el.addEventListener('touchmove', stop, { passive: false })
    el.addEventListener('touchend', tEnd); el.addEventListener('touchcancel', tEnd)
    el.addEventListener('gesturestart', noGesture)
    el.addEventListener('gesturechange', noGesture)
    return () => {
      el.removeEventListener('touchstart', tStart); el.removeEventListener('touchmove', stop)
      el.removeEventListener('touchend', tEnd); el.removeEventListener('touchcancel', tEnd)
      el.removeEventListener('gesturestart', noGesture); el.removeEventListener('gesturechange', noGesture)
    }
  }, [])
  // 图一直没出来（取不到）：背景也照样变黑，不卡在透明
  useEffect(() => { const t = setTimeout(() => { if (!opened.current) setBg(1, 200) }, 600); return () => clearTimeout(t) }, [])

  // 挂到 body 上：Vesper 的聊天在自己的层里，不挂出去会被底下的 tab 栏压住
  return createPortal(
    <div className={`image-lightbox-overlay${zoomed ? ' zoomed' : ''}`} ref={overlay}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="image-lightbox-bg" ref={bg} />
      <button className="icon-btn image-lightbox-glass image-lightbox-back" onClick={(e) => { e.stopPropagation(); close() }} aria-label={say('返回', 'Back')}>{I.back}</button>
      {file && <button className="icon-btn image-lightbox-glass image-lightbox-more" onClick={share} aria-label={say('分享或存储图像', 'Share or save image')}>{I.more}</button>}
      <div className="image-lightbox-track" ref={track} onScroll={onScroll}>
        {items.map((img, i) => <LightboxSlide key={img.path || img.localUrl || i} img={img} near={Math.abs(i - at) <= 1}
          onFile={f => onFile(i, f)} imgRef={el => { if (el) imgs.current.set(i, el); else imgs.current.delete(i) }}
          onReady={i === index ? open : undefined} />)}
      </div>
      {items.length > 1 && <div className="image-lightbox-count">{at + 1} / {items.length}</div>}
    </div>,
    document.body,
  )
}
// 一张：先用已经有的缩略图（和聊天里那张同一个地址，不会空白），原图到了直接换掉，尺寸按原图比例铺满屏幕、不跳
function LightboxSlide({ img, near, onFile, imgRef, onReady }) {
  const [shown, setShown] = useState(img.localUrl || (img.path && (ccImageCache.get(img.path) || ccImageCache.get(`${img.path}#thumb`))) || null)
  const [full, setFull] = useState(!img.path || !!ccImageCache.get(img.path))
  const [size, setSize] = useState(null)
  useEffect(() => {
    if (full || !near) return
    let alive = true
    fetchCcImage(img.path).then(u => { if (alive) { setShown(u); setFull(true) } }).catch(() => { if (alive) setFull(true) })
    return () => { alive = false }
  }, [img.path, near, full])
  const fileRef = useRef(onFile)
  useEffect(() => { fileRef.current = onFile })
  useEffect(() => {
    if (!full || !shown) return
    let alive = true
    fetch(shown).then(r => r.blob()).then(b => {
      const f = new File([b], `mu-${Date.now()}.${LIGHTBOX_EXT[b.type] || 'jpg'}`, { type: b.type || 'image/jpeg' })
      if (alive && navigator.canShare?.({ files: [f] })) fileRef.current(f)
    }).catch(() => {})
    return () => { alive = false }
  }, [shown, full])
  const el = useRef(null)
  const onLoad = (e) => { const t = e.currentTarget; if (!size && t.naturalWidth) setSize(lbFit(t.naturalWidth, t.naturalHeight)) }
  useLayoutEffect(() => { if (size && onReady) onReady(el.current) }, [size, onReady])
  return (
    <div className="image-lightbox-slide">
      {shown && <img ref={n => { el.current = n; imgRef(n) }} src={shown} alt="" draggable={false} onLoad={onLoad}
        style={size ? { width: size[0], height: size[1] } : { opacity: 0 }} />}
    </div>
  )
}
