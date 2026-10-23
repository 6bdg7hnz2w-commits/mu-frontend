import { useEffect, useState } from 'react'
import { apiFetch } from '../App.jsx'
import { SubPage } from './ui.jsx'

// ─── Album ──────────────────────────────────────────
// 沐自己挑着存下来的照片（bridge 的 album/），两列错落的网格，点开看大图和他写的那句话。
// 图要带口令拿，所以用 apiFetch 拿成 blob 再给 <img>；拿过的这次打开 App 里都留着
const blobs = new Map()
function useImage(file, thumb) {
  const key = `${file}${thumb ? '?thumb=1' : ''}`
  const [url, setUrl] = useState(() => blobs.get(key) || null)
  useEffect(() => {
    if (blobs.has(key)) { setUrl(blobs.get(key)); return }
    let alive = true
    apiFetch(`/api/cc/album/${encodeURIComponent(file)}${thumb ? '?thumb=1' : ''}`)
      .then(r => { if (!r.ok) throw new Error(); return r.blob() })
      .then(b => { const u = URL.createObjectURL(b); blobs.set(key, u); if (alive) setUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [key, file, thumb])
  return url
}

const md = (at) => `${Number(at.slice(5, 7))}.${Number(at.slice(8, 10))}`

function Tile({ p, tall, onOpen }) {
  const src = useImage(p.file, true)
  return (
    <div className="v-alb-tile" onClick={onOpen}>
      <div className="v-alb-img" style={{ aspectRatio: tall ? '3 / 4' : '1 / 1' }}>{src && <img src={src} alt="" />}</div>
      <div className="v-alb-cap"><b>{md(p.at)}</b><span>{p.desc}</span></div>
    </div>
  )
}

function Lightbox({ p, onClose }) {
  const full = useImage(p.file, false)
  const thumb = useImage(p.file, true)
  return (
    <div className="v-alb-light" data-back onClick={onClose}>
      {(full || thumb) && <img src={full || thumb} alt="" />}
      <div className="v-alb-light-date">{md(p.at)}</div>
      <div className="v-alb-light-desc">{p.desc}</div>
    </div>
  )
}

export default function AlbumPage({ onBack }) {
  const [photos, setPhotos] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => {
    apiFetch('/api/cc/album').then(async r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => setPhotos(Array.isArray(d?.photos) ? d.photos : []))
      .catch(() => setError("Couldn't load the album — try again later"))
  }, [])
  return (
    <>
      <SubPage title="Album" onBack={onBack}>
        <div className="v-sec">{error || (photos ? `Kept by Soren · ${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Loading…')}</div>
        {photos && photos.length === 0 && <div className="v-empty">Soren hasn't kept any photos yet</div>}
        {photos && photos.length > 0 && (
          <div className="v-alb-grid">
            {photos.map((p, i) => <Tile key={p.file} p={p} tall={i % 3 === 0} onOpen={() => setOpen(p)} />)}
          </div>
        )}
      </SubPage>
      {open && <Lightbox p={open} onClose={() => setOpen(null)} />}
    </>
  )
}
