// Unified diff parser (git and plain `diff -u` formats).
// Hunk bodies are consumed by their declared line counts, so content lines
// that happen to start with "---" or "diff" are never mistaken for headers.
// Truncated input (the backend caps diffs at ~150 KB) parses up to the cut.

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

function stripPrefix(p) {
  if (!p) return p
  const clean = p.replace(/\t.*$/, '').trim()
  if (clean === '/dev/null') return null
  return clean.replace(/^[ab]\//, '')
}

export function parseDiff(text) {
  if (!text || typeof text !== 'string') return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const files = []
  let file = null
  let hunk = null
  let oldLeft = 0
  let newLeft = 0
  let oldNo = 0
  let newNo = 0

  const newFile = (init = {}) => {
    file = {
      oldPath: null, newPath: null, status: 'M', binary: false,
      additions: 0, deletions: 0, hunks: [], ...init,
    }
    files.push(file)
    hunk = null
    return file
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Inside a hunk: consume exactly the declared number of lines.
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const tag = line[0]
      if (tag === '+') {
        hunk.lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) })
        file.additions++
        newLeft--
        continue
      }
      if (tag === '-') {
        hunk.lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) })
        file.deletions++
        oldLeft--
        continue
      }
      if (tag === ' ' || line === '') {
        // A blank line at the very end of truncated input is not content.
        if (line === '' && i === lines.length - 1) break
        hunk.lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) })
        oldLeft--
        newLeft--
        continue
      }
      if (tag === '\\') {
        hunk.lines.push({ type: 'meta', oldNo: null, newNo: null, text: line.slice(1).trim() })
        continue
      }
      // Malformed counts: fall through and treat as a header line.
      oldLeft = 0
      newLeft = 0
    }

    if (line.startsWith('\\') && hunk) {
      hunk.lines.push({ type: 'meta', oldNo: null, newNo: null, text: line.slice(1).trim() })
      continue
    }

    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/)
      newFile({ oldPath: m?.[1] ?? null, newPath: m?.[2] ?? null })
      continue
    }

    const hm = line.match(HUNK_RE)
    if (hm) {
      if (!file) newFile()
      oldNo = Number(hm[1])
      newNo = Number(hm[3])
      oldLeft = hm[2] === undefined ? 1 : Number(hm[2])
      newLeft = hm[4] === undefined ? 1 : Number(hm[4])
      hunk = { header: line, oldStart: oldNo, oldLines: oldLeft, newStart: newNo, newLines: newLeft, context: hm[5] || '', lines: [] }
      file.hunks.push(hunk)
      continue
    }

    if (line.startsWith('--- ')) {
      // Plain unified diffs have no "diff --git" line: start a new file when needed.
      if (!file || file.hunks.length) newFile()
      const p = stripPrefix(line.slice(4))
      file.oldPath = p
      if (p === null) file.status = 'A'
      hunk = null
      continue
    }
    if (line.startsWith('+++ ')) {
      if (!file) newFile()
      const p = stripPrefix(line.slice(4))
      file.newPath = p
      if (p === null) file.status = 'D'
      hunk = null
      continue
    }
    if (!file) continue
    if (line.startsWith('new file mode')) file.status = 'A'
    else if (line.startsWith('deleted file mode')) file.status = 'D'
    else if (line.startsWith('rename from ')) { file.status = 'R'; file.oldPath = line.slice(12) }
    else if (line.startsWith('rename to ')) { file.status = 'R'; file.newPath = line.slice(10) }
    else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true
  }

  for (const f of files) {
    f.path = (f.status === 'D' ? f.oldPath : f.newPath) || f.oldPath || f.newPath || 'unknown'
  }
  return files.filter((f) => f.hunks.length || f.binary || f.status !== 'M' || f.path !== 'unknown')
}

export function diffTotals(files) {
  return files.reduce(
    (acc, f) => ({ files: acc.files + 1, additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
    { files: 0, additions: 0, deletions: 0 },
  )
}

/** Five-block change bar like GitHub's (counts of add / del / neutral blocks). */
export function changeBlocks(additions, deletions, blocks = 5) {
  const total = additions + deletions
  if (!total) return { add: 0, del: 0, neutral: blocks }
  let add = Math.round((additions / total) * blocks)
  let del = Math.round((deletions / total) * blocks)
  if (additions && !add) add = 1
  if (deletions && !del) del = 1
  while (add + del > blocks) add > del ? add-- : del--
  return { add, del, neutral: blocks - add - del }
}
