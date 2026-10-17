import React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceProvider } from './state'
import { App } from './App'
import './styles.css'
import { LanguageProvider } from './i18n'
import { AppUpdateProvider } from './appUpdates'
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    return this.state.error ? (
      <div className="boot-error">
        <h1>The editor encountered an error.</h1>
        <p>Saved documents are preserved in your workspace folder.</p>
        <pre>{this.state.error}</pre>
        <button onClick={() => location.reload()}>Reload editor</button>
      </div>
    ) : (
      this.props.children
    )
  }
}
createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <ErrorBoundary>
      <WorkspaceProvider>
        <AppUpdateProvider>
          <App />
        </AppUpdateProvider>
      </WorkspaceProvider>
    </ErrorBoundary>
  </LanguageProvider>,
)
