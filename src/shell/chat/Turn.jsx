import { I } from '../../App.jsx'
import { fmtMsgTime } from '../data.js'
import { CopyButton, messageCopyText } from './markdown.jsx'
import { TranscriptToggle, hasVoiceSegment } from './voice.jsx'
import { CcEditBox, CcFile, CcImage, CcPiece, CcTools, CcTurnBody, CcUpMark, CcVoice, ccIsTool, ccTurnParts, useCcSay } from './CcChat.jsx'

// ─── 消息列表里的一行 ─────────────────────────────
// CcTurn：他的一轮（几段合成一块）；CcUserMsg：她的一条。只管画，状态和动作都在 CCChatPage（CcChat.jsx）

// live：这块还在说；open：转文字展开着；flash：从搜索跳过来的那条在这块里
export function CcTurn({ row, live, flash, open, player, onToggleTranscript }) {
  const say = useCcSay()
  // 他的一轮：几段合成一块，没有气泡；时间、复制整块、转文字放在块下面
  // 还在说（服务器的"正在输入"亮着、这是最后一块）：不显示操作行，三个点跟在这块最后面
  const items = row.items
  const said = items.filter(it => !ccIsTool(it)) // 他说的话（复制、转文字只管这些）
  const last = items[items.length - 1]
  const voiced = said.some(it => hasVoiceSegment(it.text))
  const viaApi = items.findLast(it => it.viaApi) // 这块是 API 替班回的：时间后面标上模型
  return (
    <div className={`msg assistant cc-turn${flash ? ' cc-flash' : ''}`} data-mids={items.map(it => it.key).join(' ')}>
      <CcTurnBody rowKey={row.key} live={items[0].live}>
        {ccTurnParts(items).map((part, i) => part.tools
          ? <CcTools key={part.key} tools={part.tools} />
          : <CcPiece key={part.key} m={part.m} player={player} showTranscript={open} first={i === 0} />)}
        {live && <div className="cc-typing cc-typing-inline" aria-label={say('正在输入', 'Typing')}><span className="cc-typing-dot" /><span className="cc-typing-dot" /><span className="cc-typing-dot" /></div>}
      </CcTurnBody>
      {!live && (
        <div className="msg-meta">
          <span className="msg-time">{fmtMsgTime(last.time, say(false, true))}</span>
          {viaApi && <span className="msg-time cc-via-api">{viaApi.model ? `API · ${viaApi.model}` : 'API'}</span>}
          {said.length > 0 && <CopyButton getText={() => said.map(it => messageCopyText(it.text)).filter(Boolean).join('\n\n')} />}
          {voiced && <TranscriptToggle open={open} onClick={onToggleTranscript} />}
        </div>
      )}
    </div>
  )
}

// failure：他这次没回上来（点过"再叫他一下"的不传）；stuckNote：她最后一条下面提示"他好像卡住了"
export function CcUserMsg({ m, flash, failure, editing, stuckNote, onOpenImage, onRetry, onDiscard, onEdit, onSaveEdit, onCancelEdit, onCallAgain }) {
  const say = useCcSay()
  return (
    <div className={`msg ${m.role}${flash ? ' cc-flash' : ''}`} data-mids={m.key}>
      {m.images?.length > 0 && <div className={`cc-images${m.images.length > 4 ? ' many' : ''}`}>{m.images.map((im, i) => m.up?.[im.key]
        ? <div key={im.key} className="cc-up-wrap"><CcImage img={im} onOpen={onOpenImage} /><CcUpMark st={m.up[im.key]} onRetry={() => onRetry(m, im.key)} /></div>
        : <CcImage key={im.path || im.key || i} img={im} onOpen={onOpenImage} />)}</div>}
      {m.files?.length > 0 && <div className="cc-files">{m.files.map((f, i) => m.up?.[f.key]
        ? <div key={f.key} className="cc-up-wrap"><CcFile file={f} /><CcUpMark st={m.up[f.key]} onRetry={() => onRetry(m, f.key)} /></div>
        : <CcFile key={f.path || f.key || i} file={f} />)}</div>}
      {m.voices?.length > 0 && m.voices.map((v, i) => <CcVoice key={v.path || v.key || i} v={v} />)}
      {m.text && (editing
        ? <CcEditBox text={m.text} onSave={t => onSaveEdit(m, t)} onCancel={onCancelEdit} />
        : <div className="bubble">{m.text}</div>)}
      <div className="msg-meta">
        {m.failed
          ? <>
              <button className="cc-note-btn" onClick={() => onRetry(m)}>{say('发送失败 · 点一下重发', 'Not sent · tap to retry')}</button>
              <button className="copy-btn" onClick={() => onDiscard(m)} aria-label="Delete">{I.close}</button>
            </>
          : <span className="msg-time">{fmtMsgTime(m.time, say(false, true))}</span>}
        {m.editedAt && <span className="msg-time">{say('已编辑', 'Edited')}</span>}
        {m.viaApp && <span className="msg-time">{say('来自 Claude App', 'From Claude App')}</span>}
        {m.text && !editing && <CopyButton getText={() => m.text} />}
        {m.text && !m.local && !m.viaApp && !editing && (
          <button className="copy-btn" onClick={() => onEdit(m.key)} aria-label="Edit">{I.edit}</button>
        )}
      </div>
      {failure && (
        <div className="cc-msg-note">{failure.partial ? say('话没说完就断了', 'Cut off mid-reply') : say('他这次没回上来', "He didn't reply this time")} · <button className="cc-note-btn" onClick={() => onCallAgain(m, failure)}>{say('再叫他一下', 'Call him again')}</button></div>
      )}
      {stuckNote && <div className="cc-msg-note">{say('他好像卡住了', 'He seems stuck')}</div>}
    </div>
  )
}
