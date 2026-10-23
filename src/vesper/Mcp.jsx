import { useState } from 'react'
import { getMcpUrl, setMcpUrlStorage, mcpRequest } from '../App.jsx'
import { SubPage } from './ui.jsx'

// ─── MCP ────────────────────────────────────────────
// 和 Clawd 的 Settings → MCP 一样：填地址连上 MCP server，列出它的工具；地址存在同一个 mcp_server_url
export default function McpPage({ onBack }) {
  const [url, setUrl] = useState(getMcpUrl())
  const [status, setStatus] = useState('idle') // idle | connecting | connected | error
  const [tools, setTools] = useState([])
  const [error, setError] = useState('')
  const on = status === 'connected'

  const connect = async () => {
    const u = url.trim()
    if (!u || status === 'connecting') return
    setStatus('connecting'); setError('')
    try {
      await mcpRequest(u, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mu', version: '1.0' } })
      const r = await mcpRequest(u, 'tools/list', {})
      setTools(Array.isArray(r?.tools) ? r.tools : [])
      setStatus('connected')
      setMcpUrlStorage(u)
    } catch (e) {
      setStatus('error'); setError(e.message || 'Connection failed'); setTools([])
    }
  }

  return (
    <SubPage title="MCP" onBack={onBack}>
      <div className="v-sec">MCP Server</div>
      <div className="v-card v-mcp">
        <div className="v-mcp-status"><i className={on ? 'on' : ''} />{on ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Not connected'}</div>
        <input className="v-field" value={url} onChange={e => setUrl(e.target.value)} disabled={on || status === 'connecting'} placeholder="https://your-mcp-server.com" />
        {status === 'error' && error && <div className="v-error">{error}</div>}
        <div className="v-mcp-actions">
          {on
            ? <button className="v-text-btn danger" onClick={() => { setStatus('idle'); setTools([]); setError('') }}>Disconnect</button>
            : <button className="v-btn" onClick={connect} disabled={!url.trim() || status === 'connecting'}>{status === 'connecting' ? 'Connecting…' : 'Connect'}</button>}
        </div>
      </div>
      {on && <>
        <div className="v-sec">Available Tools ({tools.length})</div>
        <div className="v-card v-rows">
          {tools.length === 0 && <div className="v-rows-item"><span className="v-mute">Server exposes no tools</span></div>}
          {tools.map(t => <div key={t.name} className="v-rows-item col"><code>{t.name}</code>{t.description && <span>{t.description}</span>}</div>)}
        </div>
      </>}
      <div className="v-sec">Integrations</div>
      <div className="v-card v-rows">
        {['HealthKit', 'Apple Calendar', 'Reminders'].map(n => <div key={n} className="v-rows-item"><span>{n}</span><em>Coming soon</em></div>)}
      </div>
    </SubPage>
  )
}
