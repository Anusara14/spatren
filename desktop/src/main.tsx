import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Same design tokens and components as the phone app, so both feel like one product.
import '../../src/styles.css'
import '../../src/ui.css'
import '../../src/theme.css'
import './desktop.css'
import App from './App'
import ErrorBoundary from './ErrorBoundary'

// Browser preview with sample data (dev server only, ?mock); release builds drop this branch entirely.
if (import.meta.env.DEV && location.search.includes('mock')) await import('./dev-mock')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
