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
if (IS_NATIVE) {
  // Tell the updater this bundle started fine (else it rolls back to the previous one), then look for updates.
  void import('@capgo/capacitor-updater').then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady())
  void listenForAuthReturn()
  void import('./lib/updates').then((u) => u.startUpdates())
} else registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
