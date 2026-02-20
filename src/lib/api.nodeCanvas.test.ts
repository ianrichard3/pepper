import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestJson = vi.fn()

vi.mock('@/lib/apiClient', () => ({
  requestJson,
  requestJsonWithMeta: vi.fn(),
  fetchWithAuth: vi.fn(),
}))

const { api } = await import('@/lib/api')

describe('api node canvas connections', () => {
  beforeEach(() => {
    requestJson.mockReset()
  })

  it('applies saved node canvas state', async () => {
    requestJson.mockResolvedValue({
      result: 'success',
      report: { created_connection_ids: [], deleted_connection_ids: [], skipped_edges: [], conflicts: [] },
      undo: { created_connection_ids: [], deleted_connection_ids: [] },
    })

    await api.applyNodeCanvasConnections({ use_saved_state: true })

    expect(requestJson).toHaveBeenCalledWith('/api/node-canvas/connections/apply', {
      method: 'POST',
      body: JSON.stringify({ use_saved_state: true }),
    })
  })

  it('applies explicit in-memory node canvas state', async () => {
    requestJson.mockResolvedValue({
      result: 'success',
      report: { created_connection_ids: [], deleted_connection_ids: [], skipped_edges: [], conflicts: [] },
      undo: { created_connection_ids: [], deleted_connection_ids: [] },
    })

    await api.applyNodeCanvasConnections({
      state: {
        schemaVersion: '1',
        nodes: [],
        edges: [],
        viewport: { x: 40, y: 40, zoom: 1 },
      },
    })

    expect(requestJson).toHaveBeenCalledWith('/api/node-canvas/connections/apply', {
      method: 'POST',
      body: JSON.stringify({
        state: {
          schemaVersion: '1',
          nodes: [],
          edges: [],
          viewport: { x: 40, y: 40, zoom: 1 },
        },
      }),
    })
  })

  it('looks up existing node canvas connection chains', async () => {
    requestJson.mockResolvedValue({ statuses: [] })

    await api.lookupNodeCanvasConnections({ handles: ['dev-39-port-1', 'pb-1'] })

    expect(requestJson).toHaveBeenCalledWith('/api/node-canvas/connections/lookup', {
      method: 'POST',
      body: JSON.stringify({ handles: ['dev-39-port-1', 'pb-1'] }),
    })
  })

  it('undoes previously applied node canvas changes', async () => {
    requestJson.mockResolvedValue({ result: 'success', report: { reverted_created: 1, restored_deleted: 1, skipped_restores: 0 } })

    await api.undoNodeCanvasConnections({ created_connection_ids: [10], deleted_connection_ids: [9] })

    expect(requestJson).toHaveBeenCalledWith('/api/node-canvas/connections/undo', {
      method: 'POST',
      body: JSON.stringify({ created_connection_ids: [10], deleted_connection_ids: [9] }),
    })
  })
})
