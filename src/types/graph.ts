export type CanvasScopeMode = 'direct' | 'reachable'

export type CanvasNodeKind = 'device' | 'port' | 'patchbay_point'

export type CanvasEndpointType = 'device_port' | 'patchbay_point'

export interface CanvasEndpoint {
  type: CanvasEndpointType
  id: string | number
}

export interface CanvasNode {
  id: string
  kind: CanvasNodeKind
  label: string
  description?: string
  endpoint?: CanvasEndpoint
  deviceId?: number
  metadata?: Record<string, unknown>
}

export interface CanvasEdge {
  id: string
  kind: string
  a: CanvasEndpoint
  b: CanvasEndpoint
  createdAt?: string
  createdBy?: string
  metadata?: Record<string, unknown>
}

export interface CanvasPayload {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface CanvasSelectionState {
  selectedNodeId: string | null
  selectedEdgeId: string | null
  pendingEndpoint: CanvasEndpoint | null
}
