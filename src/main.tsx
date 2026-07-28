import React from 'react'
import ReactDOM from 'react-dom/client'
// Reuse the desktop renderer's in-app prompt modal (Electron/browser both lack
// a usable window.prompt under some conditions; this is the same component the
// desktop tree CRUD uses).
import { PromptProvider } from '@/common/prompt'
import ArisApp from './ArisApp'
import { applyFavicon } from './branding/icon'
import './app.css'

applyFavicon()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PromptProvider>
      <ArisApp />
    </PromptProvider>
  </React.StrictMode>
)
