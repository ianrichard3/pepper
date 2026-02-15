import { describe, it, expect, vi, beforeEach } from 'vitest'

const clearAll = vi.fn()
const invalidateDevice = vi.fn()

vi.mock('@/lib/deviceImageCache', () => ({
  deviceImageCache: {
    clearAll,
    invalidateDevice,
  },
}))

const uploadDeviceImage = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    uploadDeviceImage,
  },
}))

const { store } = await import('@/store')

beforeEach(() => {
  clearAll.mockClear()
  invalidateDevice.mockClear()
  uploadDeviceImage.mockReset()
  store.devices = []
  store.selectedDevice = null
})

describe('store image flow', () => {
  it('clears image cache on resetState', () => {
    store.resetState()
    expect(clearAll).toHaveBeenCalledTimes(1)
  })

  it('updates device and invalidates cache on uploadDeviceImage', async () => {
    store.devices = [
      {
        id: 1,
        name: 'Drum Machine',
        category: 'OTHER',
        type: 'other',
        ports: [],
        imageUrl: '/images/1.png',
        imageUpdatedAt: 'old',
      },
    ]
    store.selectedDevice = store.devices[0]

    uploadDeviceImage.mockResolvedValue({
      id: 1,
      name: 'Drum Machine',
      category: 'OTHER',
      type: 'other',
      ports: [],
      image_url: '/images/1.png',
      image_updated_at: 'new',
    })

    const file = new File(['data'], 'image.png', { type: 'image/png' })
    await store.uploadDeviceImage(1, file)

    expect(store.devices[0].imageUpdatedAt).toBe('new')
    expect(store.selectedDevice?.imageUpdatedAt).toBe('new')
    expect(invalidateDevice).toHaveBeenCalledWith(1)
  })
})
