// Minimal hash router: #/ · #/task/:id(/:tab) · #/releases · #/insights · #/integrations
import { useSyncExternalStore } from 'react'

export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/'
  const path = raw.split('?')[0].replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'home' }
  const task = path.match(/^\/task\/([\w-]+)(?:\/([\w-]+))?$/)
  if (task) return { name: 'task', id: task[1], tab: task[2] || null }
  if (path === '/releases') return { name: 'releases' }
  if (path === '/insights') return { name: 'insights' }
  if (path === '/integrations') return { name: 'integrations' }
  return { name: 'notfound', path }
}

const subscribe = (cb) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useHashRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  return parseHash(hash)
}

export function navigate(to) {
  const target = to.startsWith('#') ? to : `#${to}`
  if (window.location.hash === target) return
  window.location.hash = target
}

export const taskHref = (id, tab) => `#/task/${encodeURIComponent(id)}${tab ? `/${tab}` : ''}`
