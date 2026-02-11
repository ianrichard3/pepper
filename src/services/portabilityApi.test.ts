import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestJson = vi.fn()

vi.mock('@/lib/apiClient', () => ({
  requestJson,
}))

const { exportBundle, importPreview, importApply } = await import('@/services/portabilityApi')

describe('portabilityApi', () => {
  beforeEach(() => {
    requestJson.mockReset()
  })

  it('calls export endpoint with payload', async () => {
    requestJson.mockResolvedValue({ manifest: { version: '1' } })

    await exportBundle({
      scope: 'ALL',
      include: {
        ports: true,
        patchbay_points: true,
        patch_cables: true,
        device_configurations: true,
      },
    })

    expect(requestJson).toHaveBeenCalledWith('/api/portability/export', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'ALL',
        include: {
          ports: true,
          patchbay_points: true,
          patch_cables: true,
          device_configurations: true,
        },
      }),
    })
  })

  it('calls preview endpoint with raw bundle body', async () => {
    const bundle = { manifest: { version: '1' }, entities: { devices: [] } }
    requestJson.mockResolvedValue({ plan: { creates: 1, updates: 0, skips: 0 } })

    await importPreview(bundle)

    expect(requestJson).toHaveBeenCalledWith('/api/portability/import/preview', {
      method: 'POST',
      body: JSON.stringify(bundle),
    })
  })

  it('calls apply endpoint with bundle and options', async () => {
    const payload = {
      bundle: { manifest: { version: '1' } },
      options: {
        mode: 'merge',
        name_duplicates: 'rename',
        patchbay_mapping_conflicts: 'remap_to_free',
        patch_cable_conflicts: 'skip_conflicts',
        config_conflicts: 'rename',
      },
    } as const
    requestJson.mockResolvedValue({ report: { created: 1 } })

    await importApply(payload)

    expect(requestJson).toHaveBeenCalledWith('/api/portability/import/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  })
})
