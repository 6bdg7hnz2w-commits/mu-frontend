import { useEffect } from 'react'
import { kbNote } from './kbDebug.js'
import './viewport.css'

// ─── 视口：键盘、可见高度、状态栏底色 ─────────────────────
// 和皮肤无关的部分，哪个皮肤都能用（Vesper 先用；Clawd 暂时只用 useKeyboardOpen）。
// 外框要带 data-shell-frame：preventScroll、kbDebug 靠它认出外框。
// 写进外框的变量：--s-vh（看得见的高度）、--s-vtop、--s-full（整屏高度）、--s-kb（键盘高度）；html 上：--s-doc。
// 键盘起落的过渡节奏（data-kb-anim 时的 height transition）、面板开着不跟键盘缩，这些写在皮肤自己的 CSS 里。
// 坑都记在 docs/skin-checklist.md 第 1、2、2b、2c、4 条

// 键盘弹出时 iOS 不缩页面、而是把整页往上推，顶栏被推出屏幕、输入框和键盘之间空一截。
// 外框高度跟着可见区域走，再把页面滚回顶，输入框就贴着键盘
export function useVisibleHeight(ref) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    // 文档本身钉死不滚（viewport.css 的 html.v-lock）：iOS 弹键盘时会去滚整个文档露出输入框，
    // 再叠上我们按 visualViewport 改高度，就是顶栏先被挤到屏幕中间再回来、收起时列表先掉下去再弹回
    const root = document.documentElement
    root.classList.add('v-lock')
    const css = (k, v) => v == null ? ref.current?.style.removeProperty(k) : ref.current?.style.setProperty(k, v)
    // gap：没键盘时 html 比 visualViewport 高出的那截（主屏幕模式下是状态栏那么高，见 index.css）
    let gap = null, lastH = null, animT = 0
    const on = () => {
      // 文档被滚了就拉回去；visualViewport 自己在 layout viewport 里偏开了（offsetTop），外框往下挪同样多。
      // 和高度在同一个回调里一起改：外框永远正好盖住看得见的那块，顶栏、背景不动，不出空白帧
      if (window.scrollY || root.scrollTop) window.scrollTo(0, 0)
      css('--s-vtop', `${Math.max(0, Math.round(vv.offsetTop))}px`)
      // 拿 html 的高度比较有没有键盘：它不随键盘变（innerHeight 在有的 iOS 版本上会跟着变小，有的不会，不可靠）
      const full = root.getBoundingClientRect().height, h = vv.height
      css('--s-full', `${Math.round(full)}px`) // 整个屏幕的高度：聊天背景按它铺，不跟键盘、面板变
      root.style.setProperty('--s-doc', `${Math.round(full)}px`) // 钉死的 body 的高度（fixed 的 100% 是少算了状态栏的那个视口）
      if (h >= full - 150) gap = full - h
      const kb = full - (gap ?? 0) - h // 现在露出来的键盘有多高
      if (kb > 8 && h < full - 150) {
        // 键盘的高度留着（收起后也不清）：聊天的表情、加号面板照这个高度画，占键盘的位置，切换时输入框不动
        css('--s-kb', `${Math.round(full - h)}px`)
        try { localStorage.setItem('v_kb_h', String(Math.round(full - h))) } catch {}
      }
      // 没键盘时写成整屏的 px（不是删掉回到 100%）：键盘起落的过渡是 px 到 px，不跨单位
      const vh = Math.round(kb > 8 ? h : full)
      // 主屏幕模式下 iOS 不给键盘动画途中的值：聚焦后 70ms 左右 visualViewport 一下子跳到最终高度（真机读数，WebKit 265578）。
      // 照着跳，输入栏会比键盘先到。所以一下变了 150px 以上（键盘起落）就让外框高度用 CSS 过渡走过去，节奏照键盘
      // （皮肤 CSS 里的 [data-kb-anim]，Vesper 在 vesper.css）。表情、加号面板开着时不过渡：面板和键盘互换要在同一帧，输入框不动
      const panel = ref.current?.querySelector('.cc-attach-menu,.cc-emoji-panel') // 聊天的加号、表情面板（App.jsx 的 CCChatPage，两个皮肤共用）
      if (lastH != null && Math.abs(vh - lastH) > 150 && !panel) {
        ref.current?.setAttribute('data-kb-anim', '') // 不用 className：React 改 kb-open 时会把整串 className 覆盖掉
        clearTimeout(animT)
        animT = setTimeout(() => ref.current?.removeAttribute('data-kb-anim'), 600)
      }
      lastH = vh
      css('--s-vh', `${vh}px`)
    }
    // iOS 26：收起键盘后 visualViewport.offsetTop 有时回不到 0（外框跟着它整个往下偏）。社区的办法是等一下再上下推 1px 让它归位，
    // 见 Apple 论坛 thread 800125 / WebKit 254861。2026-10-24 真机（iOS 26.5.2）没遇到，推之前之后的值记进调试读数（kbDebug）
    const nudge = () => {
      if (vv.offsetTop < 1 || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return
      const before = Math.round(vv.offsetTop)
      window.scrollBy(0, -1); window.scrollBy(0, 1)
      on()
      kbNote(`nudge top ${before}→${Math.round(vv.offsetTop)}`)
    }
    const nudgeT = []
    const onBlur = (e) => {
      if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
      nudgeT.forEach(clearTimeout)
      nudgeT.splice(0, 2, setTimeout(nudge, 100), setTimeout(nudge, 600))
    }
    try { const kb = Number(localStorage.getItem('v_kb_h')); if (kb > 150) css('--s-kb', `${kb}px`) } catch {}
    on()
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    window.addEventListener('scroll', on)
    document.addEventListener('focusout', onBlur)
    return () => {
      clearTimeout(animT); nudgeT.forEach(clearTimeout)
      vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); window.removeEventListener('scroll', on)
      document.removeEventListener('focusout', onBlur)
      root.classList.remove('v-lock')
    }
  }, [ref])
}

// ─── Global focus-based keyboard/tab-bar visibility ──
export function useKeyboardOpen(setKeyboardOpen) {
  useEffect(() => {
    const isField = (el) => el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA'
    // 聚焦着的输入框整个被拿掉（查找页什么都没搜、键盘开着就按返回）：iOS Safari 不发 focusout，
    // kb-open、tab-hidden 会一直挂着。输入框聚焦期间盯着 DOM，它不在了就当键盘关了
    let field = null
    const mo = new MutationObserver(() => { if (field && !field.isConnected) { field = null; mo.disconnect(); setKeyboardOpen(false) } })
    const onFocusIn = (e) => {
      if (!isField(e.target)) return
      setKeyboardOpen(true)
      if (!field) mo.observe(document.body, { childList: true, subtree: true })
      field = e.target
    }
    // 从一个输入框点到另一个：先 focusout 再 focusin，键盘一直开着。50ms 后焦点已经在别的输入框上就不算关，
    // 不然 kb-open、tab-hidden 会闪一下，底部面板的留白跟着变，内容跳一下
    const onFocusOut = (e) => { if (isField(e.target)) setTimeout(() => { if (!isField(document.activeElement)) { field = null; mo.disconnect(); setKeyboardOpen(false) } }, 50) }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => { mo.disconnect(); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut) }
  }, [setKeyboardOpen])
}

// 输入框点开键盘后，把整张卡片（底边留 24px）滚到键盘上方：滚的是离它最近的那个能滚的父元素。
// 键盘升起要一会儿，跟着 visualViewport 的变化对齐，最多 1 秒；再补两次兜底
export function keepAboveKeyboard(card) {
  let page = card?.parentElement
  while (page && !/(auto|scroll)/.test(getComputedStyle(page).overflowY)) page = page.parentElement
  const vv = window.visualViewport
  if (!page || !vv) return
  const align = () => {
    const gap = card.getBoundingClientRect().bottom - (vv.offsetTop + vv.height - 24)
    if (Math.abs(gap) > 2) page.scrollTo({ top: page.scrollTop + gap, behavior: 'smooth' })
  }
  let t = 0
  const onVv = () => { clearTimeout(t); t = setTimeout(align, 60) }
  vv.addEventListener('resize', onVv)
  setTimeout(() => vv.removeEventListener('resize', onVv), 1000)
  setTimeout(align, 350); setTimeout(align, 700)
}

// 状态栏是透明的（index.html），页面画到最上面。html / body / theme-color 跟着页面走：
// 键盘上面那条工具栏是半透明的，透出来的就是 html 的底色，浅色页面得是浅的，深色页面才用深的。皮肤卸下时还原。
export function usePageChrome(color) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const prevMeta = meta?.content
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean)
    document.getElementById('vesper-top')?.remove() // index.html 开屏前垫的黑，React 接手后交给这里
    return () => {
      if (meta && prevMeta != null) meta.content = prevMeta
      els.forEach(el => { el.style.background = ''; el.style.colorScheme = '' })
    }
  }, [])
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = color
    // color-scheme 只放在皮肤自己的外框上（.vesper 按白天 / 夜间写），html、body 都是 light dark：
    // Safari 算 prefers-color-scheme 时会看文档这一层声明支持哪种，写成只支持 light（html 或 body）它就一直答"浅色"，
    // Vesper 选 System 时永远换不到深色（skin-checklist 第 21 条）。键盘、输入框在外框里面，照样跟页面
    ;[document.documentElement, document.body, document.getElementById('root')].filter(Boolean).forEach(el => { el.style.background = color; el.style.colorScheme = 'light dark' })
  }, [color])
}
