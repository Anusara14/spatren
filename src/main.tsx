import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './styles.css'
import './map.css'
import './ui.css'
import './theme.css'
import './lib/theme'
import { IS_NATIVE, listenForAuthReturn } from './lib/native'
import App from './App'

// The Android app ships its files inside the APK; a service worker there would only serve stale copies.
if (IS_NATIVE) void listenForAuthReturn()
else registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
