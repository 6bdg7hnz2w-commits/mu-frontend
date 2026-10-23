import { useEffect, useState } from 'react'

// ─── 皮肤 ───────────────────────────────────────────
// clawd = 原来那套界面（App.jsx），vesper = 雾蓝那套（src/vesper/）。按设备存在 localStorage；
// 换皮肤广播 mu-skin，main.jsx 里的 Root 收到后整棵树换掉。localStorage 用不了时也能在这次打开里切换。
const SKIN_KEY = 'mu_skin'
const SKINS = ['clawd', 'vesper']
let current = (() => {
  try { const v = localStorage.getItem(SKIN_KEY); return SKINS.includes(v) ? v : 'clawd' } catch { return 'clawd' }
})()

export function getSkin() { return current }
export function setSkin(skin) {
  if (!SKINS.includes(skin) || skin === current) return
  current = skin
  try { localStorage.setItem(SKIN_KEY, skin) } catch {}
  if (reloadIfStatusStyleChanged()) return
  window.dispatchEvent(new Event('mu-skin'))
}

// 状态栏样式：Vesper 夜间用透明（black-translucent，字是白的，页面铺到最上面），其余用 default。
// iOS 只在打开时读，index.html 里那段脚本在第一帧前定好；换皮肤、换浅色/夜间后要不一样了就重新载入一次
export function wantedStatusStyle() {
  try {
    const mode = localStorage.getItem('mu_vesper_mode')
    const night = mode === 'night' || (mode !== 'day' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
    return localStorage.getItem(SKIN_KEY) === 'vesper' && night ? 'black-translucent' : 'default'
  } catch { return 'default' }
}
export function reloadIfStatusStyleChanged() {
  const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
  if (!window.navigator.standalone || !meta || meta.content === wantedStatusStyle()) return false // 只有主屏幕上的 App 才看这一项
  window.location.reload()
  return true
}
export function useSkin() {
  const [skin, set] = useState(current)
  useEffect(() => {
    const on = () => set(current)
    window.addEventListener('mu-skin', on)
    return () => window.removeEventListener('mu-skin', on)
  }, [])
  return skin
}
