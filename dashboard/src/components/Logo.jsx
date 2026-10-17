import { useId } from 'react'

export function LogoMark({ size = 30 }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.55" stopColor="#9b72f2" />
          <stop offset="1" stopColor="#e8579d" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#g${id})`} />
      <path d="M9.5 10.5 15 16l-5.5 5.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21.5h6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <a href="#/" className="brand" aria-label="Prompt2Prod — Command Center">
      <LogoMark />
      <span className="brand-text">
        <span className="brand-name">
          Prompt<span className="brand-2">2</span>Prod
        </span>
        <span className="brand-tag">prompt → production</span>
      </span>
    </a>
  )
}
