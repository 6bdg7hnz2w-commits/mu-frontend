import { useEffect, useState } from 'react'
import { apiFetch, getWhisperCache, setWhisperCache, ensureImportantMigrated, fetchUpcomingImportant, getUpcomingImportantCache, getMcpUrl, mcpRequest } from '../App.jsx'

// ─── 首页、More、Usage 用到的数据：开场时一起取，取到的存一份在本地 ────────────────
// 下次打开先拿上次存的直接画（数字不从 0 跳上来），后台取到新的、真的变了才更新。
// 每个 key 一个 loader：返回要存的值（undefined = 这次没取到，留着旧的）
const LOADERS = {
  diaries: () => apiFetch('/api/diaries').then(r => r.json()).then(d => Array.isArray(d) ? d : undefined),
  whisper: () => apiFetch('/api/whispers/today').then(r => r.json()).then(w => { if (w?.content) { setWhisperCache(w); return { date: w.date, content: w.content } } }),
  important: () => ensureImportantMigrated().then(fetchUpcomingImportant),
  memory: () => apiFetch('/api/cc/memory').then(r => r.ok ? r.json() : null).then(d => Array.isArray(d?.files) ? `${d.files.length} memory files` : undefined),
  album: () => apiFetch('/api/cc/album').then(r => r.ok ? r.json() : null).then(d => Array.isArray(d?.photos) ? `${d.photos.length} photos kept by Soren` : undefined),
  // MCP：存过地址就试着连一下数工具，连不上就写 Not connected（和画布一样）
  mcp: () => {
    const url = getMcpUrl()
    if (!url) return Promise.resolve('Not connected')
    return mcpRequest(url, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mu', version: '1.0' } })
      .then(() => mcpRequest(url, 'tools/list', {}))
      .then(r => { const n = Array.isArray(r?.tools) ? r.tools.length : 0; return `Connected · ${n} tool${n === 1 ? '' : 's'}` })
      .catch(() => 'Not connected')
  },
  usage: () => apiFetch('/api/cc/usage?days=30&hours=48').then(r => { if (!r.ok) throw new Error(); return r.json() }),
}
// 以前各页自己存过的，第一次用新缓存时接过来
const LEGACY = {
  whisper: () => getWhisperCache() || undefined,
  important: () => getUpcomingImportantCache() ?? undefined,
}

const mem = new Map(), subs = new Map(), inflight = new Map()
const lsKey = (k) => `v_cache_${k}`
export function peek(key) {
  if (mem.has(key)) return mem.get(key)
  let v
  try { const s = localStorage.getItem(lsKey(key)); if (s) v = JSON.parse(s) } catch {}
  if (v === undefined) v = LEGACY[key]?.()
  if (v !== undefined) mem.set(key, v)
  return v
}
function put(key, v) {
  if (v === undefined || JSON.stringify(peek(key)) === JSON.stringify(v)) return // 没变：不存、不通知，页面不动
  mem.set(key, v)
  try { localStorage.setItem(lsKey(key), JSON.stringify(v)) } catch {}
  subs.get(key)?.forEach(f => f(v))
}
// 同一个 key 同时只取一次：开场预取和页面挂载时的那次合成一次
export function refresh(key) {
  if (inflight.has(key)) return inflight.get(key)
  const p = Promise.resolve().then(LOADERS[key]).then(v => put(key, v)).catch(() => {}).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
// 开场时调：全部取完（或者最多 ms 毫秒）就 resolve
export function preload(ms = 3000) {
  return Promise.race([Promise.all(Object.keys(LOADERS).map(refresh)), new Promise(r => setTimeout(r, ms))])
}
// 页面里用：先给缓存的值，取到新的且变了才换；挂载时顺手刷新一次（开场刚取过就合用那一次）
export function useCached(key, fallback) {
  const [v, setV] = useState(() => peek(key) ?? fallback)
  useEffect(() => {
    const set = subs.get(key) || new Set()
    subs.set(key, set)
    set.add(setV)
    const now = peek(key)
    if (now !== undefined) setV(now)
    refresh(key)
    return () => set.delete(setV)
  }, [key])
  return v
}
// 页面自己改了（写日记、删日记）：直接把新值记进缓存
export function setCached(key, v) { put(key, v) }
