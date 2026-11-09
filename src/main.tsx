import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './styles.css'
import './map.css'
import './ui.css'
import './theme.css'
import './lib/theme'
import App from './App'

registerSW({ immediate: true })

// iPhone Home-Screen apps (black-translucent status bar) report a viewport shorter than the screen, so
// bottom-anchored things stop ~a status bar early. Measure the shortfall; CSS stretches the map and tab bar over it.
if ((navigator as Navigator & { standalone?: boolean }).standalone) {
  const fit = () => {
    const full = innerWidth > innerHeight ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)
    const gap = Math.min(80, Math.max(0, full - innerHeight)) // ponytail: capped so a keyboard or odd value can't fling things off-screen
    document.documentElement.style.setProperty('--vh-gap', `${gap}px`)
  }
  fit()
  addEventListener('resize', fit)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
