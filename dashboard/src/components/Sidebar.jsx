import { ChartColumnBig, Database, History, Hourglass, LayoutDashboard, Plug } from 'lucide-react'
import { useBackend } from '../lib/backend.jsx'
import { isActive } from '../lib/pipeline.js'
import { taskHref } from '../lib/router.js'
import { Avatar } from './Chips.jsx'
import { Logo } from './Logo.jsx'
import { ThemeToggle } from './Misc.jsx'

const NAV = [
  { href: '#/', label: 'Command Center', icon: LayoutDashboard, routes: ['home', 'task'] },
  { href: '#/releases', label: 'Releases', icon: History, routes: ['releases'] },
  { href: '#/insights', label: 'Insights', icon: ChartColumnBig, routes: ['insights'] },
  { href: '#/integrations', label: 'Integrations', icon: Plug, routes: ['integrations'] },
]

const CONNECTION = {
  live: { tone: 'good', label: 'Live · Firestore' },
  connecting: { tone: 'warning', label: 'Connecting…' },
  offline: { tone: 'critical', label: 'Offline' },
  error: { tone: 'critical', label: 'Connection error' },
  demo: { tone: 'info', label: 'Offline demo' },
}

export function Sidebar({ route }) {
  const { tasks, mode, connection, name, user } = useBackend()
  const running = tasks.filter(isActive)
  const awaiting = tasks.filter((t) => t.status === 'awaiting_approval')
  const conn = CONNECTION[connection] || CONNECTION.connecting
  const runningHref = running.length === 1 ? taskHref(running[0].id) : '#/'

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Logo />
        {mode === 'mock' && (
          <span className="demo-badge" title="Running offline on simulated data">
            <Database size={11} aria-hidden="true" /> Demo data
          </span>
        )}
      </div>

      <nav className="nav" aria-label="Main">
        {NAV.map((item) => {
          const Icon = item.icon
          const current = item.routes.includes(route.name)
          return (
            <a key={item.href} href={item.href} className={`nav-item${current ? ' is-current' : ''}`} aria-current={current ? 'page' : undefined}>
              <Icon size={17} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          )
        })}
      </nav>

      <div className="sidebar-status">
        <a className={`running-pill${running.length ? ' is-running' : ''}`} href={runningHref}>
          {running.length ? <span className="live-dot" aria-hidden="true" /> : <span className="idle-dot" aria-hidden="true" />}
          <span>{running.length ? `${running.length} running` : 'Crew idle'}</span>
        </a>
        {awaiting.length > 0 && (
          <a className="awaiting-pill" href={taskHref(awaiting[0].id)}>
            <Hourglass size={13} aria-hidden="true" />
            <span>{awaiting.length} awaiting approval</span>
          </a>
        )}
      </div>

      <div className="sidebar-foot">
        <div className="user-block">
          <Avatar name={name || 'Anonymous'} size={30} />
          <div className="user-text">
            <span className="user-name">{name || 'Anonymous'}</span>
            <span className={`conn tone-${conn.tone}`} title={user?.uid ? `Firebase uid ${user.uid}` : undefined}>
              <span className="conn-dot" aria-hidden="true" />
              {conn.label}
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  )
}
