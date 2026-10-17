import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { readStorage, writeStorage } from './storage.js'

// ---- Shared clock: one interval per period, shared by every subscriber ----
const clocks = new Map()
function subscribeClock(period, cb) {
  let clock = clocks.get(period)
  if (!clock) {
    clock = { subs: new Set(), now: Date.now(), timer: null }
    clock.timer = setInterval(() => {
      clock.now = Date.now()
      clock.subs.forEach((fn) => fn())
    }, period)
    clocks.set(period, clock)
  }
  clock.subs.add(cb)
  return () => {
    clock.subs.delete(cb)
    if (!clock.subs.size) {
      clearInterval(clock.timer)
      clocks.delete(period)
    }
  }
}

/** Re-render every `period` ms and return the current time (ms). Pass 0 to disable. */
export function useNow(period = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!period) return undefined
    return subscribeClock(period, () => setNow(clocks.get(period)?.now ?? Date.now()))
  }, [period])
  return now
}

export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => readStorage(key, initial))
  const update = useCallback(
    (next) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next
        writeStorage(key, v)
        return v
      })
    },
    [key],
  )
  return [value, update]
}

/** Width of an element, tracked with ResizeObserver. */
export function useElementWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w != null) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const subscribe = useCallback((cb) => {
    const mq = window.matchMedia?.(query)
    mq?.addEventListener?.('change', cb)
    return () => mq?.removeEventListener?.('change', cb)
  }, [])
  return useSyncExternalStore(subscribe, () => !!window.matchMedia?.(query).matches, () => false)
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Prompt2Prod` : 'Prompt2Prod — prompt → production'
  }, [title])
}

// ---- Voice input (Web Speech API) ----
const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
export const speechSupported = !!SpeechRecognition

/**
 * onTranscript(text, isFinal) is called with the running transcript of the
 * current utterance. Returns { supported, listening, start, stop, error }.
 */
export function useSpeechRecognition(onTranscript) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const recRef = useRef(null)
  const cbRef = useRef(onTranscript)
  cbRef.current = onTranscript

  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* already stopped */
    }
  }, [])

  const start = useCallback(() => {
    if (!SpeechRecognition) return
    setError(null)
    const rec = new SpeechRecognition()
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    rec.onresult = (event) => {
      let text = ''
      let final = false
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript
        if (event.results[i].isFinal) final = true
      }
      cbRef.current?.(text.trim(), final)
    }
    rec.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(event.error === 'not-allowed' ? 'Microphone access was blocked.' : `Voice input error: ${event.error}`)
      }
    }
    rec.onend = () => {
      setListening(false)
      recRef.current = null
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch (err) {
      setError(err?.message || 'Could not start voice input.')
    }
  }, [])

  useEffect(() => () => recRef.current?.abort?.(), [])

  return { supported: speechSupported, listening, start, stop, error }
}

/**
 * Keep a sticky column's height within the viewport: it fits below its
 * current top edge and grows to full height once docked.
 */
export function useFitToViewport(ref, { min = 300, gap = 16, max = 1000, enabled = true } = {}) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return undefined
    let raf = 0
    const update = () => {
      raf = 0
      if (getComputedStyle(el).position !== 'sticky') {
        el.style.height = ''
        return
      }
      const top = Math.max(el.getBoundingClientRect().top, 0)
      el.style.height = `${Math.round(Math.min(max, Math.max(min, window.innerHeight - top - gap)))}px`
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [ref, min, gap, max, enabled])
}
