// Offline demo only: a small LCS line diff that renders git-style unified
// diffs, so simulated changes always produce internally consistent hunks.

export function hashHex(str, len = 7) {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
  return hex.repeat(Math.ceil(len / 16)).slice(0, len)
}

const toLines = (text) => (text == null ? [] : text.replace(/\n$/, '').split('\n'))

function lineOps(a, b) {
  const n = a.length
  const m = b.length
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', s: a[i] })
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      ops.push({ t: '-', s: a[i++] })
    } else {
      ops.push({ t: '+', s: b[j++] })
    }
  }
  while (i < n) ops.push({ t: '-', s: a[i++] })
  while (j < m) ops.push({ t: '+', s: b[j++] })
  return compact(ops)
}

// Slide a change run upwards over identical context lines, but only when that
// joins it to the change above (like git's slider heuristics): avoids the
// "+x / ' ' / +blank" split that plain LCS produces around blank lines.
function compact(ops) {
  for (let s = 1; s < ops.length; s++) {
    if (ops[s].t === ' ' || ops[s - 1].t !== ' ') continue
    let e = s
    while (e < ops.length && ops[e].t === ops[s].t) e++
    let k = 0
    while (s - k - 1 >= 0 && ops[s - k - 1].t === ' ' && ops[s - k - 1].s === ops[e - k - 1].s) k++
    if (k && s - k - 1 >= 0 && ops[s - k - 1].t !== ' ') {
      const t = ops[s].t
      for (let x = s - k; x < e; x++) ops[x] = { t: x < e - k ? t : ' ', s: ops[x].s }
    }
    s = e - 1
  }
  return ops
}

const FUNC_RE = /^[A-Za-z_$]/
const range = (start, count) => (count === 1 ? `${start}` : `${start},${count}`)

function hunks(oldLines, ops, context = 3) {
  let o = 1
  let n = 1
  const rows = ops.map((op) => {
    const row = { ...op, o: op.t !== '+' ? o : null, n: op.t !== '-' ? n : null, oBefore: o, nBefore: n }
    if (op.t !== '+') o++
    if (op.t !== '-') n++
    return row
  })
  const changes = rows.map((r, i) => (r.t === ' ' ? -1 : i)).filter((i) => i >= 0)
  if (!changes.length) return []
  const groups = []
  let start = Math.max(0, changes[0] - context)
  let end = Math.min(rows.length - 1, changes[0] + context)
  for (const ci of changes.slice(1)) {
    if (ci - context <= end + 1) end = Math.min(rows.length - 1, ci + context)
    else {
      groups.push([start, end])
      start = Math.max(0, ci - context)
      end = Math.min(rows.length - 1, ci + context)
    }
  }
  groups.push([start, end])

  return groups.map(([s, e]) => {
    const slice = rows.slice(s, e + 1)
    const oldCount = slice.filter((r) => r.t !== '+').length
    const newCount = slice.filter((r) => r.t !== '-').length
    const oldStart = oldCount ? slice.find((r) => r.t !== '+').o : slice[0].oBefore - 1
    const newStart = newCount ? slice.find((r) => r.t !== '-').n : slice[0].nBefore - 1
    let fn = ''
    for (let k = slice[0].oBefore - 2; k >= 0; k--) {
      if (FUNC_RE.test(oldLines[k] || '')) {
        fn = oldLines[k].slice(0, 72)
        break
      }
    }
    const header = `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@${fn ? ` ${fn}` : ''}`
    return [header, ...slice.map((r) => `${r.t}${r.s}`)].join('\n')
  })
}

/** git-style diff for one file; `before`/`after` null = added/deleted file. */
export function fileDiff(path, before, after) {
  const a = toLines(before)
  const b = toLines(after)
  const oldSha = before == null ? '0000000' : hashHex(`${path}:${before}`)
  const newSha = after == null ? '0000000' : hashHex(`${path}:${after}`)
  const head = [`diff --git a/${path} b/${path}`]
  if (before == null) head.push('new file mode 100644', `index ${oldSha}..${newSha}`, '--- /dev/null', `+++ b/${path}`)
  else if (after == null) head.push('deleted file mode 100644', `index ${oldSha}..${newSha}`, `--- a/${path}`, '+++ /dev/null')
  else head.push(`index ${oldSha}..${newSha} 100644`, `--- a/${path}`, `+++ b/${path}`)
  const body = hunks(a, lineOps(a, b))
  if (!body.length) return ''
  return `${head.join('\n')}\n${body.join('\n')}\n`
}
