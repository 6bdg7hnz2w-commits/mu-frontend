import { useEffect, useLayoutEffect, useRef } from 'react'

// ─── 消息列表贴底 ─────────────────────────────────
// 输入栏变高变矮（面板开合、键盘起落、草稿图那一排）时消息列表贴着底：最后一条跟着输入栏走，不跳
// 面板开合、草稿图那一排是渲染引起的：每次渲染完、画出来之前对一下；键盘起落不经过渲染，交给 ResizeObserver。
// 列表是后来才渲染出来的（先有加载中那一屏），换了元素就重新挂
// 停在底部时（stuck），列表里的内容变高也要贴住：网页字体晚到、图片晚到会把上面的消息撑高，
// Safari 不支持 overflow-anchor，scrollTop 不变，最后一条就被往下推、离底差一截（刚进聊天页常见）。所以每条消息也挂上 ResizeObserver
// detachedRef 为 true（在看搜出来的那一段）时不动。坑见 docs/skin-checklist.md 第 8 条
// 返回 stickBottom：点输入框、收起键盘时回到最底下（键盘起落要一会儿，高度变完再补两次）；kick 为 false（中文版 Clawd）时什么都不做
// 钉到底：先写一个差 1px 的值再写真正的底。列表变高（收键盘、关面板）时浏览器已经把 DOM 里的 scrollTop 夹到底了，
// 再写同一个值 iOS 当成没变、不重画，画面上最后一条停在原地（skin-checklist 第 8 条第 4 次）；先写个不同的值逼它真的滚一下
function pin(el) {
  const max = el.scrollHeight - el.clientHeight
  if (max > 0) el.scrollTop = max - 1
  el.scrollTop = el.scrollHeight
}

export function useStickToBottom(listRef, detachedRef, kick) {
  const anchorRef = useRef(null)
  useLayoutEffect(() => {
    const el = listRef.current
    if (anchorRef.current?.el !== el) {
      anchorRef.current?.ro?.disconnect()
      const o = anchorRef.current
      if (o?.el) {
        o.el.removeEventListener('scroll', o.onScroll)
        for (const t of ['touchstart', 'touchend', 'touchcancel']) o.el.removeEventListener(t, o.onTouch)
        clearTimeout(o.timer)
      }
      anchorRef.current = null
      if (!el) return
      const a = { el, h: el.clientHeight, stuck: true, seen: new WeakSet() }
      // 本来就在底部附近（80px 内）就钉到底。列表变高（收键盘、关面板）时不靠浏览器把 scrollTop 夹回去：
      // iOS 手指还按着（向下滑收键盘）或刚松手时，它不夹，当成"拉过头"留着、松手后慢慢弹回来，我们写的 scrollTop 也被它盖掉，
      // 最后一条停在原地、和输入栏之间空一大块（真机读数 listToBottom 到 −126，skin-checklist 第 8 条第 5 次）。
      // 所以变高多出来的那截先垫在列表顶上（padding-top），能滚的范围跟着变大，scrollTop 一直合法、不用动，最后一条自然跟着底边走；
      // 手松开、不滚了（settle）再把垫的拿掉、钉回底
      a.pad = 0
      a.setPad = (v) => {
        if (!a.pad) { el.style.paddingTop = ''; a.base = parseFloat(getComputedStyle(el).paddingTop) || 0 }
        a.pad = v
        el.style.paddingTop = v ? `${a.base + v}px` : ''
      }
      a.adjust = () => {
        if (detachedRef.current) return
        const d = a.h - el.clientHeight
        a.h = el.clientHeight
        let toBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        // 变矮（弹键盘、开面板）先把垫的退掉
        if (d > 0 && a.pad) { const t = Math.min(a.pad, d); a.setPad(a.pad - t); toBottom -= t }
        // 手指按着时只垫、不写 scrollTop：写了就和手指拖动抢，向下滑收键盘手没松开时画面一闪一闪（第 8 条第 6 次）。松手 settle 时再钉
        if (d) {
          if ((d > 0 ? toBottom - d : toBottom) < 80) {
            if (toBottom < 0) a.setPad(a.pad - toBottom)
            else if (a.touching) a.owed = true
            else pin(el)
          }
        }
        else if (a.stuck && toBottom > 0) { if (a.touching) a.owed = true; else pin(el) }
        a.settle()
      }
      a.touching = false
      a.settle = () => {
        clearTimeout(a.timer)
        if (a.pad || a.owed) a.timer = setTimeout(() => {
          if (a.touching) return
          a.owed = false
          const p = a.pad
          if (p) a.setPad(0)
          if (a.stuck) pin(el)
          else if (p) el.scrollTop -= p
        }, 350)
      }
      a.onTouch = (e) => { a.touching = e.type === 'touchstart'; a.settle() }
      el.addEventListener('touchstart', a.onTouch, { passive: true })
      el.addEventListener('touchend', a.onTouch, { passive: true })
      el.addEventListener('touchcancel', a.onTouch, { passive: true })
      // 手指滚开 80px 以上就不再贴底（在看历史），滚回底部附近又贴上
      a.onScroll = () => { a.stuck = el.scrollHeight - el.scrollTop - el.clientHeight < 80; a.settle() }
      el.addEventListener('scroll', a.onScroll, { passive: true })
      if (typeof ResizeObserver !== 'undefined') { a.ro = new ResizeObserver(a.adjust); a.ro.observe(el) }
      anchorRef.current = a
    }
    const a = anchorRef.current
    if (a.ro) for (const c of el.children) if (!a.seen.has(c)) { a.seen.add(c); a.ro.observe(c) }
    a.adjust()
  })
  useEffect(() => () => anchorRef.current?.ro?.disconnect(), [])
  return () => {
    if (!kick || detachedRef.current) return
    const go = () => { const el = listRef.current; if (el) pin(el) }
    go(); setTimeout(go, 120); setTimeout(go, 360)
  }
}
