import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  getWorkspaceEntitlementsAdmin: vi.fn(),
  updateWorkspaceEntitlementsAdmin: vi.fn(),
  allowlistWorkspace: vi.fn(),
  delistWorkspace: vi.fn(),
  getWorkspaceMembersAdmin: vi.fn(),
  getUserOverride: vi.fn(),
  putUserOverride: vi.fn(),
  deleteUserOverride: vi.fn(),
  getWorkspaceUsage: vi.fn(),
}

const loadAuthContext = vi.fn()
const updateFromAuthContext = vi.fn()

vi.mock('@/lib/api', () => ({ api }))
vi.mock('@/lib/authz', () => ({
  loadAuthContext,
  useAuthz: () => ({ authContext: { value: {} } }),
}))
vi.mock('@/stores/quota', () => ({
  quotaStore: {
    updateFromAuthContext,
  },
}))

const { adminAccessStore } = await import('@/stores/adminAccess')

describe('adminAccessStore', () => {
  beforeEach(() => {
    adminAccessStore.workspaceId = null
    adminAccessStore.resetWorkspaceState()

    api.getWorkspaceEntitlementsAdmin.mockReset()
    api.updateWorkspaceEntitlementsAdmin.mockReset()
    api.allowlistWorkspace.mockReset()
    api.delistWorkspace.mockReset()
    api.getWorkspaceMembersAdmin.mockReset()
    api.getUserOverride.mockReset()
    api.putUserOverride.mockReset()
    api.deleteUserOverride.mockReset()
    api.getWorkspaceUsage.mockReset()

    loadAuthContext.mockReset()
    loadAuthContext.mockResolvedValue({ limits: {}, usage: {} })
    updateFromAuthContext.mockReset()
  })

  it('resets stale data when workspace changes', async () => {
    api.getWorkspaceEntitlementsAdmin
      .mockResolvedValueOnce({ workspace_id: 1, allowlisted: true, enabled: true, plan: 'pro', features: { ai_detection: true }, limits: {} })
      .mockResolvedValueOnce({ workspace_id: 2, allowlisted: false, enabled: false, plan: 'free', features: { ai_detection: false }, limits: {} })

    await adminAccessStore.loadWorkspace(1)
    expect(adminAccessStore.allowlisted).toBe(true)

    adminAccessStore.memberOverrides.user_1 = {
      enabled: true,
      plan: '',
      features: { ai_detection: true, ai_intent: false, export: false },
      limits: {},
    }

    await adminAccessStore.loadWorkspace(2)

    expect(adminAccessStore.workspaceId).toBe(2)
    expect(adminAccessStore.allowlisted).toBe(false)
    expect(adminAccessStore.memberOverrides).toEqual({})
  })

  it('saveWorkspace refreshes auth context and quota store', async () => {
    api.getWorkspaceEntitlementsAdmin.mockResolvedValue({
      workspace_id: 10,
      allowlisted: false,
      enabled: true,
      plan: 'pro',
      features: { ai_detection: true, ai_intent: true, export: true },
      limits: { ai_detection_per_month: 100, ai_intent_per_month: 50 },
    })

    api.updateWorkspaceEntitlementsAdmin.mockResolvedValue({
      workspace_id: 10,
      allowlisted: false,
      enabled: true,
      plan: 'pro',
      features: { ai_detection: true, ai_intent: true, export: true },
      limits: { ai_detection_per_month: 100, ai_intent_per_month: 50 },
    })

    await adminAccessStore.loadWorkspace(10)
    await adminAccessStore.saveWorkspace()

    expect(api.updateWorkspaceEntitlementsAdmin).toHaveBeenCalledTimes(1)
    expect(loadAuthContext).toHaveBeenCalledWith({ force: true })
    expect(updateFromAuthContext).toHaveBeenCalledTimes(1)
  })

  it('omits invalid limits from save payload', async () => {
    api.getWorkspaceEntitlementsAdmin.mockResolvedValue({
      workspace_id: 3,
      allowlisted: false,
      enabled: true,
      plan: 'pro',
      features: { ai_detection: true, ai_intent: false, export: true },
      limits: { ai_detection_per_month: 20, ai_intent_per_month: 10 },
    })
    api.updateWorkspaceEntitlementsAdmin.mockResolvedValue({
      workspace_id: 3,
      allowlisted: false,
      enabled: true,
      plan: 'pro',
      features: { ai_detection: true, ai_intent: false, export: true },
      limits: { ai_detection_per_month: 20 },
    })

    await adminAccessStore.loadWorkspace(3)
    adminAccessStore.workspaceEntitlementsStored!.limits.ai_detection_per_month = 20
    adminAccessStore.workspaceEntitlementsStored!.limits.ai_intent_per_month = -1
    await adminAccessStore.saveWorkspace()

    expect(api.updateWorkspaceEntitlementsAdmin).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        limits: expect.objectContaining({
          ai_detection_per_month: 20,
        }),
      })
    )

    const payload = api.updateWorkspaceEntitlementsAdmin.mock.calls[0][1]
    expect(payload.limits.ai_intent_per_month).toBeUndefined()
  })
})
