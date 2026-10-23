import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VesperApp from './vesper/VesperApp.jsx'
import { useSkin } from './skin.js'

// 按设置里选的皮肤决定整个 App 用哪一套：Clawd（原来的 App.jsx）或 Vesper
function Root() {
  return useSkin() === 'vesper' ? <VesperApp /> : <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
