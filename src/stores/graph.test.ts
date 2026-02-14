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

const { graphStore } = await import('@/stores/graph')

describe('graphStore sync', () => {
  beforeEach(() => {
    createConnection.mockReset()
    deleteConnection.mockReset()
    syncConnectionsProjectionSafe.mockReset()
    pushToast.mockReset()

    graphStore.edges = []
    graphStore.error = null
    graphStore.resetSelection()
  })

  it('syncs global connections projection after creating a connection', async () => {
    createConnection.mockResolvedValue({
      id: 'edge-1',
      kind: 'connection',
      a: { type: 'device_port', id: 'p1' },
      b: { type: 'patchbay_point', id: '1' },
    })

    const ok = await graphStore.connectEndpoints(
      { type: 'device_port', id: 'p1' },
      { type: 'patchbay_point', id: '1' },
    )

    expect(ok).toBe(true)
    expect(syncConnectionsProjectionSafe).toHaveBeenCalledTimes(1)
    expect(graphStore.edges).toHaveLength(1)
  })

  it('syncs global connections projection after deleting a connection', async () => {
    graphStore.edges = [
      {
        id: 'edge-1',
        kind: 'connection',
        a: { type: 'device_port', id: 'p1' },
        b: { type: 'patchbay_point', id: '1' },
      },
    ]
    deleteConnection.mockResolvedValue(undefined)

    const ok = await graphStore.disconnectEdge('edge-1')

    expect(ok).toBe(true)
    expect(deleteConnection).toHaveBeenCalledWith('edge-1')
    expect(syncConnectionsProjectionSafe).toHaveBeenCalledTimes(1)
    expect(graphStore.edges).toHaveLength(0)
  })
})
