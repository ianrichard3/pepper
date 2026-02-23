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
        connections: true,
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
          connections: true,
          device_configurations: true,
        },
      }),
    })
  })

  it('calls export endpoint with selected device ids for selected-devices scope', async () => {
    requestJson.mockResolvedValue({ manifest: { version: '1' } })

    await exportBundle({
      scope: 'SELECTED_DEVICES',
      device_ids: [3, 7],
      include: {
        ports: true,
        patchbay_points: false,
        connections: false,
        device_configurations: true,
      },
    })

    expect(requestJson).toHaveBeenCalledWith('/api/portability/export', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'SELECTED_DEVICES',
        device_ids: [3, 7],
        include: {
          ports: true,
          patchbay_points: false,
          connections: false,
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
        name_strategy: 'rename',
        patchbay_mapping_strategy: 'remap_to_free',
        patch_cable_strategy: 'skip_conflicts',
        device_config_strategy: 'rename',
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
