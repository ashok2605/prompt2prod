// Data provider. Boots into one of two backends with the same interface:
//  • live — GET /api/config → Firebase (anonymous auth) → Firestore listeners,
//           writes via the REST API with the Firebase ID token;
//  • mock — offline simulated backend (when /api/config fails or ?mock=1).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchConfig } from './api.js'
import { readStorage, writeStorage } from './storage.js'

const BackendContext = createContext(null)

const urlParams = () => `${window.location.search}&${window.location.hash.split('?')[1] || ''}`
export const mockRequested = () => /(?:^|[?&])mock=(?:1|true)(?:&|$)/.test(urlParams())
const speedParam = () => Number(urlParams().match(/(?:^|[?&])speed=([\d.]+)/)?.[1]) || 1

export function BackendProvider({ children }) {
  const [boot, setBoot] = useState({ phase: 'loading', backend: null, mode: null, reason: null, error: null })
  const [projects, setProjects] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [tasksError, setTasksError] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [user, setUser] = useState(null)
  const [name, setNameState] = useState(() => readStorage('p2p-name', '') || '')

  const runRef = useRef(0)
  const start = useCallback(async ({ forceMock = false } = {}) => {
    const run = ++runRef.current
    const current = () => run === runRef.current
    setBoot((b) => ({ ...b, phase: 'loading', error: null }))
    setProjects(null)
    setTasks(null)
    let config = null
    const wantMock = forceMock || mockRequested()
    if (!wantMock) {
      try {
        config = await fetchConfig()
      } catch (err) {
        console.info('[prompt2prod] API unavailable, starting offline demo:', err?.message || err)
      }
    }
    if (!config) {
      const { createMockBackend } = await import('./mock.js')
      if (!current()) return
      const backend = createMockBackend({ speed: speedParam() })
      setBoot({ phase: 'ready', backend, mode: 'mock', reason: wantMock ? 'requested' : 'unreachable', error: null })
      return
    }
    try {
      const { createLiveBackend } = await import('./firebase.js')
      const backend = await createLiveBackend(config)
      if (!current()) return
      setBoot({ phase: 'ready', backend, mode: 'live', reason: null, error: null })
    } catch (err) {
      console.error('[prompt2prod] Firebase init failed', err)
      if (!current()) return
      setBoot({ phase: 'error', backend: null, mode: 'live', reason: null, error: err })
    }
  }, [])

  useEffect(() => {
    start()
  }, [start])

  useEffect(() => {
    const backend = boot.backend
    if (!backend) return undefined
    setConnection(backend.mode === 'mock' ? 'demo' : backend.connection)
    setUser(backend.user)
    const offs = [
      backend.subscribeProjects(setProjects, (err) => console.warn('[prompt2prod] projects listener', err)),
      backend.subscribeTasks(
        (list) => {
          setTasks(list)
          setTasksError(null)
        },
        (err) => setTasksError(err),
      ),
      backend.onConnectionChange?.(setConnection),
      backend.onAuthChange?.(setUser),
    ]
    return () => offs.forEach((off) => typeof off === 'function' && off())
  }, [boot.backend])

  useEffect(() => {
    boot.backend?.setIdentity?.(name)
  }, [boot.backend, name])

  const setName = useCallback((value) => {
    const v = String(value ?? '').slice(0, 40)
    setNameState(v)
    writeStorage('p2p-name', v.trim() ? v : null)
  }, [])

  const value = useMemo(
    () => ({
      ...boot,
      restart: start,
      startDemo: () => start({ forceMock: true }),
      config: boot.backend?.config ?? null,
      projects: projects ?? boot.backend?.config?.projects ?? [],
      projectsLoaded: projects != null,
      tasks: tasks ?? [],
      tasksLoaded: tasks != null,
      tasksError,
      connection,
      user,
      name,
      setName,
      requester: name.trim() || undefined,
    }),
    [boot, start, projects, tasks, tasksError, connection, user, name, setName],
  )

  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
}

export function useBackend() {
  const ctx = useContext(BackendContext)
  if (!ctx) throw new Error('useBackend must be used inside <BackendProvider>')
  return ctx
}

/** Live task document. task: undefined = loading, null = not found. */
export function useTask(id) {
  const { backend } = useBackend()
  const [state, setState] = useState({ id, task: undefined, error: null })
  useEffect(() => {
    if (!backend || !id) return undefined
    setState({ id, task: undefined, error: null })
    return backend.subscribeTask(
      id,
      (task) => setState({ id, task, error: null }),
      (error) => setState((s) => ({ ...s, error })),
    )
  }, [backend, id])
  return state.id === id ? state : { id, task: undefined, error: null }
}

/** Live agent log for a task (ordered by seq). */
export function useTaskEvents(id) {
  const { backend } = useBackend()
  const [state, setState] = useState({ id, events: [], loaded: false, error: null })
  useEffect(() => {
    if (!backend || !id) return undefined
    setState({ id, events: [], loaded: false, error: null })
    return backend.subscribeEvents(
      id,
      (events) => setState({ id, events: [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), loaded: true, error: null }),
      (error) => setState((s) => ({ ...s, loaded: true, error })),
    )
  }, [backend, id])
  return state.id === id ? state : { id, events: [], loaded: false, error: null }
}
