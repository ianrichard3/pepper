import type { NodeCanvasState } from '@/lib/api'

export type NodeKind = 'device' | 'device-port' | 'patchbay'
export type PortDirection = 'in' | 'out' | 'io'

export interface NodeGraphPort {
  id: string
  name: string
  direction: PortDirection
}

export interface NodeCanvasNode {
  id: string
  title: string
  subtitle: string
  kind: NodeKind
  details: string[]
  ports: NodeGraphPort[]
  x: number
  y: number
  deviceId?: string | null
}

export interface NodeGraphCable {
  id: string
  fromNodeId: string
  fromPortId: string
  toNodeId: string
  toPortId: string
}

export interface NodeGraphSnapshot {
  nodes: NodeCanvasNode[]
  cables: NodeGraphCable[]
  pan: { x: number; y: number }
  scale: number
}

export function toPersistedState(snapshot: NodeGraphSnapshot, extraUiFlags?: Record<string, unknown>): NodeCanvasState {
  return {
    schemaVersion: '1',
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      deviceId: node.deviceId ?? null,
      position: {
        x: node.x,
        y: node.y,
      },
      ui: {
        title: node.title,
        subtitle: node.subtitle,
        kind: node.kind,
        details: node.details,
        ports: node.ports,
      },
    })),
    edges: snapshot.cables.map((cable) => ({
      id: cable.id,
      source: cable.fromNodeId,
      target: cable.toNodeId,
      sourceHandle: cable.fromPortId,
      targetHandle: cable.toPortId,
    })),
    viewport: {
      x: snapshot.pan.x,
      y: snapshot.pan.y,
      zoom: snapshot.scale,
    },
    uiFlags: extraUiFlags,
  }
}

export function fromPersistedState(state: NodeCanvasState): NodeGraphSnapshot {
  const rawNodes = Array.isArray(state.nodes) ? state.nodes : []
  const rawEdges = Array.isArray(state.edges) ? state.edges : []

  const nodes: NodeCanvasNode[] = rawNodes.map((node) => {
    const ui = node.ui ?? {}
    const rawPorts = Array.isArray(ui.ports) ? ui.ports : []

    const ports: NodeGraphPort[] = rawPorts
      .map((port) => {
        if (!port || typeof port !== 'object') return null
        const portObj = port as Record<string, unknown>
        const id = typeof portObj.id === 'string' ? portObj.id : null
        if (!id) return null
        return {
          id,
          name: typeof portObj.name === 'string' ? portObj.name : id,
          direction: normalizePortDirection(portObj.direction),
        }
      })
      .filter((port): port is NodeGraphPort => port !== null)

    return {
      id: node.id,
      deviceId: typeof node.deviceId === 'string' ? node.deviceId : null,
      title: typeof ui.title === 'string' ? ui.title : node.id,
      subtitle: typeof ui.subtitle === 'string' ? ui.subtitle : 'Device',
      kind: normalizeNodeKind(ui.kind),
      details: Array.isArray(ui.details) ? ui.details.filter((detail): detail is string => typeof detail === 'string') : [],
      ports,
      x: Number.isFinite(node.position?.x) ? node.position.x : 0,
      y: Number.isFinite(node.position?.y) ? node.position.y : 0,
    }
  })

  const nodeIds = new Set(nodes.map((node) => node.id))

  const cables: NodeGraphCable[] = rawEdges
    .map((edge) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null
      if (!edge.sourceHandle || !edge.targetHandle) return null

      const sourceNode = nodes.find((node) => node.id === edge.source)
      const targetNode = nodes.find((node) => node.id === edge.target)
      if (!sourceNode || !targetNode) return null

      const sourcePortExists = sourceNode.ports.some((port) => port.id === edge.sourceHandle)
      const targetPortExists = targetNode.ports.some((port) => port.id === edge.targetHandle)
      if (!sourcePortExists || !targetPortExists) return null

      return {
        id: edge.id,
        fromNodeId: edge.source,
        fromPortId: edge.sourceHandle,
        toNodeId: edge.target,
        toPortId: edge.targetHandle,
      }
    })
    .filter((cable): cable is NodeGraphCable => cable !== null)

  return {
    nodes,
    cables,
    pan: {
      x: state.viewport?.x ?? 40,
      y: state.viewport?.y ?? 40,
    },
    scale: state.viewport?.zoom ?? 1,
  }
}

function normalizePortDirection(direction: unknown): PortDirection {
  if (direction === 'in' || direction === 'out' || direction === 'io') {
    return direction
  }
  return 'io'
}

function normalizeNodeKind(kind: unknown): NodeKind {
  if (kind === 'device' || kind === 'device-port' || kind === 'patchbay') {
    return kind
  }
  return 'device'
}
