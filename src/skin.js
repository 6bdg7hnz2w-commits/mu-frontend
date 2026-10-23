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
  window.dispatchEvent(new Event('mu-skin'))
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
