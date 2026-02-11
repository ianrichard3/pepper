import { reactive } from 'vue'
import { api, type AdminEntitlementsPayload, type AdminUsageResponse, type AdminWorkspaceEntitlementsResponse, type AdminWorkspaceMember } from '@/lib/api'
import { featureKeys, limitKeys, type FeatureKey, type LimitKey } from '@/lib/entitlementKeys'
import { loadAuthContext, useAuthz } from '@/lib/authz'
import { quotaStore } from '@/stores/quota'

export interface EditableEntitlements {
  enabled: boolean
  plan: string
  features: Record<FeatureKey, boolean>
  limits: Partial<Record<LimitKey, number>>
}

function usageCacheKey(feature: string, period: number): string {
  return `${feature}:${period}`
}

function normalizeWorkspaceEntitlements(response: AdminWorkspaceEntitlementsResponse): EditableEntitlements {
  const features = {} as Record<FeatureKey, boolean>
  for (const key of featureKeys) {
    features[key] = Boolean(response.features?.[key])
  }

  const limits: Partial<Record<LimitKey, number>> = {}
  for (const key of limitKeys) {
    const value = response.limits?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      limits[key] = value
    }
  }

  return {
    enabled: response.enabled !== false,
    plan: response.plan ?? '',
    features,
    limits,
  }
}

function normalizePayload(entitlements: EditableEntitlements): AdminEntitlementsPayload {
  const payload: AdminEntitlementsPayload = {
    enabled: entitlements.enabled,
    plan: entitlements.plan || null,
    features: {},
    limits: {},
  }

  for (const key of featureKeys) {
    payload.features![key] = Boolean(entitlements.features[key])
  }

  for (const key of limitKeys) {
    const value = entitlements.limits[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      payload.limits![key] = value
    }
  }

  return payload
}

export const adminAccessStore = reactive({
  workspaceId: null as number | null,
  allowlisted: false,
  allowlistReason: '',
  workspaceEntitlementsStored: null as EditableEntitlements | null,
  members: [] as AdminWorkspaceMember[],
  memberOverrides: {} as Record<string, EditableEntitlements | null>,
  usageByKey: {} as Record<string, AdminUsageResponse>,
  loading: {
    workspace: false,
    saveWorkspace: false,
    allowlist: false,
    members: false,
    override: false,
    usage: false,
  },
  errors: {
    workspace: null as string | null,
    saveWorkspace: null as string | null,
    allowlist: null as string | null,
    members: null as string | null,
    override: null as string | null,
    usage: null as string | null,
  },

  setWorkspaceId(workspaceId: number | null) {
    this.workspaceId = workspaceId
  },

  initializeWorkspaceFromAuthContext() {
    if (this.workspaceId !== null) return
    const { authContext } = useAuthz()
    const currentWorkspace = Number(authContext.value?.workspace_id)
    if (Number.isFinite(currentWorkspace) && currentWorkspace > 0) {
      this.workspaceId = currentWorkspace
    }
  },

  resetWorkspaceState() {
    this.allowlisted = false
    this.allowlistReason = ''
    this.workspaceEntitlementsStored = null
    this.members = []
    this.memberOverrides = {}
    this.usageByKey = {}
    this.errors.workspace = null
    this.errors.saveWorkspace = null
    this.errors.allowlist = null
    this.errors.members = null
    this.errors.override = null
    this.errors.usage = null
  },

  async loadWorkspace(workspaceId: number) {
    if (this.workspaceId !== workspaceId) {
      this.workspaceId = workspaceId
      this.resetWorkspaceState()
    }

    this.loading.workspace = true
    this.errors.workspace = null
    try {
      const entitlements = await api.getWorkspaceEntitlementsAdmin(workspaceId)
      this.workspaceEntitlementsStored = normalizeWorkspaceEntitlements(entitlements)
      this.allowlisted = Boolean(entitlements.allowlisted)
      return entitlements
    } catch (error: any) {
      this.errors.workspace = error?.message || 'Failed to load workspace access'
      throw error
    } finally {
      this.loading.workspace = false
    }
  },

  async saveWorkspace() {
    if (!this.workspaceId || !this.workspaceEntitlementsStored) return null

    this.loading.saveWorkspace = true
    this.errors.saveWorkspace = null
    try {
      const payload = normalizePayload(this.workspaceEntitlementsStored)
      const result = await api.updateWorkspaceEntitlementsAdmin(this.workspaceId, payload)
      this.workspaceEntitlementsStored = normalizeWorkspaceEntitlements(result)
      await this.refreshCurrentAuthContext()
      return result
    } catch (error: any) {
      this.errors.saveWorkspace = error?.message || 'Failed to save workspace access'
      throw error
    } finally {
      this.loading.saveWorkspace = false
    }
  },

  async setAllowlist(active: boolean, reason?: string) {
    if (!this.workspaceId) return null

    this.loading.allowlist = true
    this.errors.allowlist = null
    try {
      if (active) {
        const response = await api.allowlistWorkspace(this.workspaceId, reason)
        this.allowlisted = Boolean(response.allowlisted)
      } else {
        const response = await api.delistWorkspace(this.workspaceId)
        this.allowlisted = Boolean(response.allowlisted)
      }
      await this.refreshCurrentAuthContext()
      return this.allowlisted
    } catch (error: any) {
      this.errors.allowlist = error?.message || 'Failed to update allowlist'
      throw error
    } finally {
      this.loading.allowlist = false
    }
  },

  async loadMemberOverrides() {
    if (!this.workspaceId) return []

    this.loading.members = true
    this.errors.members = null
    try {
      const members = await api.getWorkspaceMembersAdmin(this.workspaceId)
      this.members = members
      return members
    } catch (error: any) {
      this.errors.members = error?.message || 'Failed to load workspace members'
      this.members = []
      throw error
    } finally {
      this.loading.members = false
    }
  },

  async loadUserOverride(clerkUserId: string) {
    if (!this.workspaceId) return null

    this.loading.override = true
    this.errors.override = null
    try {
      const response = await api.getUserOverride(this.workspaceId, clerkUserId)
      if (response.entitlements) {
        const features = {} as Record<FeatureKey, boolean>
        for (const key of featureKeys) {
          features[key] = Boolean(response.entitlements.features?.[key])
        }

        const limits: Partial<Record<LimitKey, number>> = {}
        for (const key of limitKeys) {
          const value = response.entitlements.limits?.[key]
          if (typeof value === 'number' && Number.isFinite(value)) {
            limits[key] = value
          }
        }

        this.memberOverrides[clerkUserId] = {
          enabled: true,
          plan: '',
          features,
          limits,
        }
      } else {
        this.memberOverrides[clerkUserId] = null
      }

      return this.memberOverrides[clerkUserId]
    } catch (error: any) {
      this.errors.override = error?.message || 'Failed to load user override'
      throw error
    } finally {
      this.loading.override = false
    }
  },

  async saveOverride(clerkUserId: string) {
    if (!this.workspaceId) return null
    const override = this.memberOverrides[clerkUserId]
    if (!override) return null

    this.loading.override = true
    this.errors.override = null
    try {
      const payload: AdminEntitlementsPayload = {
        features: {},
        limits: {},
      }

      for (const key of featureKeys) {
        payload.features![key] = Boolean(override.features[key])
      }

      for (const key of limitKeys) {
        const value = override.limits[key]
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          payload.limits![key] = value
        }
      }

      const response = await api.putUserOverride(this.workspaceId, clerkUserId, payload)
      await this.loadUserOverride(clerkUserId)
      await this.refreshCurrentAuthContext()
      return response
    } catch (error: any) {
      this.errors.override = error?.message || 'Failed to save user override'
      throw error
    } finally {
      this.loading.override = false
    }
  },

  async removeOverride(clerkUserId: string) {
    if (!this.workspaceId) return null

    this.loading.override = true
    this.errors.override = null
    try {
      const response = await api.deleteUserOverride(this.workspaceId, clerkUserId)
      this.memberOverrides[clerkUserId] = null
      await this.refreshCurrentAuthContext()
      return response
    } catch (error: any) {
      this.errors.override = error?.message || 'Failed to remove user override'
      throw error
    } finally {
      this.loading.override = false
    }
  },

  async loadUsage(feature: string, period: number) {
    if (!this.workspaceId) return null

    this.loading.usage = true
    this.errors.usage = null
    try {
      const usage = await api.getWorkspaceUsage(this.workspaceId, feature, period)
      this.usageByKey[usageCacheKey(feature, period)] = usage
      return usage
    } catch (error: any) {
      this.errors.usage = error?.message || 'Failed to load usage'
      throw error
    } finally {
      this.loading.usage = false
    }
  },

  getUsage(feature: string, period: number): AdminUsageResponse | null {
    return this.usageByKey[usageCacheKey(feature, period)] || null
  },

  async refreshCurrentAuthContext() {
    const context = await loadAuthContext({ force: true })
    quotaStore.updateFromAuthContext(context)
    return context
  },
})
