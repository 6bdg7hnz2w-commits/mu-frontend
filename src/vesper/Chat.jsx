import { ChatPage } from '../App.jsx'
import { BG, useTopColor } from './ui.jsx'

// ─── Chats ──────────────────────────────────────────
// 聊天的逻辑（语音、图片、文件、查找、回复方式、轮询）直接用 Clawd 的 ChatPage，一行不重写；
// 文字用 lang="en"（画布上的英文），样子靠 .v-clawd 下的样式照画布改：壁纸、雾面顶栏和输入栏、她的蓝气泡、他的衬线正文
const noop = () => {}

export default function ChatTab({ onUsage }) {
  useTopColor(BG.day, BG.night, 1)
  return (
    <div className="v-clawd v-chat">
      <div className="v-chat-wall"><img src="/vesper/chat-bg.webp" alt="" /><i /></div>
      <ChatPage onEnterRoom={noop} lang="en" onUsage={onUsage} />
    </div>
  )
}
