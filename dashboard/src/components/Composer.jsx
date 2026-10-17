import { FolderGit2, Mic, Rocket, Shield, Sparkles, Square, UserRound, Zap } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useBackend } from '../lib/backend.jsx'
import { friendlyError } from '../lib/errors.js'
import { EXAMPLE_PROMPTS } from '../lib/examples.js'
import { isMac } from '../lib/format.js'
import { useLocalStorage, useSpeechRecognition } from '../lib/hooks.js'
import { navigate, taskHref } from '../lib/router.js'
import { Spinner } from './Misc.jsx'
import { useToast } from './Toasts.jsx'

const MODES = [
  { key: 'autopilot', label: 'Autopilot', icon: Zap, desc: 'Auto-release when all gates pass' },
  { key: 'approval', label: 'Approval', icon: Shield, desc: 'Wait for my approval' },
]

export function Composer() {
  const { backend, projects, name, setName, requester } = useBackend()
  const toast = useToast()
  const [prompt, setPrompt] = useState('')
  const [source, setSource] = useState('dashboard')
  const [mode, setMode] = useLocalStorage('p2p-mode', 'autopilot')
  const [projectId, setProjectId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef(null)
  const baseRef = useRef('')

  const speech = useSpeechRecognition((text) => {
    const base = baseRef.current
    setPrompt(base ? `${base} ${text}` : text)
    setSource('voice')
  })

  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0].id)
  }, [projects, projectId])

  useEffect(() => {
    if (speech.error) toast({ tone: 'warning', title: 'Voice input', message: speech.error })
  }, [speech.error, toast])

  // Auto-grow the textarea with its content.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [prompt])

  const toggleMic = () => {
    if (speech.listening) return speech.stop()
    baseRef.current = prompt.trim()
    speech.start()
  }

  const useExample = (ex) => {
    setPrompt(ex.prompt)
    setSource('dashboard')
    textareaRef.current?.focus()
  }

  const submit = async () => {
    const text = prompt.trim()
    if (!text || submitting || !backend) return
    if (speech.listening) speech.stop()
    setSubmitting(true)
    try {
      const res = await backend.createTask({ projectId: projectId || projects[0]?.id, prompt: text, mode, source, requesterName: requester })
      toast({ tone: 'good', title: 'Mission launched', message: `Task ${res.id} is queued — the crew is on it.` })
      setPrompt('')
      setSource('dashboard')
      navigate(taskHref(res.id))
    } catch (err) {
      toast({ tone: 'critical', title: err?.status === 429 ? 'Slow down a little' : 'Could not start the task', message: friendlyError(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const onModeKey = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = mode === 'autopilot' ? 'approval' : 'autopilot'
    setMode(next)
    document.getElementById(`mode-${next}`)?.focus()
  }

  const activeMode = MODES.find((m) => m.key === mode) || MODES[0]

  return (
    <section className="composer card" aria-labelledby="composer-title">
      <div className="composer-head">
        <span className="eyebrow eyebrow-accent">
          <Sparkles size={13} aria-hidden="true" />
          5 Gemini agents · Google ADK · Cloud Run
        </span>
        <h1 id="composer-title">What should your AI crew ship next?</h1>
        <p className="composer-sub">
          Describe a change in plain English. The crew plans it, writes tests first, implements, reviews, builds, deploys a live preview, verifies it —
          and releases to production.
        </p>
      </div>

      <div className={`composer-input${speech.listening ? ' is-listening' : ''}`}>
        <label htmlFor="composer-prompt" className="sr-only">
          Change request
        </label>
        <textarea
          id="composer-prompt"
          ref={textareaRef}
          value={prompt}
          rows={3}
          maxLength={4000}
          placeholder="e.g. Add a priority field to tasks with colored badges and API validation…"
          onChange={(e) => {
            setPrompt(e.target.value)
            if (!e.target.value.trim()) setSource('dashboard')
          }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-input-foot">
          {speech.listening ? (
            <span className="listening" role="status">
              <span className="rec-dot" aria-hidden="true" /> Listening… speak your change
            </span>
          ) : source === 'voice' ? (
            <span className="chip chip-xs tone-info">
              <Mic size={11} aria-hidden="true" /> From voice
            </span>
          ) : (
            <span className="composer-hint">
              <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
              <kbd>↵</kbd> to ship
            </span>
          )}
          {speech.supported && (
            <button
              type="button"
              className={`mic-btn${speech.listening ? ' is-on' : ''}`}
              onClick={toggleMic}
              aria-pressed={speech.listening}
              aria-label={speech.listening ? 'Stop voice input' : 'Speak your request'}
              title={speech.listening ? 'Stop voice input' : 'Speak your request'}
            >
              {speech.listening ? <Square size={14} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>

      <div className="composer-examples" aria-label="Example requests">
        <span className="composer-examples-label">Try</span>
        {EXAMPLE_PROMPTS.map((ex) => (
          <button key={ex.label} type="button" className="example-chip" title={ex.prompt} onClick={() => useExample(ex)}>
            <Sparkles size={12} aria-hidden="true" />
            {ex.label}
          </button>
        ))}
      </div>

      <div className="composer-controls">
        <label className="field">
          <span className="field-label">
            <FolderGit2 size={13} aria-hidden="true" /> Project
          </span>
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects.length}>
            {!projects.length && <option value="">Loading…</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label" id="mode-label">
            Release mode
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="mode-label" onKeyDown={onModeKey}>
            {MODES.map((m) => {
              const Icon = m.icon
              const on = mode === m.key
              return (
                <button
                  key={m.key}
                  id={`mode-${m.key}`}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className={`segment${on ? ' is-on' : ''}${m.key === 'autopilot' ? ' segment-accent' : ''}`}
                  onClick={() => setMode(m.key)}
                  title={m.desc}
                >
                  <Icon size={14} aria-hidden="true" />
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>

        <label className="field field-name">
          <span className="field-label">
            <UserRound size={13} aria-hidden="true" /> Your name
          </span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. Ashok"
            maxLength={40}
            autoComplete="name"
          />
        </label>

        <div className="composer-submit">
          <span className="mode-desc">{activeMode.desc}</span>
          <button type="button" className="btn btn-primary btn-lg" onClick={submit} disabled={!prompt.trim() || submitting || !backend}>
            {submitting ? <Spinner size={17} /> : <Rocket size={17} aria-hidden="true" />}
            Ship it
          </button>
        </div>
      </div>
    </section>
  )
}
