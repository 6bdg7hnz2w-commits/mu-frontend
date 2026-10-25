import { keyboardShown } from './viewport.js'
import { useEffect } from 'react'

// ─── 不让 iOS 去滚整个页面 ────────────────────────────
// 照 react-aria 的 usePreventScroll（preventScrollMobileWebKit）做，只拿和我们有关的三件事：
// https://github.com/adobe/react-spectrum/blob/main/packages/react-aria/src/overlays/usePreventScroll.ts
// 1. 所有元素 overscroll-behavior:contain：列表滚到头不把滚动传给页面。iOS 26 起要在 touchstart 之前就生效，所以是一条 <style>
// 2. touchmove 时手指下面没有能滚的东西（顶栏、输入栏、内容不够长的列表）就 preventDefault：页面根本不动，
//    不再是以前那样先被滚走、再 scrollTo(0,0) 拉回来（拉回来那一下就是跳）
// 3. 点输入框：自己 focus({ preventScroll })，iOS 不再滚页面去露输入框；代码里调的 focus() 也一律不滚页面
// 只在带 data-shell-frame 的外框里用（文档已经被 html.v-lock 钉死，见 viewport.js），Clawd 不变

const KEYBOARD_INPUT = /^(text|search|email|url|tel|number|password)$/

function opensKeyboard(el) {
  if (!el || el.disabled || el.readOnly) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return KEYBOARD_INPUT.test(el.type || 'text')
  return el.isContentEditable
}

function canScroll(el) {
  const s = getComputedStyle(el)
  return /(auto|scroll)/.test(s.overflowY + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
}

// 往上找到 fixed 的那层（弹窗、底部面板）就停：面板头上一拖，不能去滚面板底下那一页
function scrollParent(el) {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.nodeType !== 1) continue
    if (canScroll(n)) return n
    if (getComputedStyle(n).position === 'fixed') return null
  }
  return null
}

let users = 0, undo = null

function install() {
  const style = document.createElement('style')
  style.textContent = '@layer{*{overscroll-behavior:contain}}'
  document.head.prepend(style)

  let scroller = null, allow = false, start = null
  const onStart = (e) => {
    const t = e.target, p = e.touches[0]
    scroller = scrollParent(t)
    start = e.touches.length === 1 ? { x: p.clientX, y: p.clientY, moved: false } : null
    // 正在选字、拖选区的把手、在已经聚焦的输入框里挪光标：都放行
    const sel = window.getSelection()
    allow = (!!sel && !sel.isCollapsed && sel.containsNode(t, true)) || (t === document.activeElement && opensKeyboard(t))
  }
  const onMove = (e) => {
    const p = e.touches[0]
    if (start && p && Math.hypot(p.clientX - start.x, p.clientY - start.y) > 10) start.moved = true
    if (e.touches.length > 1 || allow) return // 两指缩放照常
    // 手指下面没有能滚的：拦住，页面不动。其它手势（侧滑返回、下拖收键盘）是自己听 touchmove 的，不受影响
    if (!scroller && e.cancelable) e.preventDefault()
  }
  const onEnd = (e) => {
    const t = e.target
    if (!start || start.moved || e.changedTouches.length !== 1) return
    if (!opensKeyboard(t)) return
    // 已经聚焦、键盘也在：照常（点哪光标到哪）。已经聚焦但键盘不在（回前台时 iOS 自己恢复的焦点）：
    // 系统不会再弹键盘，先 blur 再在这次点按里重新聚焦，光标放到最后接着打（skin-checklist 9c）
    if (document.activeElement === t) { if (keyboardShown()) return; t.blur() }
    e.preventDefault()
    t.focus({ preventScroll: true })
    if (typeof t.setSelectionRange === 'function' && t.type !== 'number' && t.type !== 'email') {
      const n = t.value.length
      try { t.setSelectionRange(n, n) } catch {}
    }
  }
  const o = { capture: true, passive: false }
  document.addEventListener('touchstart', onStart, o)
  document.addEventListener('touchmove', onMove, o)
  document.addEventListener('touchend', onEnd, o)

  const focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (opts) { return focus.call(this, { ...opts, preventScroll: true }) }

  return () => {
    style.remove()
    document.removeEventListener('touchstart', onStart, o)
    document.removeEventListener('touchmove', onMove, o)
    document.removeEventListener('touchend', onEnd, o)
    HTMLElement.prototype.focus = focus
  }
}

// ref 挂在页面根上：在 data-shell-frame 外框里才生效。几个页面同时用只装一次
export function usePreventPageScroll(ref) {
  useEffect(() => {
    if (!ref.current?.closest('[data-shell-frame]')) return
    if (users++ === 0) undo = install()
    return () => { if (--users === 0) { undo(); undo = null } }
  }, [ref])
}
