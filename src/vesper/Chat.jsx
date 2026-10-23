import { ChatPage } from '../App.jsx'

// ─── Chats ──────────────────────────────────────────
// 聊天的逻辑（语音、图片、文件、查找、回复方式、轮询）直接用 Clawd 的 ChatPage，一行不重写；
// 外面套 .v-clawd，把 Clawd 的颜色变量换成 Vesper 的（聊天壁纸要等聊天页自己重做时再加）
const noop = () => {}

export default function ChatTab() {
  return (
    <div className="v-clawd v-chat">
      <ChatPage onEnterRoom={noop} />
    </div>
  )
}
