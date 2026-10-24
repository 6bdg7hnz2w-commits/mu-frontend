import { I } from '../../App.jsx'
import { useCcSay } from './CcChat.jsx'

// ─── 聊天顶栏：返回、名字（连接状态）、⋮ ─────────────────
// 中文版（Clawd）名字下面一行写状态；英文版（Vesper）是名字右边一个小圆点（skin-checklist 第 12 条）
export function ChatHeader({ onBack, onMenu, passcode, status, statusLabel }) {
  const say = useCcSay()
  return (
    <div className="chatroom-header">
      <button className="icon-btn" onClick={onBack}>{I.back}</button>
      <div className="chatroom-title">
        {/* 英文版（Vesper）连接状态是名字右边一个小圆点，绝对定位挂着，名字还在正中、顶栏不变高 */}
        <div className="chatroom-name">{say('沐 (CC)', <span className="cc-name-wrap">Soren<span key={passcode ? status : 'locked'} className={`cc-head-dot ${passcode ? status : 'offline'}`} role="status" aria-label={passcode ? statusLabel : 'Locked'} /></span>)}</div>
        {say(<div className="chatroom-model">{passcode ? statusLabel : 'Locked'}</div>, null)}
      </div>
      <div className="chatroom-header-right">
        <button className="icon-btn" onClick={onMenu} aria-label={say('更多', 'More')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>
    </div>
  )
}
