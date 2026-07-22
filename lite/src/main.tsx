/// <reference path="./ambient.d.ts" />
import React from 'react'
import ReactDOM from 'react-dom/client'
// Reuse the desktop renderer's in-app prompt modal (Electron/browser both lack
// a usable window.prompt under some conditions; this is the same component the
// desktop tree CRUD uses).
import { PromptProvider } from '@app/renderer/src/common'
import App from './App'
import { applyFavicon } from './branding/icon'
import './app.css'

applyFavicon()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PromptProvider>
      <App />
    </PromptProvider>
  </React.StrictMode>
)
