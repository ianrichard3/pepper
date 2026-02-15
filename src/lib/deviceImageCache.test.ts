import { describe, it, expect, vi } from 'vitest'
import { createDeviceImageCache } from '@/lib/deviceImageCache'
import type { Device } from '@/store'

const makeDevice = (): Device => ({
  id: 1,
  name: 'Synth',
  category: 'INSTRUMENT',
  type: 'synth',
  ports: [],
  imageUrl: '/images/1.png',
  imageUpdatedAt: '2025-01-01T00:00:00Z',
})

describe('deviceImageCache', () => {
  it('separates cache entries by org', async () => {
    let counter = 0
    const fetchImage = vi.fn(async () => {
      counter += 1
      return { status: 'ok', blobUrl: `blob:mock-${counter}` } as const
    })
    const cache = createDeviceImageCache(fetchImage)
    const device = makeDevice()

    await cache.request(device, 'org-1')
    await cache.request(device, 'org-2')

    const stateOrg1 = cache.getState(device, 'org-1')
    const stateOrg2 = cache.getState(device, 'org-2')

    expect(stateOrg1.src).toBe('blob:mock-1')
    expect(stateOrg2.src).toBe('blob:mock-2')
  })
})
