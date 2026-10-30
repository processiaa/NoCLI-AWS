export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const val = bytes / Math.pow(1024, idx)
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`
}

export function formatRelativeOrShortDate(isoDate?: string): string {
  if (!isoDate) return '-'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '-'

  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMin >= 0 && diffMin < 1) return 'Hace un momento'
  if (diffMin >= 1 && diffMin < 60) return `Hace ${diffMin} min`
  if (diffHours >= 1 && diffHours < 24) return `Hace ${diffHours} h`
  if (diffDays === 1) return 'Ayer'
  if (diffDays > 1 && diffDays <= 7) return `Hace ${diffDays} dias`

  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatDaysAge(isoDate?: string): string {
  if (!isoDate) return '-'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '-'
  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
  if (diffDays === 0) return 'Hoy (< 24h)'
  if (diffDays === 1) return '1 dia'
  return `${diffDays} dias`
}

export function formatPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function parseCsvPreview(raw: string, maxRows = 60): string[][] {
  const lines = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, maxRows)

  return lines.map((line) => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if ((ch === ',' || ch === ';') && !inQuotes) {
        cells.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    cells.push(current.trim())
    return cells
  })
}

