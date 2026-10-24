import './wall.css'

// ─── 聊天壁纸 ─────────────────────
// 一张照片 + 一层纯色蒙版，按整个屏幕的高度铺；颜色、滤镜、蒙版读皮肤给的 --s-wallBase / --s-wallF / --s-wallVeil
// data-swipe-follow：右滑返回时壁纸跟着聊天页一起移
export function ChatWall({ src }) {
  return <div className="s-wall" data-swipe-follow><img src={src} alt="" /><i /></div>
}
