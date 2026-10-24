import { useEffect, useRef, useState } from 'react'
import { useVisibleHeight, useKeyboardOpen } from './viewport.js'
import { installKbDebug } from './kbDebug.js'

// ─── TabShell：外框 + 底部 tab 栏 ─────────────────────
// 和皮肤无关的部分：外框（data-shell-frame，可见高度、键盘、钉在顶上）、tab 栏什么时候收起。
// 哪些是二级页（subPage）由皮肤自己按路由算好传进来；样式、图标、颜色都在皮肤里，类名按 prefix 拼（Vesper 是 v-tabbar / v-tab / v-tab-pill）。
// 坑见 docs/skin-checklist.md 第 10 条（二级页面隐藏底部 tab）

// 放在皮肤组件最上面、锁屏判断之前调用：锁屏时文档也要钉死（html.v-lock），键盘状态也一直在记
export function useTabShell() {
  const frame = useRef(null)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false) // 聊天的表情 / 加号面板开着（App.jsx 的 CCChatPage 广播 cc-panel）：和键盘一样收起 tab 栏
  useEffect(() => {
    const on = (e) => setPanelOpen(!!e.detail)
    window.addEventListener('cc-panel', on)
    return () => window.removeEventListener('cc-panel', on)
  }, [])
  useVisibleHeight(frame)
  useKeyboardOpen(setKeyboardOpen)
  useEffect(() => installKbDebug(), []) // 键盘调试读数，平时不显示（kbDebug.js）
  return { frame, keyboardOpen, panelOpen }
}

// 底部 tab 只在一级页显示；带返回键的二级页（subPage）一律收起，在这里统一判断，页面自己不管。
// 另外键盘弹出、聊天面板打开时（只在 panelTab 那一格）也收起。收起 / 回来都是 tab 栏自己往下滑出、滑回（皮肤 CSS 的 .tab-hidden）
export function TabShell({ shell, prefix, className, tabs, tab, onTab, subPage, panelTab, frameProps, children, ...rest }) {
  const { frame, keyboardOpen, panelOpen } = shell
  const tabHidden = subPage || keyboardOpen || (tab === panelTab && panelOpen)
  return (
    // 输入框获得焦点时浏览器会把外框也滚上去（overflow:hidden 照样能被滚），外框永远钉在顶上
    <div ref={frame} data-shell-frame className={`${className} ${tabHidden ? 'tab-hidden' : ''} ${keyboardOpen ? 'kb-open' : ''}`} {...rest} {...frameProps} onScroll={e => { if (e.target === e.currentTarget) e.currentTarget.scrollTop = 0 }}>
      {children}
      {/* 选中那格垫一块会滑动的小块 */}
      <nav className={`${prefix}-tabbar`}>
        <i className={`${prefix}-tab-pill`} style={{ transform: `translateX(${tabs.findIndex(t => t.key === tab) * 100}%)` }} />
        {tabs.map(t => (
          <button key={t.key} className={`${prefix}-tab ${tab === t.key ? 'on' : ''}`} onClick={() => onTab(t.key)}>
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
