import type { ApiCatalogItemDetails } from '@/lib/api'

const PORT_COUNT_CAP = 16

function toNumberFromText(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? Math.floor(value) : null
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = raw.match(/\d+/)
  if (!match) return null
  const parsed = Number(match[0])
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function clampCount(count: number): number {
  return Math.max(0, Math.min(PORT_COUNT_CAP, count))
}

function normalizeTagToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-+]/g, '')
}

export function buildPortsFromCatalog(item: ApiCatalogItemDetails): Array<{
  label: string
  type: 'Input' | 'Output' | 'Other'
  patchbayId: null
}> {
  const specs = item.specs || {}
  const inputCount = clampCount(toNumberFromText(specs['Number of Inputs']) || 0)
  const outputCount = clampCount(toNumberFromText(specs['Number of Outputs']) || 0)
  const ports: Array<{ label: string; type: 'Input' | 'Output' | 'Other'; patchbayId: null }> = []

  for (let i = 1; i <= inputCount; i += 1) {
    ports.push({ label: `Input ${i}`, type: 'Input', patchbayId: null })
  }
  for (let i = 1; i <= outputCount; i += 1) {
    ports.push({ label: `Output ${i}`, type: 'Output', patchbayId: null })
  }

  return ports
}

export function extractCatalogTags(item: ApiCatalogItemDetails): string[] {
  const specs = item.specs || {}
  const tags = new Set<string>()

  const condition = normalizeTagToken(specs['Condition'])
  if (condition) tags.add(`condition:${condition}`)

  const connectivity = normalizeTagToken(specs['Connectivity'])
  if (connectivity) tags.add(`connectivity:${connectivity}`)

  const sampleRate = normalizeTagToken(specs['Sample Rate'])
  if (sampleRate) tags.add(`sample-rate:${sampleRate}`)

  const phantom = normalizeTagToken(specs['Phantom Power'])
  if (phantom === 'yes' || phantom === 'true') tags.add('phantom-power')
  if (phantom === 'no' || phantom === 'false') tags.add('no-phantom-power')

  return Array.from(tags)
}
