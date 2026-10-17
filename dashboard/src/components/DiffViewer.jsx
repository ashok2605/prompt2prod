import { ChevronRight, FileDiff, FoldVertical, UnfoldVertical } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { changeBlocks, diffTotals, parseDiff } from '../lib/diff.js'
import { FileStatusChip } from './Chips.jsx'

const SIGN = { add: '+', del: '−', ctx: ' ', meta: '' }

function DiffFile({ file, open, onToggle }) {
  const blocks = changeBlocks(file.additions, file.deletions)
  const slash = file.path.lastIndexOf('/')
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const base = file.path.slice(slash + 1)
  return (
    <section className="diff-file">
      <button type="button" className="diff-file-head" aria-expanded={open} onClick={onToggle}>
        <ChevronRight size={15} className="chev" aria-hidden="true" />
        <FileStatusChip status={file.status} />
        <span className="diff-path" title={file.path}>
          {dir && <span className="diff-dir">{dir}</span>}
          <span className="diff-base">{base}</span>
          {file.status === 'R' && file.oldPath && <span className="diff-dir"> ← {file.oldPath}</span>}
        </span>
        <span className="diff-file-stats">
          <span className="add">+{file.additions}</span>
          <span className="del">−{file.deletions}</span>
          <span className="blocks" aria-hidden="true">
            {Array.from({ length: blocks.add }, (_, i) => <i key={`a${i}`} className="b-add" />)}
            {Array.from({ length: blocks.del }, (_, i) => <i key={`d${i}`} className="b-del" />)}
            {Array.from({ length: blocks.neutral }, (_, i) => <i key={`n${i}`} />)}
          </span>
        </span>
      </button>
      {open && (
        <div className="diff-body">
          {file.binary && !file.hunks.length ? (
            <div className="diff-note">Binary file — not shown.</div>
          ) : (
            <table className="diff-table">
              <tbody>
                {file.hunks.map((h, hi) => (
                  <Fragment key={hi}>
                    <tr className="diff-hunk">
                      <td className="ln" aria-hidden="true" />
                      <td className="ln" aria-hidden="true" />
                      <td className="code">{h.header}</td>
                    </tr>
                    {h.lines.map((l, li) => (
                      <tr key={li} className={`diff-line is-${l.type}`}>
                        <td className="ln" data-ln={l.oldNo ?? ''} aria-hidden="true" />
                        <td className="ln" data-ln={l.newNo ?? ''} aria-hidden="true" />
                        <td className="code">
                          <span className="sign" aria-hidden="true">
                            {SIGN[l.type]}
                          </span>
                          {l.type === 'meta' ? `\\ ${l.text}` : l.text || ' '}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}

export function DiffViewer({ diff }) {
  const files = useMemo(() => parseDiff(diff), [diff])
  const totals = diffTotals(files)
  const lineCount = files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.length, 0), 0)
  const [closed, setClosed] = useState(() => new Set(lineCount > 1500 ? files.map((_, i) => i).filter((i) => i >= 3) : []))
  const truncated = typeof diff === 'string' && (diff.length >= 140_000 || /\n?\[?truncated\]?\s*$/i.test(diff))

  const toggle = (i) =>
    setClosed((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  return (
    <div className="diff">
      <div className="diff-toolbar">
        <span className="diff-summary">
          <FileDiff size={15} aria-hidden="true" />
          {totals.files} {totals.files === 1 ? 'file' : 'files'} changed
          <span className="add">+{totals.additions}</span>
          <span className="del">−{totals.deletions}</span>
        </span>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setClosed(new Set())}>
          <UnfoldVertical size={13} aria-hidden="true" /> Expand all
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setClosed(new Set(files.map((_, i) => i)))}>
          <FoldVertical size={13} aria-hidden="true" /> Collapse all
        </button>
      </div>
      {truncated && <div className="callout tone-warning">This diff was truncated by the backend (~150 KB limit); the last file may be incomplete.</div>}
      {files.map((f, i) => (
        <DiffFile key={`${f.path}-${i}`} file={f} open={!closed.has(i)} onToggle={() => toggle(i)} />
      ))}
    </div>
  )
}
