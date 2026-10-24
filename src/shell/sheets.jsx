import { useEffect, useRef } from 'react'
import { usePreventPageScroll } from './preventScroll.js'
import './sheets.css'

// ─── 底部面板 ─────────────────────
// 和皮肤无关的部分：从底边弹出、贴着键盘、不让 iOS 滚页面。样式在皮肤 CSS 里，类名按 prefix 拼（Vesper 是 v-sheet / v-bsheet / v-modal）；蒙版颜色走 data-scrim（sheets.css）

// iOS 那种从底部弹出的操作菜单；actions 里的 false 会被跳过
export function ActionSheet({ title, actions, onClose, prefix = 'v' }) {
  return (
    <div className={`${prefix}-sheet`} data-scrim="sheet" data-back onClick={onClose}>
      <div className={`${prefix}-sheet-card`} onClick={e => e.stopPropagation()}>
        {title && <div className={`${prefix}-sheet-title`}>{title}</div>}
        {actions.filter(Boolean).map(a => (
          <button key={a.label} className={a.danger ? 'danger' : ''} onClick={a.onClick}>{a.label}</button>
        ))}
      </div>
      <button className={`${prefix}-sheet-cancel`} onClick={onClose}>Cancel</button>
    </div>
  )
}

// 新建日程用的底部面板（照 iOS 日历）：从底边滑上来，弹键盘时贴在键盘上方；
// 标题和 Cancel / Save 钉在顶上，下面的表单在面板里滚，输入框不跟着键盘压扁
export function BottomSheet({ title, left, right, onClose, children, prefix = 'v' }) {
  // 面板跟着 visualViewport 走：键盘（连同上面那条工具栏）弹起时，面板的底边贴着它的顶边，不被盖住
  const wrap = useRef(null)
  useEffect(() => {
    const vv = window.visualViewport, el = wrap.current
    if (!vv || !el) return
    const fit = () => { el.style.top = `${vv.offsetTop}px`; el.style.height = `${vv.height}px` }
    fit()
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit) }
  }, [])
  usePreventPageScroll(wrap) // 点输入框、在面板头上拖都不让 iOS 滚页面（New Event、纪念日都用这个面板）
  // 输入框获得焦点：等键盘升好、面板缩好，把它滚到面板可见区域的中间
  const reveal = (e) => {
    const el = e.target
    if (!el.matches?.('input, textarea')) return
    const box = e.currentTarget // 只滚面板自己的内容区，不让 scrollIntoView 把底下的页面也带着滚
    const go = () => {
      if (document.activeElement !== el) return
      const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
      box.scrollTo({ top: box.scrollTop + (r.top + r.height / 2) - (b.top + b.height / 2), behavior: 'smooth' })
    }
    setTimeout(go, 350); setTimeout(go, 700)
  }
  return (
    <div ref={wrap} className={`${prefix}-modal ${prefix}-bsheet`} data-scrim onClick={onClose}>
      <div className={`${prefix}-bsheet-card`} onClick={e => e.stopPropagation()}>
        <div className={`${prefix}-bsheet-head`}>
          <i className={`${prefix}-bsheet-grab`} />
          <div className={`${prefix}-bsheet-side`}>{left}</div>
          <div className={`${prefix}-bsheet-title`}>{title}</div>
          <div className={`${prefix}-bsheet-side end`}>{right}</div>
        </div>
        <div className={`${prefix}-bsheet-body`} onFocus={reveal}>{children}</div>
      </div>
    </div>
  )
}
