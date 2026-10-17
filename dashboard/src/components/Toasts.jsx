import { CircleCheck, Info, TriangleAlert, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(() => {})
const ICONS = { good: CircleCheck, info: Info, warning: TriangleAlert, critical: XCircle }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    ({ tone = 'info', title, message, duration = 5000 }) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((list) => [...list.slice(-3), { id, tone, title, message }])
      if (duration) timers.current.set(id, setTimeout(() => dismiss(id), duration))
      return id
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone] || Info
          return (
            <div key={t.id} className={`toast tone-${t.tone}`} role={t.tone === 'critical' ? 'alert' : 'status'}>
              <Icon className="toast-icon" size={18} aria-hidden="true" />
              <div className="toast-body">
                {t.title && <div className="toast-title">{t.title}</div>}
                {t.message && <div className="toast-message">{t.message}</div>}
              </div>
              <button type="button" className="btn btn-ghost btn-icon btn-xs" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
