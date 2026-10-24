import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../data.js'
import { MdBubble, MdFlat } from './markdown.jsx'

// ─── Voice audio duration resolution ────────────────
// Blob-sourced MP3s in Chrome often report duration as Infinity until
// the media element is forced to seek near the end once, a known
// workaround for the missing/streamed-duration metadata bug.
function resolveAudioDuration(audio, cb) {
  const tryFinalize = () => {
    if (isFinite(audio.duration) && audio.duration > 0) { cb(audio.duration); return true }
    return false
  }
  const onLoaded = () => {
    audio.removeEventListener('loadedmetadata', onLoaded)
    if (tryFinalize()) return
    const onTimeUpdate = () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.currentTime = 0
      tryFinalize()
    }
    audio.addEventListener('timeupdate', onTimeUpdate)
    try { audio.currentTime = 1e101 } catch { /* ignore */ }
  }
  audio.addEventListener('loadedmetadata', onLoaded)
}

const VOICE_MIN_WIDTH = 120
const VOICE_MAX_WIDTH = 320
function voiceBarWidth(duration) {
  if (duration == null || !isFinite(duration)) return VOICE_MIN_WIDTH
  return Math.min(VOICE_MAX_WIDTH, Math.max(VOICE_MIN_WIDTH, VOICE_MIN_WIDTH + duration * 15))
}

// 说话者自己决定哪句用声音说：<voice>英文</voice><voice_zh>中文翻译</voice_zh>，其余是普通文字。
// 按原顺序拆成 { type: 'text', text } / { type: 'voice', text, zh }。ElevenLabs 只念非中文，
// 所以 <voice> 里要是写成了中文，就退回成普通文字显示。
const VOICE_TAG_RE = /<voice>([\s\S]*?)<\/voice>\s*(?:<voice_zh>([\s\S]*?)<\/voice_zh>)?/g
export function parseVoiceSegments(raw) {
  const segs = []
  if (!raw) return segs
  const pushText = (t) => {
    t = t.replace(/<\/?voice(_zh)?>/g, '').trim()
    if (t) segs.push({ type: 'text', text: t })
  }
  let last = 0
  for (const m of raw.matchAll(VOICE_TAG_RE)) {
    pushText(raw.slice(last, m.index))
    const text = m[1].trim()
    const zh = (m[2] || '').trim()
    if (text && !/[\u4e00-\u9fff]/.test(text)) segs.push({ type: 'voice', text, zh })
    else pushText(text)
    last = m.index + m[0].length
  }
  pushText(raw.slice(last))
  return segs
}
// 转文字只显示说的话：[softly]、[sighs] 这类音频标签是给 ElevenLabs 的，不给人看
export function stripAudioTags(text) {
  return text.replace(/\[[^\]\n]*\]\s*/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}
export function hasVoiceSegment(raw) {
  return parseVoiceSegments(raw).some(seg => seg.type === 'voice')
}
export function estimateVoiceDurations(msgKey, raw, fetchDurationEstimate) {
  parseVoiceSegments(raw).forEach((seg, si) => { if (seg.type === 'voice') fetchDurationEstimate(`${msgKey}:${si}`, seg.text) })
}

export function TranscriptToggle({ open, onClick }) {
  return <button className="voice-transcript-btn" onClick={onClick}>{open ? '收起' : '转文字'}</button>
}

// range：只画第 from 到 to 段（Vesper 把语音条拿到气泡外面，一段话拆成几截画）；播放状态的 key 用原来的段号
export function VoiceAwareContent({ raw, msgKey, player, showTranscript, flat = false, range }) {
  const segs = useMemo(() => parseVoiceSegments(raw), [raw])
  const { ttsState, ttsDurations, toggleTts, seekTts } = player
  const [from, to] = range || [0, segs.length]
  return segs.slice(from, to).map((seg, i) => {
    const si = from + i
    if (seg.type === 'text') return flat ? <MdFlat key={si} className="msg-seg" text={seg.text} /> : <MdBubble key={si} className="msg-seg" text={seg.text} />
    const key = `${msgKey}:${si}`
    return (
      <div key={si} className="msg-seg">
        <VoiceMessage
          status={(ttsState[key] || {}).status || 'idle'}
          progress={(ttsState[key] || {}).progress || 0}
          duration={ttsDurations[key]}
          text={seg.text}
          zh={seg.zh}
          showText={showTranscript}
          onToggle={() => toggleTts(key, seg.text)}
          onSeek={ratio => seekTts(key, ratio)}
        />
      </div>
    )
  })
}

// ─── VoiceMessage (iMessage-style voice bubble) ─────
function VoiceMessage({ status, progress, duration, text, zh, showText, onToggle, onSeek }) {
  const trackRef = useRef(null)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const startXRef = useRef(0)
  const widthPx = useMemo(() => voiceBarWidth(duration), [duration])
  // 波形点数按波形区实际宽度来排（每点 3px + 间隔 3px），正好铺满：
  // 以前按"理想宽度"算点数，窄屏上语音条被 max-width 截短，右边的点被裁掉，进度就显得走得太快
  const [trackWidth, setTrackWidth] = useState(0)
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setTrackWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dotCount = useMemo(() => trackWidth ? Math.max(6, Math.floor((trackWidth + 3) / 6)) : Math.max(10, Math.min(32, Math.round(widthPx / 10))), [trackWidth, widthPx])
  const dotHeights = useMemo(() => Array.from({ length: 64 }, () => 4 + Math.round(Math.random() * 10)), [])
  const dots = useMemo(() => dotHeights.slice(0, Math.min(dotCount, 64)), [dotHeights, dotCount]) // 宽度变了也不重新洗高度，免得波形闪

  const playing = status === 'playing'
  const paused = status === 'paused'
  const loading = status === 'loading'
  const seekable = typeof onSeek === 'function' && isFinite(duration) && duration > 0
  const activeCount = (playing || paused) ? Math.round((progress || 0) * dots.length) : 0
  const elapsed = duration ? (progress || 0) * duration : 0
  const displaySeconds = (playing || paused) ? elapsed : duration
  const durationLabel = (displaySeconds != null && isFinite(displaySeconds)) ? `${Math.max(0, Math.round(displaySeconds))}"` : ''

  const ratioFromEvent = (e) => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (!rect.width) return 0
    return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
  }
  // 点语音条任意位置 = 播放/暂停；在波形上横向拖动才是调进度（拖过之后那次 click 不算点击）
  const handlePointerDown = (e) => {
    movedRef.current = false
    if (!seekable) return
    draggingRef.current = true
    startXRef.current = e.clientX
  }
  const handlePointerMove = (e) => {
    if (!draggingRef.current) return
    if (!movedRef.current) {
      if (Math.abs(e.clientX - startXRef.current) < 8) return
      movedRef.current = true
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    onSeek(ratioFromEvent(e))
  }
  const endDrag = (e) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  return (
    <div className="voice-msg">
      <div className={`voice-bar ${status}`} style={{ width: `${widthPx}px` }} onClick={onToggle} aria-label={playing ? 'Pause voice' : loading ? 'Loading voice' : 'Play voice'}>
        <span
          ref={trackRef}
          className={`voice-wave ${seekable ? '' : 'disabled'}`}
          onClick={e => { if (movedRef.current) { movedRef.current = false; e.stopPropagation() } }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {dots.map((h, di) => (
            <span key={di} className={`voice-dot ${di < activeCount ? 'active' : ''}`} style={{ height: `${h}px` }} />
          ))}
        </span>
        <span className="voice-duration">{loading ? <span className="spinner tiny light" /> : durationLabel}</span>
      </div>
      {showText && (
        <div className="bubble voice-transcript">
          <div>{stripAudioTags(text)}</div>
          {zh && <div className="voice-transcript-zh">{zh}</div>}
        </div>
      )}
    </div>
  )
}

// ─── Voice playback (shared by ChatRoom and CC chat) ─
// 语音段的 key 是 "消息key:段序号"，播放前才去 /api/tts 请求音频，时长先用 /api/tts/duration 估算。
export function useVoicePlayer() {
  const [ttsState, setTtsState] = useState({})
  const [ttsDurations, setTtsDurations] = useState({})
  const ttsAudioRef = useRef(null)
  const ttsUrlRef = useRef(null)
  const ttsAbortRef = useRef(null)
  const ttsIdxRef = useRef(null)
  const ttsStatusRef = useRef(null)
  // Audio kept alive (not revoked) after a message finishes playing, or when
  // switching away to play a different message, so replaying the same
  // message reuses it instead of re-fetching from /api/tts.
  const ttsCacheRef = useRef({})
  const ttsDurationsRef = useRef({})
  useEffect(() => { ttsDurationsRef.current = ttsDurations }, [ttsDurations])

  const fetchDurationEstimate = useCallback((idx, text) => {
    if (!text || !text.trim()) return
    const params = new URLSearchParams({ text, preset: 'calm' })
    apiFetch(`/api/tts/duration?${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && isFinite(data.duration)) {
          setTtsDurations(prev => (prev[idx] != null ? prev : { ...prev, [idx]: data.duration }))
        }
      })
      .catch(() => {})
  }, [])

  const clearTtsCache = useCallback(() => {
    Object.values(ttsCacheRef.current).forEach(({ url }) => URL.revokeObjectURL(url))
    ttsCacheRef.current = {}
  }, [])

  const stopTts = useCallback(() => {
    if (ttsAbortRef.current) { ttsAbortRef.current.abort(); ttsAbortRef.current = null }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
      ttsAudioRef.current.ontimeupdate = null
      ttsAudioRef.current.onended = null
      ttsAudioRef.current.onerror = null
      ttsAudioRef.current.onloadedmetadata = null
      ttsAudioRef.current.src = ''
      ttsAudioRef.current = null
    }
    if (ttsUrlRef.current) { URL.revokeObjectURL(ttsUrlRef.current); ttsUrlRef.current = null }
    const prevIdx = ttsIdxRef.current
    ttsIdxRef.current = null
    ttsStatusRef.current = null
    if (prevIdx != null) setTtsState(prev => { const n = { ...prev }; delete n[prevIdx]; return n })
  }, [])

  // Keeps the currently-active audio alive in ttsCacheRef instead of
  // discarding it — used when a message finishes naturally or when
  // switching to play a different message, so it can be replayed later
  // without a new fetch. Contrast with stopTts, which really discards.
  const stashTts = useCallback(() => {
    const idx = ttsIdxRef.current
    const audio = ttsAudioRef.current
    if (idx == null || !audio) return
    audio.pause()
    audio.currentTime = 0
    audio.ontimeupdate = null
    audio.onended = null
    audio.onerror = null
    ttsCacheRef.current[idx] = { audio, url: ttsUrlRef.current }
    ttsIdxRef.current = null
    ttsStatusRef.current = null
    ttsUrlRef.current = null
    setTtsState(prev => { const n = { ...prev }; delete n[idx]; return n })
  }, [])

  const pauseTts = useCallback(() => {
    const idx = ttsIdxRef.current
    if (idx == null || !ttsAudioRef.current) return
    ttsAudioRef.current.pause()
    ttsStatusRef.current = 'paused'
    setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'paused' } }))
  }, [])

  const resumeTts = useCallback(() => {
    const idx = ttsIdxRef.current
    if (idx == null || !ttsAudioRef.current) return
    ttsAudioRef.current.play()
    ttsStatusRef.current = 'playing'
    setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], status: 'playing' } }))
  }, [])

  const activateCachedTts = useCallback((idx, cached, atRatio) => {
    if (ttsIdxRef.current !== null && ttsIdxRef.current !== idx) stashTts()
    delete ttsCacheRef.current[idx]
    const { audio, url } = cached
    ttsIdxRef.current = idx
    ttsStatusRef.current = 'playing'
    ttsUrlRef.current = url
    ttsAudioRef.current = audio
    audio.ontimeupdate = () => {
      const dur = ttsDurationsRef.current[idx] ?? audio.duration
      if (dur && isFinite(dur)) setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], progress: audio.currentTime / dur } }))
    }
    audio.onended = () => { if (ttsIdxRef.current === idx) stashTts() }
    audio.onerror = () => { if (ttsIdxRef.current === idx) stopTts() }
    const knownDur = ttsDurationsRef.current[idx] ?? audio.duration
    if (atRatio && isFinite(knownDur) && knownDur) audio.currentTime = atRatio * knownDur
    audio.play().catch(() => {})
    setTtsState(prev => ({ ...prev, [idx]: { status: 'playing', progress: atRatio || 0 } }))
  }, [stashTts, stopTts])

  const toggleTts = useCallback(async (idx, text) => {
    if (ttsIdxRef.current === idx) {
      if (ttsStatusRef.current === 'playing') { pauseTts(); return }
      if (ttsStatusRef.current === 'paused') { resumeTts(); return }
      return
    }
    const cached = ttsCacheRef.current[idx]
    if (cached) { activateCachedTts(idx, cached, 0); return }
    stashTts()
    ttsIdxRef.current = idx
    ttsStatusRef.current = 'loading'
    setTtsState(prev => ({ ...prev, [idx]: { status: 'loading', progress: 0 } }))
    const controller = new AbortController()
    ttsAbortRef.current = controller
    try {
      const res = await apiFetch(`/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, preset: 'calm' }), signal: controller.signal })
      if (!res.ok) throw new Error('tts failed')
      const headerDuration = Number(res.headers.get('X-Audio-Duration'))
      const blob = await res.blob()
      if (ttsIdxRef.current !== idx) return
      const url = URL.createObjectURL(blob)
      ttsUrlRef.current = url
      const audio = new Audio(url)
      ttsAudioRef.current = audio
      if (isFinite(headerDuration) && headerDuration > 0) {
        setTtsDurations(prev => ({ ...prev, [idx]: headerDuration }))
      } else {
        resolveAudioDuration(audio, dur => setTtsDurations(prev => ({ ...prev, [idx]: dur })))
      }
      audio.ontimeupdate = () => {
        const dur = ttsDurationsRef.current[idx] ?? audio.duration
        if (dur && isFinite(dur)) setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], progress: audio.currentTime / dur } }))
      }
      audio.onended = () => { if (ttsIdxRef.current === idx) stashTts() }
      audio.onerror = () => { if (ttsIdxRef.current === idx) stopTts() }
      await audio.play()
      if (ttsIdxRef.current === idx) { ttsStatusRef.current = 'playing'; setTtsState(prev => ({ ...prev, [idx]: { status: 'playing', progress: 0 } })) }
    } catch (err) {
      if (err.name !== 'AbortError' && ttsIdxRef.current === idx) {
        ttsIdxRef.current = null
        ttsStatusRef.current = null
        setTtsState(prev => { const n = { ...prev }; delete n[idx]; return n })
      }
    }
  }, [stashTts, stopTts, pauseTts, resumeTts, activateCachedTts])

  const seekTts = useCallback((idx, ratio) => {
    const clamped = Math.min(Math.max(ratio, 0), 1)
    if (ttsIdxRef.current === idx) {
      const audio = ttsAudioRef.current
      const dur = ttsDurationsRef.current[idx] ?? audio?.duration
      if (!audio || !isFinite(dur) || !dur) return
      audio.currentTime = clamped * dur
      setTtsState(prev => ({ ...prev, [idx]: { ...prev[idx], progress: clamped } }))
      return
    }
    const cached = ttsCacheRef.current[idx]
    if (cached) activateCachedTts(idx, cached, clamped)
  }, [activateCachedTts])

  useEffect(() => () => { stopTts(); clearTtsCache() }, [stopTts, clearTtsCache])

  const resetVoice = useCallback(() => {
    stopTts()
    clearTtsCache()
    setTtsDurations({})
  }, [stopTts, clearTtsCache])

  return { ttsState, ttsDurations, toggleTts, seekTts, fetchDurationEstimate, resetVoice }
}
