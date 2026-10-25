import { useEffect } from 'react'
import { kbNote, kbLog } from './kbDebug.js'
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
    let gap = null, lastH = null, animT = 0, stale = false
    const on = () => {
      // 文档被滚了就拉回去；visualViewport 自己在 layout viewport 里偏开了（offsetTop），外框往下挪同样多。
      // 和高度在同一个回调里一起改：外框永远正好盖住看得见的那块，顶栏、背景不动，不出空白帧
      if (window.scrollY || root.scrollTop) window.scrollTo(0, 0)
      css('--s-vtop', `${Math.max(0, Math.round(vv.offsetTop))}px`)
      // 拿 html 的高度比较有没有键盘：它不随键盘变（innerHeight 在有的 iOS 版本上会跟着变小，有的不会，不可靠）
      const full = root.getBoundingClientRect().height
      let h = vv.height
      // 切过后台：回来时 iOS 的 visualViewport 有时还报着有键盘时的高度（真机 iOS 27：vv 431 / html 852，键盘早没了、焦点在 body），
      // 照它排输入栏、tab 栏就停在半屏。键盘只会在输入框聚焦时出现，所以这时没有输入框聚焦就不信它，按整屏排；
      // 等它自己报回整屏、或者又点了输入框，再照常（skin-checklist 9c）
      if (stale) {
        if (h >= full - 150 || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) stale = false
        else h = full - (gap ?? 0)
      }
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
    // 切后台时键盘被收掉（useKeyboardOpen 那边会 blur 输入框），这次 visualViewport 的 resize 在后台发不到，
    // 回来时高度还是有键盘时的，输入栏、tab 栏停在半屏，底下空一大块。回到前台重量一次，再补两次兜底（skin-checklist 9c）
    const visT = []
    const onVisible = () => {
      if (document.visibilityState === 'hidden') { stale = true; return }
      visT.forEach(clearTimeout)
      on(); visT.splice(0, 2, setTimeout(on, 150), setTimeout(on, 500))
    }
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    window.addEventListener('scroll', on)
    document.addEventListener('focusout', onBlur)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      clearTimeout(animT); nudgeT.forEach(clearTimeout); visT.forEach(clearTimeout)
      vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); window.removeEventListener('scroll', on)
      document.removeEventListener('focusout', onBlur)
      document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pageshow', onVisible)
      root.classList.remove('v-lock')
    }
  }, [ref])
}

// ─── Global focus-based keyboard/tab-bar visibility ──
// 这次聚焦以后键盘真的升起来过没有（visualViewport 变矮过）。回前台时 iOS 会自己把焦点还给输入框、不弹键盘，
// 光标还放在最前面；这时 activeElement 是输入框，但键盘不在。preventScroll.js 的点按据此决定要不要重新聚焦（skin-checklist 9c）
let kbSeen = false
export const keyboardShown = () => kbSeen

export function useKeyboardOpen(setKeyboardOpen) {
  useEffect(() => {
    const isField = (el) => el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA'
    // 聚焦着的输入框整个被拿掉（查找页什么都没搜、键盘开着就按返回）：iOS Safari 不发 focusout，
    // kb-open、tab-hidden 会一直挂着。输入框聚焦期间盯着 DOM，它不在了就当键盘关了
    let field = null, dogT = 0, bgStale = false
    const mo = new MutationObserver(() => { if (field && !field.isConnected) { field = null; mo.disconnect(); setKeyboardOpen(false) } })
    const onFocusIn = (e) => {
      if (!isField(e.target)) return
      setKeyboardOpen(true)
      if (!field) mo.observe(document.body, { childList: true, subtree: true })
      field = e.target
      // 从一个输入框点到另一个：键盘一直在、visualViewport 不再变，聚焦这一刻就看它在不在。
      // 刚回前台它还报着旧的键盘高度，等它真的 resize 过一次（bgStale 清掉）再信
      kbSeen = !bgStale && !!vv && vv.height < document.documentElement.getBoundingClientRect().height - 150
      // 看门狗：iOS 会自己把焦点还给输入框却不弹键盘（回前台、IME 拼音没选字就点 ✓、点空白处收键盘之后），
      // kb-open、tab-hidden 挂着，再点输入框也不弹。聚焦后 0.7s 键盘还没升起来过，就当没聚焦：blur 掉、tab 回来。
      // 正常点输入框键盘 0.3s 内就上来了（真机读数），不受影响；电脑上没有屏幕键盘，不看（skin-checklist 9c）
      clearTimeout(dogT)
      if (navigator.maxTouchPoints > 0) dogT = setTimeout(() => {
        if (field !== e.target || kbSeen) return
        // 刚回前台 visualViewport 可能还报着旧的键盘高度，真键盘升起来要是正好一样高就不会再 resize：这时看不出来，不动手
        if (bgStale && vv && vv.height < document.documentElement.getBoundingClientRect().height - 150) { kbLog('focus, vv stale, skip'); return }
        kbLog('focus without keyboard → blur'); unstick()
      }, 700)
    }
    // 键盘被收了但输入框还聚焦着（下滑收键盘、切后台），iOS 不发 focusout，kb-open、tab-hidden 一直挂着。
    // 所以还要看键盘真的在不在：聚焦后量到过键盘（visualViewport 比 html 矮 150 以上），后来又没了，就当关了，
    // 顺手 blur，再点输入框会重新 focusin、弹键盘（skin-checklist 第 9c 条）
    const vv = window.visualViewport
    const onVv = () => {
      bgStale = false
      if (!field) return
      const up = vv.height < document.documentElement.getBoundingClientRect().height - 150
      if (up) { kbSeen = true; return }
      if (!kbSeen) return
      const el = field
      field = null; kbSeen = false; mo.disconnect(); setKeyboardOpen(false)
      kbLog('kb gone while focused → blur')
      if (document.activeElement === el) el.blur()
    }
    // 从一个输入框点到另一个：先 focusout 再 focusin，键盘一直开着。50ms 后焦点已经在别的输入框上就不算关，
    // 不然 kb-open、tab-hidden 会闪一下，底部面板的留白跟着变，内容跳一下
    const onFocusOut = (e) => { if (isField(e.target)) setTimeout(() => { if (!isField(document.activeElement)) { field = null; kbSeen = false; mo.disconnect(); setKeyboardOpen(false) } }, 50) }
    // 键盘开着切到后台：系统把键盘收了，回来时输入框还是 activeElement、不发 focusout，kb-open、tab-hidden 一直挂着（聊天页 tab 栏没了）。
    // 切走时就把输入框 blur 掉、当键盘关了；回来时焦点不在输入框上，也就不会再被当成键盘开着（见 docs/skin-checklist.md 第 9c 条）
    // 回到前台时 iOS 有时自己把焦点还给输入框，但不弹键盘（真机 iOS 27）：kb-open、tab-hidden 挂着，再点输入框也不弹，
    // 因为它已经聚焦了。回来后 0.3s、0.8s、1.5s、3s 各查一次：输入框聚焦着、键盘却不在，就 blur 掉，再点就是一次正常的聚焦
    const visT = []
    const unstick = () => {
      const el = document.activeElement
      if (!isField(el) || kbSeen) return // 不用 visualViewport 判断：回前台时它还报着旧的键盘高度
      kbLog(`back: ${el.tagName} focused, no keyboard → blur`)
      field = null; kbSeen = false; mo.disconnect(); setKeyboardOpen(false)
      el.blur()
    }
    const onVisibility = () => {
      kbLog(`${document.visibilityState} · active ${document.activeElement?.tagName} · kb ${!!field}`)
      visT.forEach(clearTimeout)
      if (document.visibilityState === 'visible') { visT.splice(0, 4, setTimeout(unstick, 300), setTimeout(unstick, 800), setTimeout(unstick, 1500), setTimeout(unstick, 3000)); return }
      if (document.visibilityState !== 'hidden') return
      if (isField(document.activeElement)) document.activeElement.blur()
      field = null; kbSeen = false; bgStale = true; mo.disconnect(); setKeyboardOpen(false) // kbSeen 也要清：不清的话回来 iOS 偷偷恢复焦点时还以为键盘在，unstick 不动手（#81 失效的原因）
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('visibilitychange', onVisibility)
    vv?.addEventListener('resize', onVv)
    return () => { mo.disconnect(); clearTimeout(dogT); visT.forEach(clearTimeout); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut); document.removeEventListener('visibilitychange', onVisibility); vv?.removeEventListener('resize', onVv) }
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

// 状态栏是透明的（index.html），页面画到最上面。html / body / theme-color 跟着页面走（color）。
// #root 单独给（under，默认同 color）：键盘弹起时外框缩到键盘上方，键盘和它上面那条半透明工具栏后面露出来的是 #root 的底色，
// 和顶上系统顶边效果互不影响（10/25 真机分层试过：只有改 #root 工具栏变色，顶上不变；html / body / theme-color 都不影响工具栏，skin-checklist 6）。皮肤卸下时还原。
// 盖在页面上的全屏层（图片查看器）要自己的顶色：开着时 html / body 用它，页面这边怎么重刷都不变，关了换回页面的（skin-checklist 18）。
// theme-color 不跟着换：iOS 26 起 Safari 不看它，顶边颜色取 html / body（skin-checklist 4）
let chromeNow = null, chromeOver = null, chromeBare = null
function paintChrome() {
  const els = [document.documentElement, document.body]
  if (!chromeNow) { // 没有皮肤在管（旧皮肤）：直接改，关的时候还原
    if (chromeOver) { chromeBare ??= els.map(el => el.style.background); els.forEach(el => { el.style.background = chromeOver }) }
    else if (chromeBare) { els.forEach((el, i) => { el.style.background = chromeBare[i] }); chromeBare = null }
    return
  }
  const c = chromeOver || chromeNow.color
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = chromeNow.color
  els.forEach(el => { el.style.background = c })
}
export function overridePageChrome(color) { chromeOver = color || null; paintChrome() }
export function usePageChrome(color, under = color) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const prevMeta = meta?.content
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean)
    document.getElementById('vesper-top')?.remove() // index.html 开屏前垫的黑，React 接手后交给这里
    return () => {
      chromeNow = null
      if (meta && prevMeta != null) meta.content = prevMeta
      els.forEach(el => { el.style.background = ''; el.style.colorScheme = '' })
    }
  }, [])
  useEffect(() => {
    // color-scheme 只放在皮肤自己的外框上（.vesper 按白天 / 夜间写），html、body 都是 light dark：
    // Safari 算 prefers-color-scheme 时会看文档这一层声明支持哪种，写成只支持 light（html 或 body）它就一直答"浅色"，
    // Vesper 选 System 时永远换不到深色（skin-checklist 第 21 条）。键盘、输入框在外框里面，照样跟页面。
    // 另外 iOS 27 的系统顶边效果按文档声明的深浅上色：html 写死 dark 时开屏、首页状态栏下面会多一条黑（10/25 真机）
    ;[document.documentElement, document.body, document.getElementById('root')].filter(Boolean).forEach(el => { el.style.background = el.id === 'root' ? under : color; el.style.colorScheme = 'light dark' })
    chromeNow = { color }; paintChrome() // theme-color 和 html / body 的颜色在这里统一上（查看器开着 html / body 是它的黑）
  }, [color, under])
}
