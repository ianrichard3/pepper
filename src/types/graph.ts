export type GraphScopeMode = 'direct' | 'reachable'

export type GraphNodeKind = 'device' | 'port' | 'patchbay_point'

export type GraphEndpointType = 'device_port' | 'patchbay_point'

export interface GraphEndpoint {
  type: GraphEndpointType
  id: string | number
}

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  description?: string
  endpoint?: GraphEndpoint
  deviceId?: number
  metadata?: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  kind: string
  a: GraphEndpoint
  b: GraphEndpoint
  createdAt?: string
  createdBy?: string
  metadata?: Record<string, unknown>
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphSelectionState {
  selectedNodeId: string | null
  selectedEdgeId: string | null
  pendingEndpoint: GraphEndpoint | null
}
