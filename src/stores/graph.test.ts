import { beforeEach, describe, expect, it, vi } from 'vitest'

const createConnection = vi.fn()
const deleteConnection = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    createConnection,
    deleteConnection,
  },
}))

const syncConnectionsProjectionSafe = vi.fn()
const pushToast = vi.fn()

vi.mock('@/store', () => ({
  store: {
    syncConnectionsProjectionSafe,
    pushToast,
  },
}))

const { canvasStore } = await import('@/stores/graph')

describe('canvasStore sync', () => {
  beforeEach(() => {
    createConnection.mockReset()
    deleteConnection.mockReset()
    syncConnectionsProjectionSafe.mockReset()
    pushToast.mockReset()

    canvasStore.edges = []
    canvasStore.error = null
    canvasStore.resetSelection()
  })

  it('syncs global connections projection after creating a connection', async () => {
    createConnection.mockResolvedValue({
      id: 'edge-1',
      kind: 'connection',
      a: { type: 'device_port', id: 'p1' },
      b: { type: 'patchbay_point', id: '1' },
    })

    const ok = await canvasStore.connectEndpoints(
      { type: 'device_port', id: 'p1' },
      { type: 'patchbay_point', id: '1' },
    )

    expect(ok).toBe(true)
    expect(syncConnectionsProjectionSafe).toHaveBeenCalledTimes(1)
    expect(canvasStore.edges).toHaveLength(1)
  })

  it('syncs global connections projection after deleting a connection', async () => {
    canvasStore.edges = [
      {
        id: 'edge-1',
        kind: 'connection',
        a: { type: 'device_port', id: 'p1' },
        b: { type: 'patchbay_point', id: '1' },
      },
    ]
    deleteConnection.mockResolvedValue(undefined)

    const ok = await canvasStore.disconnectEdge('edge-1')

    expect(ok).toBe(true)
    expect(deleteConnection).toHaveBeenCalledWith('edge-1')
    expect(syncConnectionsProjectionSafe).toHaveBeenCalledTimes(1)
    expect(canvasStore.edges).toHaveLength(0)
  })
})
