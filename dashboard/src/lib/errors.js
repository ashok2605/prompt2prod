// Error helpers shared by the REST client and the offline demo backend.

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

/** FastAPI errors are `{detail: "msg"}`; validation errors use `{detail: [{msg}]}`. */
export function detailMessage(data) {
  const d = data?.detail ?? data?.message ?? data?.error
  if (!d) return null
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ')
  return typeof d === 'object' ? JSON.stringify(d) : String(d)
}

export function friendlyError(err) {
  if (!err) return 'Something went wrong'
  if (err.name === 'TypeError' && !err.status) return 'Network error — is the API reachable?'
  if ((err.status === 401 || err.status === 403) && !err.message) return 'Not signed in — reload the page to reconnect.'
  if (err.status === 429 && !err.message) return 'Rate limit reached — give the crew a minute and try again.'
  return err.message || 'Something went wrong'
}
