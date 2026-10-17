import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppUpdateState, UpdateSettings } from './shared/appUpdates'

const AppUpdatesContext = createContext<{
  state: AppUpdateState | null
  check: () => Promise<void>
  configure: (settings: UpdateSettings) => Promise<void>
} | null>(null)

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const receive = (next: AppUpdateState) =>
    setState((previous) => (!previous || next.revision > previous.revision ? next : previous))
  useEffect(() => {
    let alive = true
    const receiveWhileMounted = (next: AppUpdateState) => {
      if (alive) receive(next)
    }
    // Subscribe first so a late initial snapshot cannot hide a completed startup check.
    const off = window.sheco.onUpdateState(receiveWhileMounted)
    void window.sheco
      .updateState()
      .then(receiveWhileMounted)
      .catch(() => {})
    return () => {
      alive = false
      off()
    }
  }, [])
  return (
    <AppUpdatesContext.Provider
      value={{
        state,
        check: async () => {
          await window.sheco.checkUpdates()
          receive(await window.sheco.updateState())
        },
        configure: async (settings) => receive(await window.sheco.configureUpdates(settings)),
      }}
    >
      {children}
    </AppUpdatesContext.Provider>
  )
}

export function useAppUpdates() {
  const context = useContext(AppUpdatesContext)
  if (!context) throw new Error('AppUpdateProvider is missing')
  return context
}
