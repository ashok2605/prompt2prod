// Renders text with http(s) URLs turned into links that open in a new tab.
const URL_RE = /(https?:\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?])/g

export function Linkify({ text }) {
  if (text == null) return null
  const s = String(text)
  const parts = s.split(URL_RE)
  if (parts.length === 1) return s
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="link">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

/** Inline `code` spans (markdown backticks) plus clickable URLs. */
export function RichText({ text }) {
  if (text == null) return null
  const parts = String(text).split(/(`[^`\n]+`)/g)
  if (parts.length === 1) return <Linkify text={text} />
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="code-inline">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Linkify key={i} text={part} />
    ),
  )
}
