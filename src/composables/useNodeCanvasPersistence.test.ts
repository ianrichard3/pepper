import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNodeCanvasPersistence } from '@/composables/useNodeCanvasPersistence'
import type { NodeCanvasState } from '@/lib/api'

const { getNodeCanvas, putNodeCanvas } = vi.hoisted(() => ({
  getNodeCanvas: vi.fn(),
  putNodeCanvas: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    getNodeCanvas,
    putNodeCanvas,
  },
}))

const sampleState: NodeCanvasState = {
  schemaVersion: '1',
  nodes: [
    {
      id: 'node-1',
      position: { x: 10, y: 20 },
      ui: {
        title: 'Node 1',
        subtitle: 'Device',
        kind: 'device',
        details: [],
        ports: [],
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('useNodeCanvasPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getNodeCanvas.mockReset()
    putNodeCanvas.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads null state', async () => {
    getNodeCanvas.mockResolvedValue({ data: null })

    const persistence = useNodeCanvasPersistence({ debounceMs: 50 })
    const result = await persistence.load()

    expect(result).toBeNull()
    expect(persistence.isLoading.value).toBe(false)
    expect(persistence.readOnly.value).toBe(false)
  })

  it('debounces rapid saves into one PUT', async () => {
    putNodeCanvas.mockResolvedValue({ data: { ...sampleState, updatedAt: '2026-02-12T00:00:00.000Z' } })

    const persistence = useNodeCanvasPersistence({ debounceMs: 100 })
    persistence.scheduleSave(sampleState)
    persistence.scheduleSave({ ...sampleState, viewport: { x: 10, y: 20, zoom: 1.2 } })
    persistence.scheduleSave({ ...sampleState, viewport: { x: 20, y: 30, zoom: 1.4 } })

    vi.advanceTimersByTime(101)
    await Promise.resolve()

    expect(putNodeCanvas).toHaveBeenCalledTimes(1)
  })

  it('sets readOnly on 403 errors', async () => {
    getNodeCanvas.mockRejectedValue({ message: 'AUTH_FORBIDDEN', status: 403 })

    const persistence = useNodeCanvasPersistence()
    await persistence.load()

    expect(persistence.readOnly.value).toBe(true)
    expect(persistence.error.value).toBe('Read-only (admin required)')
  })

  it('keeps dirty=true on save failure and clears after success', async () => {
    putNodeCanvas.mockRejectedValueOnce(new Error('NETWORK_TIMEOUT'))
    putNodeCanvas.mockResolvedValueOnce({ data: { ...sampleState, updatedAt: '2026-02-12T00:00:00.000Z' } })

    const persistence = useNodeCanvasPersistence()

    await persistence.saveNow(sampleState)
    expect(persistence.dirty.value).toBe(true)
    expect(persistence.error.value).toBe('NETWORK_TIMEOUT')

    await persistence.saveNow(sampleState)
    expect(persistence.dirty.value).toBe(false)
    expect(persistence.error.value).toBeNull()
  })
})
