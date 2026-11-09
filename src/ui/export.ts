export function csvCell(v: unknown): string {
  if (v == null) return ''
  let s = String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}` // stop spreadsheet formula injection from free-text answers
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
