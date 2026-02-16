// API client for patchbay backend
import { apiBaseUrl } from './authConfig'
import { fetchWithAuth, requestJson, requestJsonWithMeta } from './apiClient'
import type { GraphEndpoint, GraphPayload, GraphEdge, GraphNode } from '@/types/graph'
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
  patchbay_id?: number | null
}

export interface ApiDevice {
  id: number
  name: string
  type: string
  category: string
  tags?: string[]
  ports: ApiPort[]
  image_url?: string | null
  image_updated_at?: string | null
}

export interface ApiState {
  patchbay_points: ApiPatchbayPoint[]
  devices: ApiDevice[]
}

type GraphNodeWire = Record<string, unknown>
type GraphEdgeWire = Record<string, unknown>

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

export interface NodeCanvasApplyConnectionsConflict {
  edge_id: string
  code: string
  message: string
}

export interface NodeCanvasApplyConnectionsReport {
  created_connection_ids: number[]
  deleted_connection_ids: number[]
  skipped_edges: string[]
  conflicts: NodeCanvasApplyConnectionsConflict[]
}

export interface NodeCanvasApplyConnectionsUndo {
  created_connection_ids: number[]
  deleted_connection_ids: number[]
}

export interface NodeCanvasApplyConnectionsResponse {
  result: string
  report: NodeCanvasApplyConnectionsReport
  undo?: NodeCanvasApplyConnectionsUndo | null
}

export interface NodeCanvasConnectionsLookupStatus {
  handle: string
  already_connected: boolean
  component_edge_ids: number[]
  component_handles: string[]
  component_edges?: Array<{
    id: number
    kind: string
    a_type: 'device_port' | 'patchbay_point'
    a_id: string
    b_type: 'device_port' | 'patchbay_point'
    b_id: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
}

export interface NodeCanvasConnectionsLookupResponse {
  statuses: NodeCanvasConnectionsLookupStatus[]
}

export interface NodeCanvasUndoConnectionsResponse {
  result: string
  report: {
    reverted_created: number
    restored_deleted: number
    skipped_restores: number
  }
}

export interface ApiConnectionCreate {
  a_type: 'device_port' | 'patchbay_point'
  a_id: string
  b_type: 'device_port' | 'patchbay_point'
  b_id: string
}

export interface ApiDeviceCreate {
  name: string
  type?: string
  category?: string
  tags?: string[]
  catalog_source?: {
    provider: string
    external_id: string
    source_url?: string | null
    imported_snapshot?: Record<string, unknown>
  }
  ports: Array<{
    label: string
    type: 'Input' | 'Output' | 'Other'
    patchbay_id: number | null
  }>
}

export interface ApiDeviceUpdate {
  name: string
  type?: string
  category?: string
  tags?: string[]
  ports: Array<{
    id?: string
    label: string
    type: 'Input' | 'Output' | 'Other'
    patchbay_id?: number | null
  }>
}

export interface ApiCatalogStatusResponse {
  enabled: boolean
  providers: Array<{
    provider: string
    available: boolean
    reason?: string | null
  }>
}

export interface ApiCatalogSearchItem {
  provider: string
  external_id: string
  title: string
  thumbnail?: string | null
  brand?: string | null
  model?: string | null
  short_specs?: string[]
  source_url?: string | null
}

export interface ApiCatalogSearchResponse {
  items: ApiCatalogSearchItem[]
  page_info: {
    page: number
    page_size: number
    total?: number | null
    next_page_token?: string | null
  }
}

export interface ApiCatalogItemDetails {
  provider: string
  external_id: string
  title: string
  images: string[]
  brand?: string | null
  model?: string | null
  category_path?: string | null
  category_id?: string | null
  identifiers?: Record<string, unknown>
  specs?: Record<string, unknown>
  source_url?: string | null
  attribution?: string | null
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

  async getGraph(): Promise<GraphPayload> {
    const payload = await requestJson<{ nodes?: GraphNodeWire[]; edges?: GraphEdgeWire[] }>('/api/graph')
    return normalizeGraphPayload(payload)
  },

  async getDeviceGraph(deviceId: number, options?: { mode?: 'direct' | 'reachable' }): Promise<GraphPayload> {
    const params = new URLSearchParams({ device_id: String(deviceId) })
    if (options?.mode) params.set('mode', options.mode)
    const payload = await requestJson<{ nodes?: GraphNodeWire[]; edges?: GraphEdgeWire[] }>(`/api/graph?${params.toString()}`)
    return normalizeGraphPayload(payload)
  },

  async getPatchbayGraph(patchbayId: number, options?: { mode?: 'direct' | 'reachable' }): Promise<GraphPayload> {
    const params = new URLSearchParams({ patchbay_id: String(patchbayId) })
    if (options?.mode) params.set('mode', options.mode)
    const payload = await requestJson<{ nodes?: GraphNodeWire[]; edges?: GraphEdgeWire[] }>(`/api/graph?${params.toString()}`)
    return normalizeGraphPayload(payload)
  },

  async listConnections(): Promise<GraphEdge[]> {
    const payload = await requestJson<GraphEdgeWire[]>('/api/connections')
    return payload.map((item) => normalizeGraphEdge(item))
  },

  async createConnection(payload: { a: GraphEndpoint; b: GraphEndpoint } | ApiConnectionCreate): Promise<GraphEdge> {
    const body = 'a' in payload
      ? {
          a_type: payload.a.type,
          a_id: String(payload.a.id),
          b_type: payload.b.type,
          b_id: String(payload.b.id),
        }
      : payload
    const result = await requestJson<GraphEdgeWire>('/api/connections', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return normalizeGraphEdge(result)
  },

  async deleteConnection(connectionId: string): Promise<void> {
    await requestJson<unknown>(`/api/connections/${connectionId}`, {
      method: 'DELETE',
    })
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

  async applyNodeCanvasConnections(payload: { state?: NodeCanvasState; use_saved_state?: boolean } = {}): Promise<NodeCanvasApplyConnectionsResponse> {
    return requestJson<NodeCanvasApplyConnectionsResponse>('/api/node-canvas/connections/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async undoNodeCanvasConnections(payload: { created_connection_ids: number[]; deleted_connection_ids: number[] }): Promise<NodeCanvasUndoConnectionsResponse> {
    return requestJson<NodeCanvasUndoConnectionsResponse>('/api/node-canvas/connections/undo', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async lookupNodeCanvasConnections(payload: { handles: string[] }): Promise<NodeCanvasConnectionsLookupResponse> {
    return requestJson<NodeCanvasConnectionsLookupResponse>('/api/node-canvas/connections/lookup', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async createDevice(payload: ApiDeviceCreate): Promise<ApiDevice> {
    return requestJson<ApiDevice>('/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async getCatalogStatus(): Promise<ApiCatalogStatusResponse> {
    return requestJson<ApiCatalogStatusResponse>('/api/catalog/status')
  },

  async searchCatalog(payload: {
    provider: string
    q: string
    page?: number
    page_size?: number
    brand?: string
    device_type?: string
    condition?: string
  }): Promise<ApiCatalogSearchResponse> {
    const params = new URLSearchParams({
      provider: payload.provider,
      q: payload.q,
      page: String(payload.page ?? 1),
      page_size: String(payload.page_size ?? 20),
    })
    if (payload.brand) params.set('brand', payload.brand)
    if (payload.device_type) params.set('device_type', payload.device_type)
    if (payload.condition) params.set('condition', payload.condition)
    return requestJson<ApiCatalogSearchResponse>(`/api/catalog/search?${params.toString()}`)
  },

  async getCatalogItem(provider: string, externalId: string): Promise<ApiCatalogItemDetails> {
    return requestJson<ApiCatalogItemDetails>(`/api/catalog/items/${encodeURIComponent(provider)}/${encodeURIComponent(externalId)}`)
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

function normalizeGraphPayload(payload: { nodes?: GraphNodeWire[]; edges?: GraphEdgeWire[] }): GraphPayload {
  return {
    nodes: (payload.nodes || []).map((node) => normalizeGraphNode(node)),
    edges: (payload.edges || []).map((edge) => normalizeGraphEdge(edge)),
  }
}

function normalizeGraphNode(raw: GraphNodeWire): GraphNode {
  const kind = String(raw.node_type || raw.kind || raw.type || 'port') as 'device' | 'port' | 'patchbay_point'
  const data = (raw.data && typeof raw.data === 'object') ? (raw.data as Record<string, unknown>) : null
  const endpointObj = (raw.endpoint && typeof raw.endpoint === 'object') ? (raw.endpoint as Record<string, unknown>) : null
  const endpointTypeRaw = raw.endpoint_type || raw.endpointType || raw.type
    || endpointObj?.type
  let endpointType: GraphEndpoint['type'] | undefined
  if (endpointTypeRaw === 'device_port' || endpointTypeRaw === 'patchbay_point') {
    endpointType = endpointTypeRaw
  } else if (kind === 'port') {
    endpointType = 'device_port'
  } else if (kind === 'patchbay_point') {
    endpointType = 'patchbay_point'
  }

  const endpointId = raw.endpoint_id || raw.endpointId || raw.port_id || raw.portId || raw.patchbay_id || raw.patchbayId
    || endpointObj?.id
    || data?.id
  const id = String(raw.id || data?.id || `${kind}:${String(endpointId || raw.device_id || raw.deviceId || data?.device_id || data?.deviceId || Math.random())}`)
  const label = String(raw.label || raw.name || data?.label || data?.name || id)
  const deviceIdRaw = raw.device_id || raw.deviceId || data?.device_id || data?.deviceId
  const deviceId = typeof deviceIdRaw === 'number' ? deviceIdRaw : (typeof deviceIdRaw === 'string' ? Number(deviceIdRaw) : undefined)

  return {
    id,
    kind,
    label,
    description: typeof raw.description === 'string' ? raw.description : (typeof data?.description === 'string' ? data.description : undefined),
    endpoint: endpointType && (typeof endpointId === 'string' || typeof endpointId === 'number')
      ? { type: endpointType, id: endpointId }
      : undefined,
    deviceId: Number.isFinite(deviceId as number) ? deviceId : undefined,
    metadata: raw,
  }
}

function normalizeGraphEdge(raw: GraphEdgeWire): GraphEdge {
  const sourceObj = (raw.source && typeof raw.source === 'object') ? (raw.source as Record<string, unknown>) : null
  const targetObj = (raw.target && typeof raw.target === 'object') ? (raw.target as Record<string, unknown>) : null
  const aType = (raw.a_type || raw.from_type || raw.endpoint_a_type || raw.source_type || sourceObj?.type || 'device_port') as GraphEndpoint['type']
  const bType = (raw.b_type || raw.to_type || raw.endpoint_b_type || raw.target_type || targetObj?.type || 'device_port') as GraphEndpoint['type']
  const aId = raw.a_id || raw.from_id || raw.endpoint_a_id || raw.source_id || sourceObj?.id
  const bId = raw.b_id || raw.to_id || raw.endpoint_b_id || raw.target_id || targetObj?.id

  return {
    id: String(raw.id || raw.connection_id || `${aType}:${String(aId)}-${bType}:${String(bId)}`),
    kind: String(raw.kind || 'connection'),
    a: { type: aType, id: (aId as string | number) ?? '' },
    b: { type: bType, id: (bId as string | number) ?? '' },
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : (typeof raw.createdAt === 'string' ? raw.createdAt : undefined),
    createdBy: typeof raw.created_by === 'string' ? raw.created_by : (typeof raw.createdBy === 'string' ? raw.createdBy : undefined),
    metadata: raw,
  }
}

function buildDeviceFromExtraction(extraction: AIDeviceExtraction): ApiDevice {
  const brand = (extraction.device?.brand || '').trim()
  const model = (extraction.device?.model || '').trim()
  const name = brand && model ? `${brand} ${model}` : (brand || model || 'Unknown device')
  const { category, type } = normalizeDeviceClassification(extraction.device?.category || null)

  const ports: ApiPort[] = extraction.ports.map((port, index) => ({
    id: `ai-dev-0-port-${index + 1}`,
    label: port.label,
    type: mapAIPortDirection(port.direction),
    patchbay_id: null,
  }))

  return {
    id: 0,
    name,
    category,
    type,
    ports,
    image_url: null,
    image_updated_at: null,
  }
}

function normalizeDeviceClassification(rawTypeOrCategory?: string | null): { category: string; type: string } {
  const token = String(rawTypeOrCategory || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  const categoryByAlias: Record<string, string> = {
    mic: 'MIC',
    preamp: 'PREAMP',
    interface: 'INTERFACE',
    compressor: 'COMPRESSOR',
    patchpanel: 'PATCHPANEL',
    patch_panel: 'PATCHPANEL',
    panel: 'PATCHPANEL',
    patchbay: 'PATCHPANEL',
    instrument: 'INSTRUMENT',
    synth: 'INSTRUMENT',
    drum_machine: 'INSTRUMENT',
    monitor: 'MONITOR',
    headphone_amp: 'HEADPHONE_AMP',
    eq: 'EQ',
    mixer: 'MIXER',
    controller: 'CONTROLLER',
    effects: 'EFFECTS',
    amp: 'AMP',
    reamp: 'REAMP',
    other: 'OTHER',
    unknown: 'OTHER',
  }
  const subtypeByAlias: Record<string, string> = {
    patch_panel: 'patchpanel',
    panel: 'patchpanel',
    patchbay: 'patchpanel',
    unknown: 'other',
  }

  const category = categoryByAlias[token] || 'OTHER'
  const type = subtypeByAlias[token] || token || 'other'
  return { category, type }
}

function mapAIPortDirection(direction?: string | null): 'Input' | 'Output' | 'Other' {
  const value = (direction || '').toLowerCase()
  if (value === 'input') return 'Input'
  if (value === 'output') return 'Output'
  return 'Other'
}
