// ─── 草稿里的图和文件 ────────────────────────────────
// 文字草稿在 localStorage（draft_<会话>），图和文件是 Blob/File 放不进去，存 IndexedDB：一个会话一条记录，
// 值是 [{ key, kind: 'image', blob } | { key, kind: 'file', file }]。张数另记一份到 localStorage，聊天列表同步读得到
const DB = 'mu-drafts', STORE = 'attachments'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function run(mode, fn) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

export async function loadDraftFiles(sessionId) {
  try { return (await run('readonly', s => s.get(sessionId))) || [] } catch { return [] }
}
export async function saveDraftFiles(sessionId, items) {
  const keep = items.map(p => p.kind === 'file' ? { key: p.key, kind: 'file', file: p.file } : { key: p.key, kind: 'image', blob: p.blob })
  try { if (keep.length) localStorage.setItem(`draft_files_${sessionId}`, String(keep.length)); else localStorage.removeItem(`draft_files_${sessionId}`) } catch {}
  try { await run('readwrite', s => keep.length ? s.put(keep, sessionId) : s.delete(sessionId)) } catch {}
}
export function draftFileCount(sessionId) {
  try { return Number(localStorage.getItem(`draft_files_${sessionId}`)) || 0 } catch { return 0 }
}
