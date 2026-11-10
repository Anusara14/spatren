import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Same design tokens and components as the phone app, so both feel like one product.
import '../../src/styles.css'
import '../../src/ui.css'
import '../../src/theme.css'
import './desktop.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
