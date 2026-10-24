import { useEffect, useRef, useState } from 'react'
import { I } from '../../App.jsx'
import { useCcSay } from './CcChat.jsx'
import { CcPendingRow } from './PendingRow.jsx'

// ─── 输入栏：语音 / 键盘、输入框、表情、⊕、发送；上面一排待发的图，下面加号面板和表情面板 ───
// 只管画和录音；输入的字、待发的图、面板开没开都在 CCChatPage（CcChat.jsx），键盘和面板三选一也在那边（skin-checklist 第 7 条）

// 录音格式：Chrome 录 webm/opus，iPhone Safari 只会 mp4
function ccRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return null
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || ''
}
const CC_VOICE_MAX_S = 60 // 一段最多录这么久，到点自动发
const CC_VOICE_MIN_S = 0.8
// 输入框两边的圆圈按钮：语音（声波）/ 键盘、⊕
const CC_VOICE_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.3 10.6a2 2 0 0 1 0 2.8" strokeWidth="1.8"/><path d="M11.8 8.6a5 5 0 0 1 0 6.8" strokeWidth="1.8"/><path d="M14.3 6.6a8 8 0 0 1 0 10.8" strokeWidth="1.8"/></svg>
const CC_EMOJI_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="9" cy="10" r=".6" fill="currentColor" strokeWidth="1.4"/><circle cx="15" cy="10" r=".6" fill="currentColor" strokeWidth="1.4"/><path d="M7.8 13.5h8.4a4.2 4.2 0 0 1-8.4 0z" strokeWidth="1.6"/></svg>
const CC_KEYBOARD_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 9h.01M10.5 9h.01M13.5 9h.01M16.5 9h.01M7.5 12h.01M10.5 12h.01M13.5 12h.01M16.5 12h.01" strokeWidth="2.2"/><path d="M9 15.5h6" strokeWidth="1.8"/></svg>
// 表情面板：常用的这些，点一下插进输入框光标处
// 面板从原来那块的高度长出来（皮肤的 CSS 用 --s-panelFrom 做开场动画，0 是从底下升上来）
const panelFromProps = (from) => from == null ? {} : { 'data-from': from ? 'h' : '0', style: { '--s-panelFrom': `${from}px` } }
const CC_PLUS_ICON = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7.5v9M7.5 12h9" strokeWidth="1.7"/></svg>

// 按住说话。onVoice(blob, duration) 录完交出去发；textareaRef 用来切到语音前先让输入框失焦
export function useVoiceRecorder({ passcode, textareaRef, onVoice, onNotice }) {
  const say = useCcSay()
  const [recording, setRecording] = useState(null) // 按住说话中：{ start, cancel }；start 是麦克风开好的时刻（还在要权限时是 null）
  const [recNow, setRecNow] = useState(0)
  const recRef = useRef(null)
  const canRecord = ccRecorderMime() !== null && !!navigator.mediaDevices?.getUserMedia
  const [voiceMode, setVoiceMode] = useState(() => { try { return canRecord && localStorage.getItem('cc_voice_mode') === '1' } catch { return false } }) // 上次用的是语音还是键盘，下次进来照旧
  const toggleVoiceMode = () => {
    const next = !voiceMode
    setVoiceMode(next)
    try { localStorage.setItem('cc_voice_mode', next ? '1' : '0') } catch {}
    // 切到语音前先让输入框失焦：直接卸掉的话浏览器不发 focusout，底部 tab 会一直藏着；切回键盘也不自动聚焦，点了输入框才藏 tab
    if (next) textareaRef.current?.blur()
  }
  // ─── 按住说话 ───
  // 按下开麦克风开始录，松开就发；按着往上滑超过 60px 松开是取消。第一次按会弹麦克风权限，没开好就松手的这次不算
  const finishRecording = (rec) => {
    rec.stream?.getTracks().forEach(t => t.stop())
    if (recRef.current === rec) recRef.current = null
    if (rec.cancel) return
    if (rec.duration < CC_VOICE_MIN_S) { onNotice(say('太短了，按住多说一会儿', 'Too short — hold a little longer')); return }
    const type = rec.recorder?.mimeType || rec.chunks[0]?.type || 'audio/webm'
    const blob = new Blob(rec.chunks, { type })
    if (blob.size) onVoice(blob, rec.duration)
  }
  const stopRecording = (cancel) => {
    const rec = recRef.current
    if (!rec || rec.released) return
    rec.released = true
    rec.cancel = cancel
    rec.duration = rec.startedAt ? (Date.now() - rec.startedAt) / 1000 : 0
    clearTimeout(rec.timer)
    setRecording(null)
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop() // onstop 里收尾
    else finishRecording({ ...rec, cancel: true })
  }
  const startRecording = async (e) => {
    e.preventDefault()
    if (recRef.current || !passcode) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const rec = { chunks: [], y0: e.clientY, released: false, cancel: false }
    recRef.current = rec
    setRecording({ start: null, cancel: false })
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      recRef.current = null
      setRecording(null)
      onNotice(say('没拿到麦克风权限（设置里允许这个网页用麦克风）', 'No microphone access — allow it in Settings'))
      return
    }
    rec.stream = stream
    if (rec.released) { // 在弹权限的时候已经松手了
      stream.getTracks().forEach(t => t.stop())
      if (recRef.current === rec) recRef.current = null
      if (!rec.cancel) onNotice(say('好了，再按住说一次', 'Ready — hold to talk again'))
      return
    }
    const mime = ccRecorderMime()
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recorder.ondataavailable = ev => { if (ev.data?.size) rec.chunks.push(ev.data) }
    recorder.onstop = () => finishRecording(rec)
    rec.recorder = recorder
    rec.startedAt = Date.now()
    recorder.start()
    rec.timer = setTimeout(() => stopRecording(false), CC_VOICE_MAX_S * 1000)
    setRecording({ start: rec.startedAt, cancel: false })
  }
  const moveRecording = (e) => {
    const rec = recRef.current
    if (!rec || rec.released) return
    const cancel = rec.y0 - e.clientY > 60
    setRecording(r => r && r.cancel !== cancel ? { ...r, cancel } : r)
  }
  const releaseRecording = (e) => {
    const rec = recRef.current
    if (!rec) return
    stopRecording(rec.y0 - e.clientY > 60)
  }
  useEffect(() => {
    if (!recording?.start) return
    const t = setInterval(() => setRecNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [recording?.start])
  useEffect(() => () => { const rec = recRef.current; if (rec) { rec.cancel = true; stopRecording(true) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { canRecord, voiceMode, toggleVoiceMode, recording, recNow, start: startRecording, move: moveRecording, release: releaseRecording, stop: stopRecording }
}

// rec：useVoiceRecorder 的返回值
export function Composer({ passcode, rec, notice, onClearNotice, pending, onReorderPending, onOpenPending, onRemovePending, textareaRef, input, onInput, onKeyDown, onFocus, onBlur, onTextTouchStart, emojiOpen, attachOpen, panelFrom, onTogglePanel, onCloseAttach, full, fileAccept, filesReady, onPickFiles, onPickImages, onSend }) {
  const say = useCcSay()
  const { recording } = rec
  const photoInputRef = useRef(null)
  const cameraInputRef = useRef(null) // Vesper 的 Camera 按钮用
  const fileInputRef = useRef(null)
  return (
    <div className="composer">
      {notice && <div className="cc-notice" onClick={onClearNotice}>{notice}</div>}
      {pending.length > 0 && <CcPendingRow items={pending} onReorder={onReorderPending} onOpen={onOpenPending} onRemove={onRemovePending} />}
      {recording && (
        <div className={`cc-recording${recording.cancel ? ' cancel' : ''}`} role="status">
          <span className="cc-recording-dot" />
          <span className="cc-recording-time">{recording.start ? `${Math.floor(Math.max(0, rec.recNow - recording.start) / 1000)}"` : '…'}</span>
          <span>{!recording.start ? 'Opening mic…' : recording.cancel ? 'Release to cancel' : 'Release to send · slide up to cancel'}</span>
        </div>
      )}
      {/* 左边切语音 / 键盘；语音模式下输入框换成整条"按住 说话"；右边 ⊕ 是照片和文件，有东西要发时多一个发送 */}
      <div className="composer-input-row cc-composer-row">
        <button className="attach-btn cc-mode-btn" onClick={rec.toggleVoiceMode} disabled={!passcode || (!rec.voiceMode && !rec.canRecord)} aria-label={rec.voiceMode ? say('切换到键盘', 'Keyboard') : say('切换到语音', 'Voice')}>{rec.voiceMode ? CC_KEYBOARD_ICON : CC_VOICE_ICON}</button>
        {rec.voiceMode ? (
          <button className={`cc-hold-btn${recording ? ' recording' : ''}${recording?.cancel ? ' cancel' : ''}`} disabled={!passcode}
            onPointerDown={rec.start} onPointerMove={rec.move} onPointerUp={rec.release} onPointerCancel={() => rec.stop(true)}
            onContextMenu={e => e.preventDefault()}>{!recording ? 'Hold to talk' : recording.cancel ? 'Release to cancel' : 'Release to send'}</button>
        ) : (
          <textarea ref={textareaRef} value={input} onChange={e => onInput(e.target.value)} onKeyDown={onKeyDown} onTouchStart={onTextTouchStart} onFocus={onFocus} onBlur={onBlur} placeholder="Say to Soren" rows={1} disabled={!passcode} />
        )}
        <button className={`attach-btn${emojiOpen ? ' active' : ''}`} onClick={() => onTogglePanel('emoji')} disabled={!passcode} aria-label={say('表情包', 'Stickers')} aria-expanded={emojiOpen}>{CC_EMOJI_ICON}</button>
        <button className={`attach-btn${attachOpen ? ' active' : ''}`} onClick={() => onTogglePanel('attach')} disabled={!passcode || full} aria-label="Add photos or files" aria-expanded={attachOpen}>{CC_PLUS_ICON}</button>
        <input ref={fileInputRef} type="file" accept={fileAccept} multiple onChange={onPickFiles} style={{ display: 'none' }} />
        <input ref={photoInputRef} type="file" accept="image/*" multiple onChange={onPickImages} style={{ display: 'none' }} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={onPickImages} style={{ display: 'none' }} />
        {((!rec.voiceMode && input.trim()) || pending.length > 0) && <button className="send-btn" onClick={onSend} disabled={!passcode}>{I.send}</button>}
      </div>
      {attachOpen && (
        <div className="cc-attach-menu" {...panelFromProps(panelFrom)}>
          {say(false, true) && <button onClick={() => { onCloseAttach(); cameraInputRef.current?.click() }} disabled={!passcode || full}><i>{I.camera}</i><span>Camera</span></button>}
          <button onClick={() => { onCloseAttach(); photoInputRef.current?.click() }} disabled={!passcode || full}><i>{I.photo}</i><span>{say('照片', 'Photos')}</span></button>
          <button onClick={() => { onCloseAttach(); fileInputRef.current?.click() }} disabled={!passcode || !filesReady || full}><i>{I.file}</i><span>{say('文件', 'Files')}</span></button>
        </div>
      )}
      {emojiOpen && <div className="cc-emoji-panel" {...panelFromProps(panelFrom)}><div className="cc-emoji-soon">{say('表情包在做了', 'Stickers are on the way')}</div></div>}
    </div>
  )
}
