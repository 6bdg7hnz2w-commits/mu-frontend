// ─── 状态栏遮罩 ─────────────────────────────────────
// 状态栏是透明的、字是白的（index.html 写死 black-translucent），浅色页面上看不清。
// 浅色页面顶上叠一层暗色渐变垫着：高 = 安全区 + 16px，从 .28 的黑到透明，不挡点击。
// on 由页面自己判断（Vesper 白天、不在 Home 时）；lightOnly 交给系统浅色/深色决定（Clawd 跟系统走）
export default function StatusScrim({ on = true, lightOnly = false }) {
  if (!on) return null
  return <div className={`status-scrim${lightOnly ? ' light-only' : ''}`} aria-hidden="true" />
}
