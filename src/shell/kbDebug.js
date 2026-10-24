// ─── 键盘调试读数（平时不显示；换机型、升 iOS 后拿来量键盘） ─────────
// 在真机上量键盘起落时 visualViewport 每一帧的值：主屏幕模式下键盘动画途中到底有没有中间值。
// 打开：聊天顶栏的名字 2 秒内连点 5 下（主屏幕 App 里没法带网址参数），或网址带 ?kbdebug；再连点 5 下关掉。
// 输入框每次得到 / 失去焦点录 1.5 秒：每帧的 vv 高度、offsetTop、innerHeight、输入栏底边，和 vv resize 事件的时刻。
// 录完一条出一行结论；Copy 把最近 10 条原始数据拷走，贴给 Claude

const KEY = 'v_kbdebug'
const REC_MS = 1500

let box = null, live = null, list = null, raf = 0
const traces = []

const r = Math.round
const bar = () => document.querySelector('.cc-room .composer')?.getBoundingClientRect().bottom
const frameVh = () => { const f = document.querySelector('[data-shell-frame]'); return f ? f.style.getPropertyValue('--s-vh') || '-' : '-' }

// 输入框所在的那个能滚的父元素（底部面板的内容区、日记页）
function scroller(el) {
  for (let n = el?.parentElement; n && n !== document.body; n = n.parentElement) if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n
  return null
}

// 每帧：dt、vv 高度、vv offsetTop、innerHeight、聊天输入栏底边、输入框顶边、它所在滚动区的 scrollTop、底部面板的 top
function sample(t0, el, sc) {
  const vv = window.visualViewport
  return [r(performance.now() - t0), r(vv.height), r(vv.offsetTop), window.innerHeight, r(bar() ?? -1),
    r(el?.getBoundingClientRect().top ?? -1), r(sc?.scrollTop ?? -1), r(document.querySelector('.v-bsheet')?.getBoundingClientRect().top ?? -1)]
}

// 一条录完：高度换了几次值、头一次变是第几毫秒、最后一次变在第几毫秒、开头和结尾之间有几个中间值
function summarize(tr) {
  const hs = tr.frames.map(f => f[1])
  const a = hs[0], z = hs[hs.length - 1]
  const changes = tr.frames.filter((f, i) => i && f[1] !== tr.frames[i - 1][1])
  const mids = new Set(hs.filter(h => (h - a) * (h - z) < 0)).size
  const gaps = tr.frames.map(f => r(f[2] + f[1] - f[4]))
  return `${tr.kind === 'focusin' ? '▲open ' : '▼close'} ${a}→${z} · ${changes.length} changes` +
    ` · first ${changes[0]?.[0] ?? '-'}ms last ${changes.at(-1)?.[0] ?? '-'}ms · ${mids} mid values` +
    ` · resize@${tr.resizes.join(',') || '-'} · ${tr.frames.length} frames · bar gap ${Math.min(...gaps)}..${Math.max(...gaps)}` +
    ` · field ${tr.field} top ${tr.frames[0][5]}→${tr.frames.at(-1)[5]} biggest 1-frame move ${Math.max(0, ...tr.frames.map((f, i) => i ? Math.abs(f[5] - tr.frames[i - 1][5]) : 0))}px` +
    (tr.notes.length ? ` · ${tr.notes.join(' ')}` : '')
}

function render() {
  if (!list) return
  list.textContent = traces.slice(-4).map(t => t.summary || '…recording').join('\n')
}

function record(e) {
  if (!box || !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
  const t0 = performance.now(), vv = window.visualViewport, el = e.target, sc = scroller(el)
  const tr = { kind: e.type, field: el.placeholder || el.tagName, at: new Date().toISOString(), frames: [sample(t0, el, sc)], resizes: [], notes: [] }
  traces.push(tr); if (traces.length > 10) traces.shift()
  const onResize = () => tr.resizes.push(r(performance.now() - t0))
  vv.addEventListener('resize', onResize)
  const tick = () => {
    tr.frames.push(sample(t0, el, sc))
    if (performance.now() - t0 < REC_MS) requestAnimationFrame(tick)
    else { vv.removeEventListener('resize', onResize); tr.summary = summarize(tr); render() }
  }
  requestAnimationFrame(tick)
  render()
}

function loop() {
  if (!live) return
  const vv = window.visualViewport
  live.textContent = `vv ${r(vv.height)} top ${r(vv.offsetTop)} · inner ${window.innerHeight} · html ${r(document.documentElement.getBoundingClientRect().height)} · --s-vh ${frameVh()} · bar ${r(bar() ?? -1)} · scrollY ${r(window.scrollY)}`
  raf = requestAnimationFrame(loop)
}

function btn(label, fn) {
  const b = document.createElement('button')
  b.textContent = label
  b.style.cssText = 'font:inherit;color:#fff;background:#444;border:0;border-radius:4px;padding:4px 8px;margin-right:6px'
  b.addEventListener('click', fn)
  return b
}

function show() {
  if (box) return
  box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:6px;right:6px;top:calc(env(safe-area-inset-top) + 52px);z-index:2147483647;background:rgba(0,0,0,.78);color:#fff;font:10px/1.35 ui-monospace,Menlo,monospace;padding:6px;border-radius:6px;pointer-events:none;white-space:pre-wrap;word-break:break-all'
  live = document.createElement('div')
  list = document.createElement('div')
  list.style.marginTop = '4px'
  const row = document.createElement('div')
  row.style.cssText = 'margin-top:6px;pointer-events:auto'
  row.append(
    btn('Copy', async () => {
      const text = JSON.stringify({ ua: navigator.userAgent, standalone: navigator.standalone ?? matchMedia('(display-mode: standalone)').matches, cols: 'dt,vvH,vvTop,innerH,barBottom,fieldTop,scrollTop,sheetTop', traces }, null, 0)
      try { await navigator.clipboard.writeText(text); list.textContent = 'Copied ' + traces.length + ' traces\n' + list.textContent } catch {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'width:100%;height:120px;font:9px monospace'; box.append(ta); ta.select()
      }
    }),
    btn('Clear', () => { traces.length = 0; render() }),
    btn('Hide', () => toggle(false)),
  )
  box.append(live, list, row)
  document.body.append(box)
  render()
  loop()
}

function hide() {
  cancelAnimationFrame(raf)
  box?.remove()
  box = live = list = null
}

function toggle(on) {
  try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY) } catch {}
  on ? show() : hide()
}

// useVisibleHeight 那边做了什么（比如收键盘后推一下 offsetTop）记到正在录的那条里
export function kbNote(msg) {
  const tr = traces.at(-1)
  if (box && tr && !tr.summary) tr.notes.push(msg)
}

export function installKbDebug() {
  let taps = []
  const onTap = (e) => {
    if (!e.target.closest?.('.cc-room .chatroom-title')) return
    const now = Date.now()
    taps = taps.filter(t => now - t < 2000).concat(now)
    if (taps.length >= 5) { taps = []; toggle(!box) }
  }
  document.addEventListener('click', onTap, true)
  document.addEventListener('focusin', record, true)
  document.addEventListener('focusout', record, true)
  let on = false
  try { on = localStorage.getItem(KEY) === '1' || new URLSearchParams(location.search).has('kbdebug') } catch {}
  if (on) show()
  return () => {
    document.removeEventListener('click', onTap, true)
    document.removeEventListener('focusin', record, true)
    document.removeEventListener('focusout', record, true)
    hide()
  }
}
