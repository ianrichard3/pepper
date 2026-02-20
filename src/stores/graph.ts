import { reactive } from 'vue'
import { api } from '@/lib/api'
import { store } from '@/store'
import type {
  CanvasEdge,
  CanvasEndpoint,
  CanvasPayload,
  CanvasScopeMode,
  CanvasSelectionState,
  CanvasNode,
} from '@/types/graph'

interface GraphScope {
  type: 'workspace' | 'device' | 'patchbay'
  deviceId?: number
  patchbayId?: number
  mode?: CanvasScopeMode
}

function endpointKey(endpoint: CanvasEndpoint): string {
  return `${endpoint.type}:${endpoint.id}`
}

function edgeIncludesEndpoint(edge: CanvasEdge, endpoint: CanvasEndpoint): boolean {
  const key = endpointKey(endpoint)
  return endpointKey(edge.a) === key || endpointKey(edge.b) === key
}

function buildConflictMessage(err: any): string {
  const detail = String(err?.message || '')
  if (detail.includes('HTTP 409')) {
    return 'Connection conflict: one endpoint is already occupied. Disconnect the existing edge first.'
  }
  if (detail.includes('HTTP 404')) {
    return 'Endpoint not found. The graph may be stale, please refresh.'
  }
  if (detail.includes('AUTH_FORBIDDEN')) {
    return 'Permission error while updating connection.'
  }
  return detail || 'Connection update failed.'
}

export const canvasStore = reactive({
  nodes: [] as CanvasNode[],
  edges: [] as CanvasEdge[],
  loading: false,
  error: null as string | null,
  scope: { type: 'workspace' } as GraphScope,
  selection: {
    selectedNodeId: null,
    selectedEdgeId: null,
    pendingEndpoint: null,
  } as CanvasSelectionState,

  get selectedNode() {
    if (!this.selection.selectedNodeId) return null
    return this.nodes.find((node: CanvasNode) => node.id === this.selection.selectedNodeId) ?? null
  },

  get selectedEdge() {
    if (!this.selection.selectedEdgeId) return null
    return this.edges.find((edge: CanvasEdge) => edge.id === this.selection.selectedEdgeId) ?? null
  },

  get connectedEndpointKeys() {
    const keys = new Set<string>()
    for (const edge of this.edges) {
      keys.add(endpointKey(edge.a))
      keys.add(endpointKey(edge.b))
    }
    return keys
  },

  endpointConnectionCount(endpoint: CanvasEndpoint): number {
    let count = 0
    for (const edge of this.edges) {
      if (edgeIncludesEndpoint(edge, endpoint)) count += 1
    }
    return count
  },

  setGraph(payload: CanvasPayload) {
    this.nodes = payload.nodes
    this.edges = payload.edges
  },

  async loadWorkspaceGraph() {
    this.loading = true
    this.error = null
    this.scope = { type: 'workspace' }
    try {
      const payload = await api.getGraph()
      this.setGraph(payload)
    } catch (err: any) {
      this.error = err?.message || 'Failed to load graph.'
    } finally {
      this.loading = false
    }
  },

  async loadDeviceGraph(deviceId: number, mode: CanvasScopeMode = 'direct') {
    this.loading = true
    this.error = null
    this.scope = { type: 'device', deviceId, mode }
    try {
      const payload = await api.getDeviceGraph(deviceId, { mode })
      this.setGraph(payload)
    } catch (err: any) {
      this.error = err?.message || 'Failed to load graph.'
    } finally {
      this.loading = false
    }
  },

  async loadPatchbayGraph(patchbayId: number, mode: CanvasScopeMode = 'direct') {
    this.loading = true
    this.error = null
    this.scope = { type: 'patchbay', patchbayId, mode }
    try {
      const payload = await api.getPatchbayGraph(patchbayId, { mode })
      this.setGraph(payload)
    } catch (err: any) {
      this.error = err?.message || 'Failed to load graph.'
    } finally {
      this.loading = false
    }
  },

  selectNode(nodeId: string | null) {
    this.selection.selectedNodeId = nodeId
    this.selection.selectedEdgeId = null
  },

  selectEdge(edgeId: string | null) {
    this.selection.selectedEdgeId = edgeId
    this.selection.selectedNodeId = null
  },

  setPendingEndpoint(endpoint: CanvasEndpoint | null) {
    this.selection.pendingEndpoint = endpoint
  },

  resetSelection() {
    this.selection.selectedEdgeId = null
    this.selection.selectedNodeId = null
    this.selection.pendingEndpoint = null
  },

  canConnect(a: CanvasEndpoint, b: CanvasEndpoint) {
    if (endpointKey(a) === endpointKey(b)) return false
    const pair = [a.type, b.type].sort().join(':')
    return pair === 'device_port:device_port' ||
      pair === 'device_port:patchbay_point' ||
      pair === 'patchbay_point:patchbay_point'
  },

  async connectEndpoints(a: CanvasEndpoint, b: CanvasEndpoint): Promise<boolean> {
    if (!this.canConnect(a, b)) {
      this.error = 'Invalid endpoint pair. Allowed: device-port/device-port, device-port/patchbay-point, patchbay-point/patchbay-point.'
      return false
    }

    this.error = null
    try {
      const created = await api.createConnection({ a, b })
      const duplicate = this.edges.some((edge) => edge.id === created.id)
      if (!duplicate) this.edges.push(created)
      await store.syncConnectionsProjectionSafe()
      this.resetSelection()
      return true
    } catch (err: any) {
      this.error = buildConflictMessage(err)
      store.pushToast({ type: 'error', message: this.error })
      return false
    }
  },

  async disconnectEdge(edgeId: string): Promise<boolean> {
    this.error = null
    try {
      await api.deleteConnection(edgeId)
      this.edges = this.edges.filter((edge) => edge.id !== edgeId)
      await store.syncConnectionsProjectionSafe()
      if (this.selection.selectedEdgeId === edgeId) {
        this.selection.selectedEdgeId = null
      }
      this.selection.pendingEndpoint = null
      return true
    } catch (err: any) {
      this.error = buildConflictMessage(err)
      store.pushToast({ type: 'error', message: this.error })
      return false
    }
  },
})
