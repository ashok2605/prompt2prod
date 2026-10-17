// REST client for the Prompt2Prod API (docs/SPEC.md → "REST API").
// Same-origin by default: FastAPI serves the built dashboard at `/`.

import { ApiError, detailMessage } from './errors.js'

export { ApiError, detailMessage, friendlyError } from './errors.js'

export const API_BASE = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

/** GET /api/config — resolves to the config, or throws if the API is unavailable. */
export async function fetchConfig({ timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}/api/config`, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new ApiError(res.status, `GET /api/config → ${res.status}`)
    const type = res.headers.get('content-type') || ''
    if (!type.includes('json')) throw new ApiError(res.status, 'GET /api/config did not return JSON')
    const config = await res.json()
    if (!config?.firebase?.apiKey || !config?.firebase?.projectId) throw new ApiError(500, 'Config is missing Firebase settings')
    return config
  } finally {
    clearTimeout(timer)
  }
}

/** HTTP header values must be Latin-1; anything else is sent URI-encoded. */
function requesterHeader(name) {
  const v = String(name || '').trim().slice(0, 60)
  if (!v) return {}
  return { 'X-Requester-Name': /^[\x20-\x7e]*$/.test(v) ? v : encodeURIComponent(v) }
}

/** Write client. `getToken` returns a Firebase ID token (anonymous auth is fine). */
export function createRestClient(getToken) {
  async function request(method, path, { body, requester } = {}) {
    const headers = { Accept: 'application/json', ...requesterHeader(requester) }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const token = await getToken?.()
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) throw new ApiError(res.status, detailMessage(data) || `${method} ${path} → ${res.status}`, data)
    return data
  }

  const enc = encodeURIComponent
  const action = (path) => (id, requester) => request('POST', path(enc(id)), { requester })
  return {
    createTask: ({ projectId, prompt, mode, source, requesterName }) =>
      request('POST', '/api/tasks', { body: { projectId, prompt, mode, source, requesterName }, requester: requesterName }),
    // Action endpoints take no body; the display name travels in X-Requester-Name.
    approve: action((id) => `/api/tasks/${id}/approve`),
    reject: action((id) => `/api/tasks/${id}/reject`),
    rollback: action((id) => `/api/tasks/${id}/rollback`),
    retry: action((id) => `/api/tasks/${id}/retry`),
    cancel: action((id) => `/api/tasks/${id}/cancel`),
    resetProject: action((id) => `/api/projects/${id}/reset`),
  }
}

export function apiOrigin() {
  if (/^https?:\/\//i.test(API_BASE)) return API_BASE
  if (typeof window === 'undefined') return API_BASE
  return `${window.location.origin}${API_BASE}`
}
