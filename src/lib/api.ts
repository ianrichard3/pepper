// API client for patchbay backend
import { apiBaseUrl } from './authConfig'
import { fetchWithAuth, requestJson, requestJsonAllowErrors, requestJsonWithMeta } from './apiClient'
import {
  type SuggestionOptions,
  type Intent,
  type SuggestionsResponse,
  type PreviewResponse,
  type ApplyResponse,
  type SuggestionPlan,
  IntentParseError,
  ConflictError,
  type IntentParseErrorData,
  type ConflictErrorData,
} from '@/types/suggestions'
import type { FeatureKey, LimitKey } from './entitlementKeys'

// API Types (snake_case from backend)
export interface ApiPatchbayPoint {
  id: number
  name: string
  description: string
  type: string
}

export interface ApiPort {
  id: string
  label: string
  type: 'Input' | 'Output' | 'Other'
  patchbay_id: number | null
}

export interface ApiDevice {
  id: number
  name: string
  type: string
  ports: ApiPort[]
  image_url?: string | null
  image_updated_at?: string | null
}

export interface ApiState {
  patchbay_points: ApiPatchbayPoint[]
  devices: ApiDevice[]
}

export interface ApiPortLinkRequest {
  patchbay_id: number
}

export interface ApiPortLinkResponse extends ApiPort {
  unlinked_port_id?: string | null
}

export interface NodeCanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface NodeCanvasNode {
  id: string
  deviceId?: string | null
  position: {
    x: number
    y: number
  }
  ui?: Record<string, unknown>
}

export interface NodeCanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  meta?: Record<string, unknown>
}

export interface NodeCanvasState {
  schemaVersion: '1'
  nodes: NodeCanvasNode[]
  edges: NodeCanvasEdge[]
  viewport?: NodeCanvasViewport | null
  uiFlags?: Record<string, unknown>
  updatedAt?: string
}

export interface ApiDeviceCreate {
  name: string
  type: string
  ports: Array<{
    label: string
    type: 'Input' | 'Output' | 'Other'
    patchbay_id: number | null
  }>
}

export interface ApiDeviceUpdate {
  name: string
  type: string
  ports: Array<{
    id?: string
    label: string
    type: 'Input' | 'Output' | 'Other'
    patchbay_id?: number | null
  }>
}

export interface AuthContextResponse {
  user_id?: string
  org_id?: string | null
  role?: string | null
  enabled?: boolean
  plan?: string | null
  features?: Record<string, boolean>
  limits?: Record<string, number>
  usage?: Record<string, { feature_key: string; period: number; used: number; limit?: number | null }>
  [key: string]: unknown
}

export interface AdminEntitlementsPayload {
  enabled?: boolean
  plan?: string | null
  features?: Partial<Record<FeatureKey, boolean>>
  limits?: Partial<Record<LimitKey, number>>
}

export interface AdminWorkspaceEntitlementsResponse {
  workspace_id: number
  enabled?: boolean
  allowlisted?: boolean
  plan?: string | null
  features?: Partial<Record<FeatureKey, boolean>>
  limits?: Partial<Record<LimitKey, number>>
  [key: string]: unknown
}

export interface AdminUserOverrideResponse {
  workspace_id: number
  clerk_user_id: string
  entitlements?: {
    features?: Partial<Record<FeatureKey, boolean>>
    limits?: Partial<Record<LimitKey, number>>
  } | null
  [key: string]: unknown
}

export interface AdminUsageResponse {
  workspace_id: number
  feature: string
  period: number
  used: number
  limit?: number | null
  remaining?: number | null
  [key: string]: unknown
}

export interface AdminWorkspaceMember {
  clerk_user_id: string
  role?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  [key: string]: unknown
}

export type FetchImageResult =
  | { status: 'ok'; blobUrl: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'timeout' }
  | { status: 'unauthorized' }
  | { status: 'aborted' }
  | { status: 'error'; error: string }

export type FetchImageFn = (imageUrl: string, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<FetchImageResult>

// API methods
export const api = {
  async getState(): Promise<ApiState> {
    return requestJson<ApiState>('/state')
  },

  async getNodeCanvas(): Promise<{ data: NodeCanvasState | null }> {
    return requestJson<{ data: NodeCanvasState | null }>('/api/node-canvas')
  },

  async putNodeCanvas(payload: NodeCanvasState): Promise<{ data: NodeCanvasState }> {
    return requestJson<{ data: NodeCanvasState }>('/api/node-canvas', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  async createDevice(payload: ApiDeviceCreate): Promise<ApiDevice> {
    return requestJson<ApiDevice>('/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async deleteDevice(deviceId: number): Promise<ApiDevice> {
    return requestJson<ApiDevice>(`/devices/${deviceId}`, {
      method: 'DELETE',
    })
  },

  async updateDevice(deviceId: number, payload: ApiDeviceUpdate): Promise<ApiDevice> {
    return requestJson<ApiDevice>(`/devices/${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  async linkPort(portId: string, patchbayId: number): Promise<ApiPortLinkResponse> {
    return requestJson<ApiPortLinkResponse>(`/ports/${portId}/link`, {
      method: 'POST',
      body: JSON.stringify({ patchbay_id: patchbayId }),
    })
  },

  async updatePortPatchbay(portId: string, patchbayId: number | null): Promise<ApiPort> {
    return requestJson<ApiPort>(`/ports/${portId}/patchbay`, {
      method: 'PUT',
      body: JSON.stringify({ patchbay_id: patchbayId }),
    })
  },

  async unlinkPort(portId: string): Promise<ApiPort> {
    return requestJson<ApiPort>(`/ports/${portId}/unlink`, {
      method: 'POST',
    })
  },

  async parseDeviceFromImage(image: File): Promise<ApiDevice> {
    const { device } = await this.parseDeviceFromImageWithMeta(image)
    return device
  },

  async parseDeviceFromImageWithMeta(image: File): Promise<{ device: ApiDevice; headers: Headers }> {
    const formData = new FormData()
    formData.append('image', image)

    try {
      const { data, headers } = await requestJsonWithMeta<AIDeviceExtraction>('/ai/parse-image', {
        method: 'POST',
        body: formData,
      })
      return { device: buildDeviceFromExtraction(data), headers }
    } catch (err: any) {
      if (err?.status === 404 || String(err?.message || '').includes('HTTP 404')) {
        const { data, headers } = await requestJsonWithMeta<ApiDevice>('/devices/parse-image', {
          method: 'POST',
          body: formData,
        })
        return { device: data, headers }
      }
      throw err
    }
  },

  async uploadDeviceImage(deviceId: number, image: File): Promise<ApiDevice> {
    // Client-side validation
    if (!image.type.startsWith('image/')) {
      throw new Error('Invalid file type. Please upload an image file.')
    }
    const MAX_SIZE = 12 * 1024 * 1024 // 12MB
    if (image.size > MAX_SIZE) {
      throw new Error('Image too large. Maximum size is 12MB.')
    }

    const formData = new FormData()
    formData.append('image', image)

    return requestJson<ApiDevice>(`/devices/${deviceId}/image`, {
      method: 'POST',
      body: formData,
    })
  },

  buildAbsoluteUrl(relativeOrAbsolute: string): string {
    if (relativeOrAbsolute.startsWith('http://') || relativeOrAbsolute.startsWith('https://')) {
      return relativeOrAbsolute
    }
    return `${apiBaseUrl}${relativeOrAbsolute}`
  },

  getDeviceImageSrc(imageUrl: string | null | undefined, imageUpdatedAt: string | null | undefined): string | null {
    if (!imageUrl) return null

    const base = this.buildAbsoluteUrl(imageUrl)
    const cacheBust = imageUpdatedAt ? `?v=${encodeURIComponent(imageUpdatedAt)}` : ''
    return base + cacheBust
  },

  async getAuthContext(): Promise<AuthContextResponse> {
    return requestJson<AuthContextResponse>('/me/entitlements')
  },

  async getWorkspaceEntitlementsAdmin(workspaceId: number): Promise<AdminWorkspaceEntitlementsResponse> {
    return requestJson<AdminWorkspaceEntitlementsResponse>(`/admin/workspaces/${workspaceId}/entitlements`)
  },

  async updateWorkspaceEntitlementsAdmin(
    workspaceId: number,
    payload: AdminEntitlementsPayload
  ): Promise<AdminWorkspaceEntitlementsResponse> {
    return requestJson<AdminWorkspaceEntitlementsResponse>(`/admin/workspaces/${workspaceId}/entitlements`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  async allowlistWorkspace(workspaceId: number, reason?: string): Promise<{ allowlisted: boolean; [key: string]: unknown }> {
    return requestJson<{ allowlisted: boolean; [key: string]: unknown }>(`/admin/workspaces/${workspaceId}/allowlist`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    })
  },

  async delistWorkspace(workspaceId: number): Promise<{ allowlisted: boolean; [key: string]: unknown }> {
    return requestJson<{ allowlisted: boolean; [key: string]: unknown }>(`/admin/workspaces/${workspaceId}/allowlist`, {
      method: 'DELETE',
    })
  },

  async getWorkspaceMembersAdmin(workspaceId: number): Promise<AdminWorkspaceMember[]> {
    return requestJson<AdminWorkspaceMember[]>(`/admin/workspaces/${workspaceId}/members`)
  },

  async getUserOverride(workspaceId: number, clerkUserId: string): Promise<AdminUserOverrideResponse> {
    return requestJson<AdminUserOverrideResponse>(`/admin/workspaces/${workspaceId}/users/${clerkUserId}/entitlements`)
  },

  async putUserOverride(
    workspaceId: number,
    clerkUserId: string,
    payload: AdminEntitlementsPayload
  ): Promise<AdminUserOverrideResponse> {
    return requestJson<AdminUserOverrideResponse>(`/admin/workspaces/${workspaceId}/users/${clerkUserId}/entitlements`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  async deleteUserOverride(workspaceId: number, clerkUserId: string): Promise<{ deleted: boolean; [key: string]: unknown }> {
    return requestJson<{ deleted: boolean; [key: string]: unknown }>(`/admin/workspaces/${workspaceId}/users/${clerkUserId}/entitlements`, {
      method: 'DELETE',
    })
  },

  async getWorkspaceUsage(workspaceId: number, feature: string, period: number): Promise<AdminUsageResponse> {
    const params = new URLSearchParams({ feature, period: String(period) })
    return requestJson<AdminUsageResponse>(`/admin/workspaces/${workspaceId}/usage?${params.toString()}`)
  },

  // Fetch image with authentication and return blob URL
  async fetchAuthenticatedImage(imageUrl: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<FetchImageResult> {
    const url = this.buildAbsoluteUrl(imageUrl)
    const timeoutMs = options?.timeoutMs ?? 10000

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    if (options?.signal) {
      if (options.signal.aborted) controller.abort()
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    const doFetch = async (isRetry?: boolean) => {
      return fetchWithAuth(url, {
        signal: controller.signal,
      }, isRetry)
    }

    try {
      let { response } = await doFetch()

      if (response.status === 401) {
        const retry = await doFetch(true)
        response = retry.response
      }

      if (response.status === 404) return { status: 'not_found' }
      if (response.status === 403) return { status: 'forbidden' }
      if (response.status === 401) return { status: 'unauthorized' }
      if (!response.ok) return { status: 'error', error: `HTTP ${response.status}` }

      const blob = await response.blob()
      return { status: 'ok', blobUrl: URL.createObjectURL(blob) }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { status: options?.signal?.aborted ? 'aborted' : 'timeout' }
      }
      return { status: 'error', error: error?.message || 'Unknown error' }
    } finally {
      clearTimeout(timeoutId)
    }
  },

  async suggestionsPresets(presetId: string, options?: SuggestionOptions): Promise<SuggestionsResponse> {
    return requestJson<SuggestionsResponse>('/suggestions/presets', {
      method: 'POST',
      body: JSON.stringify({
        preset_id: presetId,
        options: options ?? undefined,
      }),
    })
  },

  async aiIntent(text: string): Promise<Intent> {
    const result = await requestJsonAllowErrors<Intent>('/ai/intent', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }, [422])

    if (result.status === 422) {
      const details = (result.errorJson || { detail: result.errorText }) as IntentParseErrorData
      throw new IntentParseError('INTENT_PARSE_FAILED', details)
    }

    return result.data as Intent
  },

  async suggestionsFromIntent(intent: Intent, options?: SuggestionOptions): Promise<SuggestionsResponse> {
    return requestJson<SuggestionsResponse>('/suggestions/from-intent', {
      method: 'POST',
      body: JSON.stringify({
        intent,
        options: options ?? undefined,
      }),
    })
  },

  async suggestionsPreview(plan: SuggestionPlan, options?: SuggestionOptions): Promise<PreviewResponse> {
    const result = await requestJsonAllowErrors<PreviewResponse>('/suggestions/preview', {
      method: 'POST',
      body: JSON.stringify({
        plan,
        options: options ?? undefined,
      }),
    }, [409])

    if (result.status === 409) {
      const details = (result.errorJson || { detail: result.errorText }) as ConflictErrorData
      throw new ConflictError('SUGGESTION_CONFLICT', details)
    }

    return result.data as PreviewResponse
  },

  async suggestionsApply(
    plan: SuggestionPlan,
    options?: SuggestionOptions,
    intentOrSignature?: Intent | { intent_signature: string }
  ): Promise<ApplyResponse> {
    const payload: Record<string, unknown> = { plan }
    if (options) payload.options = options
    if (intentOrSignature) {
      if ('intent_signature' in intentOrSignature) {
        payload.intent_signature = intentOrSignature.intent_signature
      } else {
        payload.intent = intentOrSignature
      }
    }

    const result = await requestJsonAllowErrors<ApplyResponse>('/suggestions/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, [409])

    if (result.status === 409) {
      const details = (result.errorJson || { detail: result.errorText }) as ConflictErrorData
      throw new ConflictError('SUGGESTION_CONFLICT', details)
    }

    return result.data as ApplyResponse
  },
}

interface AIDeviceExtraction {
  device: {
    brand?: string | null
    model?: string | null
    category?: string | null
  }
  ports: Array<{
    label: string
    direction?: string | null
  }>
}

function buildDeviceFromExtraction(extraction: AIDeviceExtraction): ApiDevice {
  const brand = (extraction.device?.brand || '').trim()
  const model = (extraction.device?.model || '').trim()
  const name = brand && model ? `${brand} ${model}` : (brand || model || 'Unknown device')
  const type = extraction.device?.category || 'Other'

  const ports: ApiPort[] = extraction.ports.map((port, index) => ({
    id: `ai-dev-0-port-${index + 1}`,
    label: port.label,
    type: mapAIPortDirection(port.direction),
    patchbay_id: null,
  }))

  return {
    id: 0,
    name,
    type,
    ports,
    image_url: null,
    image_updated_at: null,
  }
}

function mapAIPortDirection(direction?: string | null): 'Input' | 'Output' | 'Other' {
  const value = (direction || '').toLowerCase()
  if (value === 'input') return 'Input'
  if (value === 'output') return 'Output'
  return 'Other'
}
