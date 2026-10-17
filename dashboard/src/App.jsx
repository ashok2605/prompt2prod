import { CloudOff, Compass, RotateCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { LogoMark } from './components/Logo.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { EmptyState } from './components/Misc.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { ToastProvider, useToast } from './components/Toasts.jsx'
import { BackendProvider, useBackend } from './lib/backend.jsx'
import { useHashRoute } from './lib/router.js'
import { CommandCenter } from './pages/CommandCenter.jsx'
import { Insights } from './pages/Insights.jsx'
import { Integrations } from './pages/Integrations.jsx'
import { Releases } from './pages/Releases.jsx'
import { TaskPage } from './pages/TaskPage.jsx'

function BootScreen() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <LogoMark size={44} />
      <div className="boot-text">Connecting to mission control…</div>
      <div className="boot-bar" aria-hidden="true" />
    </div>
  )
}

function BootError({ error, onRetry, onDemo }) {
  return (
    <div className="boot">
      <div className="card boot-card">
        <EmptyState
          icon={CloudOff}
          title="Couldn’t connect to Firebase"
          action={
            <div className="row-gap">
              <button type="button" className="btn btn-sm" onClick={onRetry}>
                <RotateCw size={14} aria-hidden="true" /> Retry
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={onDemo}>
                Explore with demo data
              </button>
            </div>
          }
        >
          {error?.message || 'Anonymous sign-in or Firestore initialisation failed.'}
        </EmptyState>
      </div>
    </div>
  )
}

function Routes({ route }) {
  switch (route.name) {
    case 'home':
      return <CommandCenter />
    case 'task':
      return <TaskPage key={route.id} id={route.id} tab={route.tab} />
    case 'releases':
      return <Releases />
    case 'insights':
      return <Insights />
    case 'integrations':
      return <Integrations />
    default:
      return (
        <div className="page">
          <div className="card">
            <EmptyState icon={Compass} title="Page not found" action={<a className="btn btn-sm" href="#/">Go to Command Center</a>}>
              Nothing lives at <span className="mono">{route.path}</span>.
            </EmptyState>
          </div>
        </div>
      )
  }
}

function Shell() {
  const route = useHashRoute()
  const { phase, error, restart, startDemo, mode, reason } = useBackend()
  const toast = useToast()
  const mainRef = useRef(null)
  const routeKey = `${route.name}:${route.id || ''}`

  useEffect(() => {
    window.scrollTo({ top: 0 })
    mainRef.current?.focus({ preventScroll: true })
  }, [routeKey])

  useEffect(() => {
    if (mode === 'mock' && reason === 'unreachable') {
      toast({ tone: 'info', title: 'Offline demo', message: 'The API is unreachable, so you are exploring simulated data.', duration: 6000 })
    }
  }, [mode, reason, toast])

  if (phase === 'loading') return <BootScreen />
  if (phase === 'error') return <BootError error={error} onRetry={() => restart()} onDemo={startDemo} />

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar route={route} />
      <main id="main" className="main" ref={mainRef} tabIndex={-1}>
        <div className="main-inner">
          <ErrorBoundary resetKey={routeKey}>
            <Routes route={route} />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <BackendProvider>
        <Shell />
      </BackendProvider>
    </ToastProvider>
  )
}
