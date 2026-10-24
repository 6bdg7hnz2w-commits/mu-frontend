import { useEffect, useLayoutEffect, useRef } from 'react'

// ─── 消息列表贴底 ─────────────────────────────────
// 输入栏变高变矮（面板开合、键盘起落、草稿图那一排）时消息列表贴着底：最后一条跟着输入栏走，不跳
// 面板开合、草稿图那一排是渲染引起的：每次渲染完、画出来之前对一下；键盘起落不经过渲染，交给 ResizeObserver。
// 列表是后来才渲染出来的（先有加载中那一屏），换了元素就重新挂
// 停在底部时（stuck），列表里的内容变高也要贴住：网页字体晚到、图片晚到会把上面的消息撑高，
// Safari 不支持 overflow-anchor，scrollTop 不变，最后一条就被往下推、离底差一截（刚进聊天页常见）。所以每条消息也挂上 ResizeObserver
// detachedRef 为 true（在看搜出来的那一段）时不动。坑见 docs/skin-checklist.md 第 8 条
// 返回 stickBottom：点输入框、收起键盘时回到最底下（键盘起落要一会儿，高度变完再补两次）；kick 为 false（中文版 Clawd）时什么都不做
export function useStickToBottom(listRef, detachedRef, kick) {
  const anchorRef = useRef(null)
  useLayoutEffect(() => {
    const el = listRef.current
    if (anchorRef.current?.el !== el) {
      anchorRef.current?.ro?.disconnect()
      anchorRef.current?.el?.removeEventListener('scroll', anchorRef.current.onScroll)
      anchorRef.current = null
      if (!el) return
      const a = { el, h: el.clientHeight, stuck: true, seen: new WeakSet() }
      // 本来就在底部附近（80px 内）就直接钉到真正的底，不按差值去补：列表变高时（收键盘）浏览器自己已经把 scrollTop 夹到底了，
      // 再 += d 就多退一截，收完键盘最后一条离输入栏远出一块（skin-checklist 第 8 条）
      a.adjust = () => {
        if (detachedRef.current) return
        const d = a.h - el.clientHeight
        a.h = el.clientHeight
        const toBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        if (d) { if ((d > 0 ? toBottom - d : toBottom) < 80) el.scrollTop = el.scrollHeight }
        else if (a.stuck && toBottom > 0) el.scrollTop = el.scrollHeight
      }
      // 手指滚开 80px 以上就不再贴底（在看历史），滚回底部附近又贴上
      a.onScroll = () => { a.stuck = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
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
    const go = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }
    go(); setTimeout(go, 120); setTimeout(go, 360)
  }
}
