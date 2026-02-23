<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useNodeCanvasPersistence } from '@/composables/useNodeCanvasPersistence'
import { api, type ApiDeviceMatchResponse, type ApiIntent, type NodeCanvasConnectionsLookupStatus } from '@/lib/api'
import { useEntitlements } from '@/lib/useEntitlements'
import { windowManager } from '@/stores/windowManager'
import {
  fromPersistedState,
  toPersistedState,
  type NodeKind,
  type NodeGraphCable as CableConnection,
  type NodeCanvasNode as CanvasNode,
  type NodeGraphPort as NodePort,
} from '@/features/nodeCanvas/model'
import { store } from '@/store'

const props = withDefaults(defineProps<{
  floatingMode?: boolean
  parentWindowId?: string
}>(), {
  floatingMode: false,
  parentWindowId: '',
})

interface DragState {
  nodeIds: string[];
  anchorNodeId: string;
  anchorOffsetX: number;
  anchorOffsetY: number;
  startPositionsById: Record<string, { x: number; y: number }>;
}

interface PanState {
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
}

interface SelectionBoxState {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  toggleMode: boolean;
  baseSelectedNodeIds: string[];
}

interface NodeTemplate {
  templateId: string;
  title: string;
  subtitle: string;
  kind: NodeKind;
  details: string[];
  ports: NodePort[];
  deviceId?: number;
  patchbayMeta?: {
    tag?: string | null;
    panel?: string | null;
  };
}

interface CableDraft {
  fromNodeId: string;
  fromPortId: string;
  cursorX: number;
  cursorY: number;
}

interface ExistingComponentInfo {
  componentHandles: string[];
  componentEdgeIds: number[];
  componentEdges: NonNullable<NodeCanvasConnectionsLookupStatus['component_edges']>;
}

interface PanelDragState {
  panel: 'tools' | 'intent' | 'add';
  startClientX: number;
  startClientY: number;
  startPanelX: number;
  startPanelY: number;
}

const GRID_SIZE = 24
const NODE_WIDTH = 188
const NODE_HEIGHT = 88
const BOARD_PADDING = 24
const WORLD_WIDTH = 2200
const WORLD_HEIGHT = 1400
const MIN_SCALE = 0.4
const MAX_SCALE = 2
const HOVER_TOOLTIP_DELAY_MS = 280
const DEFAULT_PAN = { x: 40, y: 40 }
const DEFAULT_SCALE = 1

const INITIAL_NODES: CanvasNode[] = []
const INITIAL_CABLES: CableConnection[] = []

const boardRef = ref<HTMLElement | null>(null)
const toolsPanelRef = ref<HTMLElement | null>(null)
const intentPanelRef = ref<HTMLElement | null>(null)
const addPanelRef = ref<HTMLElement | null>(null)
const persistence = useNodeCanvasPersistence({ debounceMs: 600 })
const { canRunIntentDeviceMatch } = useEntitlements()
const hasMovedNodeDuringDrag = ref(false)
const hasPannedDuringGesture = ref(false)
const nodes = ref<CanvasNode[]>(
  INITIAL_NODES.map((node) => ({
    ...node,
    details: [...node.details],
    ports: node.ports.map((port) => ({ ...port })),
  })),
)
const cables = ref<CableConnection[]>(INITIAL_CABLES.map((cable) => ({ ...cable })))
const dragging = ref<DragState | null>(null)
const panning = ref<PanState | null>(null)
const isSpacePressed = ref(false)
const selectionBox = ref<SelectionBoxState | null>(null)
const selectedNodeIds = ref<string[]>([])
const primarySelectedNodeId = ref<string | null>(null)
const scale = ref(DEFAULT_SCALE)
const pan = ref({ ...DEFAULT_PAN })

const showAddModal = ref(false)
const showIntentPanel = ref(true)
const toolsPanel = ref({ x: 10, y: 10, minimized: false })
const intentPanel = ref({ x: 10, y: 10 })
const addPanel = ref({ x: 12, y: 84 })
const panelDrag = ref<PanelDragState | null>(null)
const panelPositionsInitialized = ref(false)
const catalogTab = ref<'devices' | 'patchbay'>('devices')
const addSearchQuery = ref('')

const showConnectModal = ref(false)
const connectTargetNodeId = ref<string | null>(null)
const connectConflictMessage = ref<string | null>(null)

const intentPrompt = ref('')
const intentMatchLoading = ref(false)
const intentMatchError = ref<string | null>(null)

const cableDraft = ref<CableDraft | null>(null)

const hoveredNodeId = ref<string | null>(null)
const hoverPreviewNodeId = ref<string | null>(null)
const pinnedTooltipNodeId = ref<string | null>(null)
const hoverProgress = ref(0)
const hoverDelayTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const hoverProgressTimer = ref<ReturnType<typeof setInterval> | null>(null)
const hideHoverTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const isHoveringTooltip = ref(false)

const hoveredCableId = ref<string | null>(null)
const isHoveringCableTooltip = ref(false)
const cableHideTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const isApplyingConnections = ref(false)
const isRefreshingConnections = ref(false)
const applyStatusMessage = ref<string | null>(null)
const applyErrorMessage = ref<string | null>(null)
const applyUndoPayload = ref<{ created_connection_ids: number[]; deleted_connection_ids: number[] } | null>(null)
const existingComponentByNodeId = ref<Record<string, ExistingComponentInfo>>({})
const revealedChainHandles = ref<string[]>([])
const revealedChainEdgeIds = ref<number[]>([])
const connectedNoticeNodeId = ref<string | null>(null)

const graphParentWindowId = computed(() => {
  return props.parentWindowId || windowManager.getToolWindow('graph')?.id || 'tool:graph'
})

const closeFloatingConnectWindows = () => {
  for (const item of [...windowManager.windows]) {
    if (item.kind === 'canvas-select-port' && item.parentId === graphParentWindowId.value) {
      windowManager.closeWindow(item.id)
    }
  }
}

const nodeMap = computed(() => {
  return new Map(nodes.value.map((node) => [node.id, node]))
})

const cableByPortKey = computed(() => {
  const map = new Map<string, CableConnection[]>()
  for (const cable of cables.value) {
    const fromKey = `${cable.fromNodeId}:${cable.fromPortId}`
    const toKey = `${cable.toNodeId}:${cable.toPortId}`
    map.set(fromKey, [...(map.get(fromKey) ?? []), cable])
    map.set(toKey, [...(map.get(toKey) ?? []), cable])
  }
  return map
})

const cableGeometry = computed(() => {
  return cables.value
    .map((cable) => {
      const fromNode = nodeMap.value.get(cable.fromNodeId)
      const toNode = nodeMap.value.get(cable.toNodeId)
      if (!fromNode || !toNode) return null

      const fromX = fromNode.x + NODE_WIDTH
      const fromY = fromNode.y + NODE_HEIGHT * 0.5
      const toX = toNode.x
      const toY = toNode.y + NODE_HEIGHT * 0.5
      const midX = fromX + (toX - fromX) * 0.5
      const midY = (fromY + toY) * 0.5
      const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`

      return {
        id: cable.id,
        path,
        midX,
        midY,
        cable,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
})

const draftCablePath = computed(() => {
  if (!cableDraft.value) return null
  const fromNode = nodeMap.value.get(cableDraft.value.fromNodeId)
  if (!fromNode) return null

  const fromX = fromNode.x + NODE_WIDTH
  const fromY = fromNode.y + NODE_HEIGHT * 0.5
  const toX = cableDraft.value.cursorX
  const toY = cableDraft.value.cursorY
  const midX = fromX + (toX - fromX) * 0.5

  return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
})

const worldStyle = computed(() => {
  return {
    transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${scale.value})`,
  }
})

const zoomPercent = computed(() => `${Math.round(scale.value * 100)}%`)

const hasSelectedNodes = computed(() => selectedNodeIds.value.length > 0)

const draggingNodeIdSet = computed(() => new Set(dragging.value?.nodeIds ?? []))

const isNodeSelected = (nodeId: string) => selectedNodeIds.value.includes(nodeId)

const selectionBoxRect = computed(() => {
  if (!selectionBox.value) return null
  const left = Math.min(selectionBox.value.startWorldX, selectionBox.value.currentWorldX)
  const top = Math.min(selectionBox.value.startWorldY, selectionBox.value.currentWorldY)
  const right = Math.max(selectionBox.value.startWorldX, selectionBox.value.currentWorldX)
  const bottom = Math.max(selectionBox.value.startWorldY, selectionBox.value.currentWorldY)
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
})

const selectionBoxStyle = computed(() => {
  if (!selectionBoxRect.value) return { display: 'none' }
  return {
    left: `${selectionBoxRect.value.left}px`,
    top: `${selectionBoxRect.value.top}px`,
    width: `${selectionBoxRect.value.width}px`,
    height: `${selectionBoxRect.value.height}px`,
  }
})

const clearSelection = () => {
  selectedNodeIds.value = []
  primarySelectedNodeId.value = null
}

const setSelection = (nodeIds: string[], preferredPrimaryId?: string | null) => {
  selectedNodeIds.value = nodeIds
  if (nodeIds.length === 0) {
    primarySelectedNodeId.value = null
    return
  }
  if (preferredPrimaryId && nodeIds.includes(preferredPrimaryId)) {
    primarySelectedNodeId.value = preferredPrimaryId
    return
  }
  if (primarySelectedNodeId.value && nodeIds.includes(primarySelectedNodeId.value)) {
    return
  }
  primarySelectedNodeId.value = nodeIds[nodeIds.length - 1]
}

const selectSingleNode = (nodeId: string) => {
  selectedNodeIds.value = [nodeId]
  primarySelectedNodeId.value = nodeId
}

const toggleNodeSelection = (nodeId: string) => {
  if (isNodeSelected(nodeId)) {
    selectedNodeIds.value = selectedNodeIds.value.filter((id) => id !== nodeId)
    if (primarySelectedNodeId.value === nodeId) {
      primarySelectedNodeId.value = selectedNodeIds.value[selectedNodeIds.value.length - 1] ?? null
    }
    return
  }
  selectedNodeIds.value = [...selectedNodeIds.value, nodeId]
  primarySelectedNodeId.value = nodeId
}

const isNodeDragging = (nodeId: string) => draggingNodeIdSet.value.has(nodeId)

const getDragSelection = (nodeId: string) => {
  return isNodeSelected(nodeId) ? [...selectedNodeIds.value] : [nodeId]
}

const getNodesIntersectingSelectionBox = () => {
  if (!selectionBoxRect.value) return []
  const { left, top, right, bottom } = selectionBoxRect.value
  return nodes.value
    .filter((node) => {
      const nodeLeft = node.x
      const nodeTop = node.y
      const nodeRight = node.x + NODE_WIDTH
      const nodeBottom = node.y + NODE_HEIGHT
      return nodeRight >= left && nodeLeft <= right && nodeBottom >= top && nodeTop <= bottom
    })
    .map((node) => node.id)
}

const applySelectionBoxSelection = () => {
  if (!selectionBox.value) return
  const intersecting = getNodesIntersectingSelectionBox()
  const intersectingSet = new Set(intersecting)
  let nextSelection: string[]
  if (selectionBox.value.toggleMode) {
    const nextSet = new Set(selectionBox.value.baseSelectedNodeIds)
    for (const nodeId of intersecting) {
      if (nextSet.has(nodeId)) nextSet.delete(nodeId)
      else nextSet.add(nodeId)
    }
    nextSelection = [...nextSet]
  } else {
    nextSelection = intersecting
  }
  const preferredPrimary = [...intersectingSet].reverse().find((id) => nextSelection.includes(id)) ?? null
  setSelection(nextSelection, preferredPrimary)
}

const startPanGesture = (event: PointerEvent) => {
  panning.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanX: pan.value.x,
    startPanY: pan.value.y,
  }
  hasPannedDuringGesture.value = false
}

const shouldStartPanGesture = (event: PointerEvent) => {
  return event.button === 1 || (event.button === 0 && isSpacePressed.value)
}

const clampPanelPosition = (panelEl: HTMLElement | null, x: number, y: number) => {
  const boardEl = boardRef.value
  if (!boardEl || !panelEl) return { x, y }
  const margin = 8
  const maxX = Math.max(margin, boardEl.clientWidth - panelEl.offsetWidth - margin)
  const maxY = Math.max(margin, boardEl.clientHeight - panelEl.offsetHeight - margin)
  return {
    x: clamp(x, margin, maxX),
    y: clamp(y, margin, maxY),
  }
}

const initializePanelPositions = () => {
  if (panelPositionsInitialized.value) return
  const boardEl = boardRef.value
  const toolsEl = toolsPanelRef.value
  if (!boardEl || !toolsEl) return
  const margin = 10
  toolsPanel.value.x = Math.max(margin, boardEl.clientWidth - toolsEl.offsetWidth - margin)
  toolsPanel.value.y = margin
  intentPanel.value.x = margin
  intentPanel.value.y = margin
  addPanel.value.x = margin
  addPanel.value.y = 84
  panelPositionsInitialized.value = true
}

const startPanelDrag = (panel: 'tools' | 'intent' | 'add', event: PointerEvent) => {
  if (event.button !== 0) return
  if ((event.target as HTMLElement | null)?.closest('.panel-action-btn')) return
  event.preventDefault()
  event.stopPropagation()
  const current = panel === 'tools' ? toolsPanel.value : panel === 'intent' ? intentPanel.value : addPanel.value
  panelDrag.value = {
    panel,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanelX: current.x,
    startPanelY: current.y,
  }
}

const clampPanelsToBoard = () => {
  toolsPanel.value = {
    ...toolsPanel.value,
    ...clampPanelPosition(toolsPanelRef.value, toolsPanel.value.x, toolsPanel.value.y),
  }
  if (showIntentPanel.value) {
    intentPanel.value = {
      ...intentPanel.value,
      ...clampPanelPosition(intentPanelRef.value, intentPanel.value.x, intentPanel.value.y),
    }
  }
  if (showAddModal.value) {
    addPanel.value = {
      ...addPanel.value,
      ...clampPanelPosition(addPanelRef.value, addPanel.value.x, addPanel.value.y),
    }
  }
}

const activeTooltipNode = computed(() => {
  const activeId = pinnedTooltipNodeId.value ?? hoverPreviewNodeId.value
  if (!activeId) return null
  return nodeMap.value.get(activeId) ?? null
})

const isTooltipPinned = computed(() => {
  return !!pinnedTooltipNodeId.value
})

const activeConnectTargetNode = computed(() => {
  if (!connectTargetNodeId.value) return null
  return nodeMap.value.get(connectTargetNodeId.value) ?? null
})

const hoveredCableGeometry = computed(() => {
  if (!hoveredCableId.value) return null
  return cableGeometry.value.find((item) => item.id === hoveredCableId.value) ?? null
})

const hoveredCableLabel = computed(() => {
  if (!hoveredCableGeometry.value) return null
  const cable = hoveredCableGeometry.value.cable

  const fromNode = nodeMap.value.get(cable.fromNodeId)
  const toNode = nodeMap.value.get(cable.toNodeId)
  const fromPort = fromNode?.ports.find((port) => port.id === cable.fromPortId)
  const toPort = toNode?.ports.find((port) => port.id === cable.toPortId)

  if (!fromNode || !toNode || !fromPort || !toPort) return null
  return `${fromNode.title} (${fromPort.name}) -> ${toNode.title} (${toPort.name})`
})

const tooltipProgressStyle = computed(() => {
  return {
    width: `${Math.max(0, Math.min(100, hoverProgress.value))}%`,
  }
})

const tooltipStyle = computed(() => {
  if (!activeTooltipNode.value) return { display: 'none' }

  const x = activeTooltipNode.value.x + NODE_WIDTH + 12
  const y = activeTooltipNode.value.y
  return {
    left: `${x}px`,
    top: `${y}px`,
  }
})

const cableHoverTooltipStyle = computed(() => {
  if (!hoveredCableGeometry.value) return { display: 'none' }
  return {
    left: `${hoveredCableGeometry.value.midX + 10}px`,
    top: `${hoveredCableGeometry.value.midY - 12}px`,
  }
})

const deviceCatalog = computed<NodeTemplate[]>(() => {
  return store.devices.map((device) => ({
    templateId: `device-${device.id}`,
    title: device.name,
    subtitle: 'Device',
    kind: 'device',
    details: [`Type: ${device.type}`, `Ports: ${device.ports.length}`],
    deviceId: device.id,
    ports: device.ports.length
      ? device.ports.map((port) => ({
          id: port.id,
          name: port.label,
          direction: mapStorePortDirection(port.type),
        }))
      : [{ id: `port-${device.id}`, name: 'Port', direction: 'io' as const }],
  }))
})

const patchbayCatalog = computed<NodeTemplate[]>(() => {
  return store.patchbayNodes.map((point) => ({
    templateId: `patchbay-${point.id}`,
    title: point.name,
    subtitle: 'Patchbay Port',
    kind: 'patchbay',
    details: [point.description, `Type: ${point.type}`].filter((detail): detail is string => Boolean(detail)),
    patchbayMeta: {
      tag: point.tag ?? null,
      panel: point.panel ?? null,
    },
    ports: [{ id: `pb-${point.id}`, name: 'Signal', direction: 'io' }],
  }))
})

const findDeviceTemplateByHandle = (handle: string): NodeTemplate | null => {
  const match = handle.match(/^dev-(\d+)-port-\d+$/)
  if (!match) return null
  const deviceId = Number(match[1])
  const device = store.devices.find((item) => item.id === deviceId)
  if (!device) return null
  return {
    templateId: `device-${device.id}`,
    title: device.name,
    subtitle: 'Device',
    kind: 'device',
    details: [`Type: ${device.type}`, `Ports: ${device.ports.length}`],
    deviceId: device.id,
    ports: device.ports.length
      ? device.ports.map((port) => ({
          id: port.id,
          name: port.label,
          direction: mapStorePortDirection(port.type),
        }))
      : [{ id: `port-${device.id}`, name: 'Port', direction: 'io' as const }],
  }
}

const findPatchbayTemplateByHandle = (handle: string): NodeTemplate | null => {
  const match = handle.match(/^pb-(\d+)$/)
  if (!match) return null
  const patchbayId = Number(match[1])
  const point = store.patchbayNodes.find((item) => item.id === patchbayId)
  if (!point) return null
  return {
    templateId: `patchbay-${point.id}`,
    title: point.name,
    subtitle: 'Patchbay Port',
    kind: 'patchbay',
    details: [point.description, `Type: ${point.type}`].filter((detail): detail is string => Boolean(detail)),
    patchbayMeta: {
      tag: point.tag ?? null,
      panel: point.panel ?? null,
    },
    ports: [{ id: `pb-${point.id}`, name: 'Signal', direction: 'io' }],
  }
}

const activeCatalog = computed<NodeTemplate[]>(() => {
  return catalogTab.value === 'devices' ? deviceCatalog.value : patchbayCatalog.value
})

const filteredCatalog = computed(() => {
  const query = addSearchQuery.value.trim().toLowerCase()
  if (!query) return activeCatalog.value

  return activeCatalog.value.filter((item) => {
    const patchbayMeta = item.patchbayMeta
      ? `${patchbayLocationLabel(item) ?? ''} ${item.patchbayMeta.tag ?? ''}`
      : ''
    const haystack = `${item.title} ${item.subtitle} ${item.details.join(' ')} ${item.ports.map((port) => port.name).join(' ')} ${patchbayMeta}`.toLowerCase()
    return haystack.includes(query)
  })
})

const draftSourceLabel = computed(() => {
  if (!cableDraft.value) return null

  const fromNode = nodeMap.value.get(cableDraft.value.fromNodeId)
  const fromPort = fromNode?.ports.find((port) => port.id === cableDraft.value?.fromPortId)
  if (!fromNode || !fromPort) return null

  return `${fromNode.title} (${fromPort.name})`
})

const persistenceStatusLabel = computed(() => {
  if (persistence.isLoading.value) return 'Loading canvas...'
  if (persistence.readOnly.value) return 'Read-only (admin required)'
  if (persistence.isSaving.value) return 'Saving...'
  if (persistence.error.value) return 'Unsaved changes'
  if (persistence.dirty.value) return 'Unsaved changes'
  if (persistence.lastSavedAt.value) return 'Saved'
  return 'Not saved'
})

const revealedChainHandleSet = computed(() => new Set(revealedChainHandles.value))

const activeTooltipNodeComponent = computed(() => {
  if (!activeTooltipNode.value) return null
  return existingComponentByNodeId.value[activeTooltipNode.value.id] ?? null
})

const connectedNotice = computed(() => {
  if (!connectedNoticeNodeId.value) return null
  const node = nodeMap.value.get(connectedNoticeNodeId.value)
  if (!node) return null
  const component = existingComponentByNodeId.value[node.id]
  if (!component) return null
  return {
    nodeId: node.id,
    nodeTitle: node.title,
    count: component.componentHandles.length,
  }
})

const hasRevealedChain = computed(() => revealedChainHandles.value.length > 0)

const getNodeClass = (kind: NodeKind) => {
  return {
    device: kind === 'device',
    port: kind === 'device-port',
    patchbay: kind === 'patchbay',
  }
}

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(value, max))
}

const snapToGrid = (value: number) => {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

const normalizeWorldNodePlacement = (worldX: number, worldY: number) => {
  const maxX = WORLD_WIDTH - NODE_WIDTH - BOARD_PADDING
  const maxY = WORLD_HEIGHT - NODE_HEIGHT - BOARD_PADDING
  return {
    x: snapToGrid(clamp(worldX, BOARD_PADDING, maxX)),
    y: snapToGrid(clamp(worldY, BOARD_PADDING, maxY)),
  }
}

const patchbayLocationLabel = (item: NodeTemplate) => {
  if (!item.patchbayMeta) return null
  const parts: string[] = []
  if (item.patchbayMeta.panel) parts.push(`Panel ${item.patchbayMeta.panel}`)
  if (parts.length === 0) return null
  return parts.join(' • ')
}

const mapStorePortDirection = (type: string): NodePort['direction'] => {
  if (type === 'Input') return 'in'
  if (type === 'Output') return 'out'
  return 'io'
}

const isLookupHandle = (value: string) => {
  return value.startsWith('dev-') || /^pb-\d+$/.test(value)
}

const handleFromEndpoint = (endpointType: 'device_port' | 'patchbay_point', endpointId: string) => {
  if (endpointType === 'device_port') return endpointId
  return `pb-${endpointId}`
}

const parseHandleEndpointType = (handle: string): 'device_port' | 'patchbay_point' | null => {
  if (handle.startsWith('dev-')) return 'device_port'
  if (/^pb-\d+$/.test(handle)) return 'patchbay_point'
  return null
}

const slotForPeerType = (peerType: 'device_port' | 'patchbay_point'): 'device' | 'patchbay' => {
  return peerType === 'device_port' ? 'device' : 'patchbay'
}

const slotForPeerHandle = (peerHandle: string): 'device' | 'patchbay' | null => {
  const peerType = parseHandleEndpointType(peerHandle)
  if (!peerType) return null
  return slotForPeerType(peerType)
}

const cableUsesEndpointSlot = (
  cable: CableConnection,
  endpointHandle: string,
  peerSlot: 'device' | 'patchbay',
) => {
  if (cable.fromPortId === endpointHandle) {
    return slotForPeerHandle(cable.toPortId) === peerSlot
  }
  if (cable.toPortId === endpointHandle) {
    return slotForPeerHandle(cable.fromPortId) === peerSlot
  }
  return false
}

const mergeConnectedStatuses = (statuses: NodeCanvasConnectionsLookupStatus[]) => {
  const connected = statuses.filter((item) => item.already_connected)
  if (connected.length === 0) return null

  const handleSet = new Set<string>()
  const edgeIdSet = new Set<number>()
  const edgeById = new Map<number, NonNullable<NodeCanvasConnectionsLookupStatus['component_edges']>[number]>()
  const fallbackEdges = new Map<string, NonNullable<NodeCanvasConnectionsLookupStatus['component_edges']>[number]>()

  for (const status of connected) {
    for (const handle of status.component_handles) {
      handleSet.add(handle)
    }
    for (const edgeId of status.component_edge_ids) {
      edgeIdSet.add(edgeId)
    }
    for (const edge of status.component_edges ?? []) {
      if (typeof edge.id === 'number') {
        edgeById.set(edge.id, edge)
        continue
      }
      const a = handleFromEndpoint(edge.a_type, edge.a_id)
      const b = handleFromEndpoint(edge.b_type, edge.b_id)
      const key = [a, b].sort().join('::')
      fallbackEdges.set(key, edge)
    }
  }

  const mergedEdges = [
    ...Array.from(edgeById.entries())
      .sort((a, b) => a[0] - b[0])
      .map((item) => item[1]),
    ...Array.from(fallbackEdges.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map((item) => item[1]),
  ]

  return {
    component_handles: Array.from(handleSet).sort((a, b) => a.localeCompare(b)),
    component_edge_ids: Array.from(edgeIdSet).sort((a, b) => a - b),
    component_edges: mergedEdges,
  }
}

const isNodeInRevealedChain = (node: CanvasNode) => {
  return node.ports.some((port) => revealedChainHandleSet.value.has(port.id))
}

const isPortInRevealedChain = (portId: string) => {
  return revealedChainHandleSet.value.has(portId)
}

const isCableInRevealedChain = (cable: CableConnection) => {
  return isPortInRevealedChain(cable.fromPortId) && isPortInRevealedChain(cable.toPortId)
}

const clearRevealedChain = () => {
  revealedChainHandles.value = []
  revealedChainEdgeIds.value = []
}

const buildDefaultNodesFromDevices = (): CanvasNode[] => {
  if (store.devices.length === 0) {
    return INITIAL_NODES.map((node) => ({
      ...node,
      details: [...node.details],
      ports: node.ports.map((port) => ({ ...port })),
    }))
  }

  const columns = 4
  const horizontalGap = 280
  const verticalGap = 170
  const startX = 96
  const startY = 112

  return store.devices.map((device, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = startX + column * horizontalGap
    const y = startY + row * verticalGap
    const ports = device.ports.length
      ? device.ports.map((port) => ({
          id: port.id,
          name: port.label,
          direction: mapStorePortDirection(port.type),
        }))
      : [{ id: `port-${device.id}`, name: 'Port', direction: 'io' as const }]

    return {
      id: `device-${device.id}`,
      deviceId: String(device.id),
      title: device.name,
      subtitle: 'Device',
      kind: 'device',
      details: [`Type: ${device.type}`, `Ports: ${device.ports.length}`],
      ports,
      x,
      y,
    }
  })
}

const buildSnapshotState = () => {
  return toPersistedState({
    nodes: nodes.value,
    cables: cables.value,
    pan: pan.value,
    scale: scale.value,
  })
}

const scheduleStateSave = () => {
  persistence.scheduleSave(buildSnapshotState())
}

const saveStateNow = async () => {
  await persistence.saveNow(buildSnapshotState())
}

const lookupExistingComponentForNode = async (node: CanvasNode) => {
  const handles = node.ports.map((port) => port.id).filter(isLookupHandle)
  if (handles.length === 0) return

  try {
    const response = await api.lookupNodeCanvasConnections({ handles })
    const connected = mergeConnectedStatuses(response.statuses)
    if (!connected) return

    existingComponentByNodeId.value = {
      ...existingComponentByNodeId.value,
      [node.id]: {
        componentHandles: connected.component_handles,
        componentEdgeIds: connected.component_edge_ids,
        componentEdges: connected.component_edges ?? [],
      },
    }
    connectedNoticeNodeId.value = node.id
  } catch {
    // Non-fatal: this is informational UX only.
  }
}

const revealExistingChainForNode = (nodeId: string) => {
  const component = existingComponentByNodeId.value[nodeId]
  if (!component) return
  const existingHandleSet = new Set(nodes.value.flatMap((node) => node.ports.map((port) => port.id)))
  const missingTemplates = new Map<string, NodeTemplate>()
  for (const handle of component.componentHandles) {
    if (existingHandleSet.has(handle)) continue
    const template = handle.startsWith('dev-')
      ? findDeviceTemplateByHandle(handle)
      : findPatchbayTemplateByHandle(handle)
    if (!template) continue
    missingTemplates.set(template.templateId, template)
  }

  if (missingTemplates.size > 0) {
    const center = getViewportCenterWorld()
    const maxX = WORLD_WIDTH - NODE_WIDTH - BOARD_PADDING
    const maxY = WORLD_HEIGHT - NODE_HEIGHT - BOARD_PADDING
    let idx = 0
    for (const template of missingTemplates.values()) {
      const offsetCol = idx % 3
      const offsetRow = Math.floor(idx / 3)
      const x = snapToGrid(clamp(center.x - NODE_WIDTH * 0.5 + offsetCol * (NODE_WIDTH + 36), BOARD_PADDING, maxX))
      const y = snapToGrid(clamp(center.y - NODE_HEIGHT * 0.5 + offsetRow * (NODE_HEIGHT + 28), BOARD_PADDING, maxY))
      nodes.value.push({
        id: `${template.kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}-${idx}`,
        title: template.title,
        subtitle: template.subtitle,
        kind: template.kind,
        details: [...template.details],
        ports: template.ports.map((port) => ({ ...port })),
        x,
        y,
      })
      idx += 1
    }
  }

  const portOwnerNodeIdByHandle = new Map<string, string>()
  for (const node of nodes.value) {
    for (const port of node.ports) {
      if (!portOwnerNodeIdByHandle.has(port.id)) {
        portOwnerNodeIdByHandle.set(port.id, node.id)
      }
    }
  }

  for (const edge of component.componentEdges) {
    const sourceHandle = edge.sourceHandle ?? handleFromEndpoint(edge.a_type, edge.a_id)
    const targetHandle = edge.targetHandle ?? handleFromEndpoint(edge.b_type, edge.b_id)
    const fromNodeId = portOwnerNodeIdByHandle.get(sourceHandle)
    const toNodeId = portOwnerNodeIdByHandle.get(targetHandle)
    if (!fromNodeId || !toNodeId) continue

    const alreadyPresent = cables.value.some((cable) => {
      const sameDirection = cable.fromNodeId === fromNodeId && cable.fromPortId === sourceHandle && cable.toNodeId === toNodeId && cable.toPortId === targetHandle
      const reverseDirection = cable.fromNodeId === toNodeId && cable.fromPortId === targetHandle && cable.toNodeId === fromNodeId && cable.toPortId === sourceHandle
      return sameDirection || reverseDirection
    })
    if (alreadyPresent) continue

    cables.value.push({
      id: `chain-edge-${edge.id}`,
      fromNodeId,
      fromPortId: sourceHandle,
      toNodeId,
      toPortId: targetHandle,
    })
  }

  revealedChainHandles.value = [...component.componentHandles]
  revealedChainEdgeIds.value = [...component.componentEdgeIds]

  const nextExistingByNodeId = { ...existingComponentByNodeId.value }
  delete nextExistingByNodeId[nodeId]
  existingComponentByNodeId.value = nextExistingByNodeId
  if (connectedNoticeNodeId.value === nodeId) {
    connectedNoticeNodeId.value = null
  }
}

const applyCanvasToWiring = async () => {
  if (persistence.readOnly.value || isApplyingConnections.value) return

  isApplyingConnections.value = true
  applyErrorMessage.value = null
  applyStatusMessage.value = null
  applyUndoPayload.value = null
  let saveWarning: string | null = null
  try {
    const snapshot = buildSnapshotState()
    await persistence.saveNow(snapshot)
    if (persistence.error.value) {
      saveWarning = `Canvas save warning: ${persistence.error.value}.`
    }

    const result = await api.applyNodeCanvasConnections({ state: snapshot })
    await store.syncConnectionsProjectionSafe()
    const created = result.report.created_connection_ids.length
    const deleted = result.report.deleted_connection_ids.length
    const skipped = result.report.skipped_edges.length
    const conflicts = result.report.conflicts.length
    const applySummary = `Applied: ${created} created, ${deleted} deleted, ${skipped} skipped, ${conflicts} conflicts`
    applyStatusMessage.value = saveWarning ? `${applySummary} ${saveWarning}` : applySummary
    if (result.undo && (result.undo.created_connection_ids.length > 0 || result.undo.deleted_connection_ids.length > 0)) {
      applyUndoPayload.value = {
        created_connection_ids: [...result.undo.created_connection_ids],
        deleted_connection_ids: [...result.undo.deleted_connection_ids],
      }
    }
  } catch (error: unknown) {
    const candidate = error as { message?: unknown }
    applyErrorMessage.value = typeof candidate?.message === 'string' ? candidate.message : 'Apply failed'
  } finally {
    isApplyingConnections.value = false
  }
}

const undoLastApply = async () => {
  if (!applyUndoPayload.value || isApplyingConnections.value) return

  isApplyingConnections.value = true
  applyErrorMessage.value = null
  try {
    const result = await api.undoNodeCanvasConnections(applyUndoPayload.value)
    await store.syncConnectionsProjectionSafe()
    applyStatusMessage.value = `Undo applied: ${result.report.reverted_created} reverted, ${result.report.restored_deleted} restored, ${result.report.skipped_restores} skipped`
    applyUndoPayload.value = null
    connectedNoticeNodeId.value = null
  } catch (error: unknown) {
    const candidate = error as { message?: unknown }
    applyErrorMessage.value = typeof candidate?.message === 'string' ? candidate.message : 'Undo failed'
  } finally {
    isApplyingConnections.value = false
  }
}

const refreshCanvasConnections = async () => {
  if (isRefreshingConnections.value) return
  isRefreshingConnections.value = true
  applyErrorMessage.value = null
  applyStatusMessage.value = null

  try {
    const portOwnerByHandle = new Map<string, string>()
    const representedHandles = new Set<string>()
    for (const node of nodes.value) {
      for (const port of node.ports) {
        if (!isLookupHandle(port.id)) continue
        representedHandles.add(port.id)
        if (!portOwnerByHandle.has(port.id)) {
          portOwnerByHandle.set(port.id, node.id)
        }
      }
    }

    if (representedHandles.size === 0) {
      applyStatusMessage.value = 'Live refresh skipped: no mapped canvas handles available.'
      return
    }

    const liveConnections = await api.listConnections()
    const syncedCables: CableConnection[] = []
    const pairKeys = new Set<string>()
    let skippedOutOfCanvas = 0

    for (const edge of liveConnections) {
      const aHandle = handleFromEndpoint(edge.a.type, String(edge.a.id))
      const bHandle = handleFromEndpoint(edge.b.type, String(edge.b.id))
      const fromNodeId = portOwnerByHandle.get(aHandle)
      const toNodeId = portOwnerByHandle.get(bHandle)
      if (!fromNodeId || !toNodeId) {
        skippedOutOfCanvas += 1
        continue
      }

      const pairKey = [aHandle, bHandle].sort().join('::')
      if (pairKeys.has(pairKey)) continue
      pairKeys.add(pairKey)

      syncedCables.push({
        id: `live-edge-${edge.id}`,
        fromNodeId,
        fromPortId: aHandle,
        toNodeId,
        toPortId: bHandle,
      })
    }

    const preservedLocalCables = cables.value.filter((cable) => {
      const fromRepresented = representedHandles.has(cable.fromPortId)
      const toRepresented = representedHandles.has(cable.toPortId)
      return !(fromRepresented && toRepresented)
    })

    cables.value = [...preservedLocalCables, ...syncedCables]
    connectConflictMessage.value = null
    scheduleStateSave()

    applyStatusMessage.value = `Live refresh: ${syncedCables.length} synced, ${preservedLocalCables.length} local preserved, ${skippedOutOfCanvas} out-of-canvas skipped.`
  } catch (error: unknown) {
    const candidate = error as { message?: unknown }
    applyErrorMessage.value = typeof candidate?.message === 'string' ? candidate.message : 'Live refresh failed'
  } finally {
    isRefreshingConnections.value = false
  }
}

const boardToWorld = (clientX: number, clientY: number) => {
  if (!boardRef.value) return { x: 0, y: 0 }

  const boardRect = boardRef.value.getBoundingClientRect()
  return {
    x: (clientX - boardRect.left - pan.value.x) / scale.value,
    y: (clientY - boardRect.top - pan.value.y) / scale.value,
  }
}

const getPortConnections = (nodeId: string, portId: string) => {
  return cableByPortKey.value.get(`${nodeId}:${portId}`) ?? []
}

const getPortConnectionLabel = (nodeId: string, portId: string) => {
  const cablesForPort = getPortConnections(nodeId, portId)
  const cable = cablesForPort[0]
  if (!cable) return 'Open'
  if (cablesForPort.length > 1) return `Connected (${cablesForPort.length})`

  const isFrom = cable.fromNodeId === nodeId && cable.fromPortId === portId
  const otherNodeId = isFrom ? cable.toNodeId : cable.fromNodeId
  const otherPortId = isFrom ? cable.toPortId : cable.fromPortId

  const otherNode = nodeMap.value.get(otherNodeId)
  const otherPort = otherNode?.ports.find((port) => port.id === otherPortId)
  if (!otherNode || !otherPort) return 'Connected'

  return `Connected to ${otherNode.title} (${otherPort.name})`
}

const clearHideHoverTimer = () => {
  if (hideHoverTimer.value) {
    clearTimeout(hideHoverTimer.value)
    hideHoverTimer.value = null
  }
}

const clearCableHideTimer = () => {
  if (cableHideTimer.value) {
    clearTimeout(cableHideTimer.value)
    cableHideTimer.value = null
  }
}

const clearHoverTimers = () => {
  if (hoverDelayTimer.value) {
    clearTimeout(hoverDelayTimer.value)
    hoverDelayTimer.value = null
  }

  if (hoverProgressTimer.value) {
    clearInterval(hoverProgressTimer.value)
    hoverProgressTimer.value = null
  }
}

const startHoverTracking = (nodeId: string) => {
  if (pinnedTooltipNodeId.value && pinnedTooltipNodeId.value !== nodeId) return

  clearHideHoverTimer()
  clearHoverTimers()
  hoveredNodeId.value = nodeId
  hoverProgress.value = 0

  hoverDelayTimer.value = setTimeout(() => {
    if (hoveredNodeId.value !== nodeId) return
    hoverPreviewNodeId.value = nodeId
    pinnedTooltipNodeId.value = nodeId
    clearHoverTimers()
  }, HOVER_TOOLTIP_DELAY_MS)
}

const stopHoverTracking = (nodeId: string) => {
  if (hoveredNodeId.value !== nodeId) return

  hoveredNodeId.value = null
  clearHoverTimers()

  clearHideHoverTimer()
  hideHoverTimer.value = setTimeout(() => {
    if (isHoveringTooltip.value) return
    closePinnedTooltip()
  }, 160)
}

const onTooltipPointerEnter = () => {
  isHoveringTooltip.value = true
  clearHideHoverTimer()
}

const onTooltipPointerLeave = () => {
  isHoveringTooltip.value = false
  closePinnedTooltip()
}

const onNodePointerDown = (event: PointerEvent, node: CanvasNode) => {
  if (shouldStartPanGesture(event)) {
    event.preventDefault()
    startPanGesture(event)
    return
  }
  if (event.button !== 0) return

  event.preventDefault()
  if (cableDraft.value) {
    selectSingleNode(node.id)
    if (cableDraft.value.fromNodeId === node.id) return
    if (props.floatingMode) {
      event.stopPropagation()
      windowManager.openChildWindow(
        graphParentWindowId.value,
        'canvas-select-port',
        `Connect to ${node.title}`,
        {
          nodeId: node.id,
          nodeTitle: node.title,
          ports: node.ports.map((port) => ({
            id: port.id,
            name: port.name,
            statusLabel: getPortConnectionLabel(node.id, port.id),
            occupied: isTargetPortOccupied(node.id, port.id),
          })),
          onSelectPort: (portId: string) => connectDraftToTargetPort(node.id, portId),
        },
        { id: `canvas-select-port:${graphParentWindowId.value}:${node.id}` },
      )
    } else {
      connectTargetNodeId.value = node.id
      showConnectModal.value = true
    }
    return
  }

  const isToggleClick = event.ctrlKey || event.metaKey
  if (isToggleClick) {
    toggleNodeSelection(node.id)
    return
  }
  if (!isNodeSelected(node.id)) {
    selectSingleNode(node.id)
  } else {
    primarySelectedNodeId.value = node.id
  }

  const pointerWorld = boardToWorld(event.clientX, event.clientY)
  const dragNodeIds = getDragSelection(node.id)
  const startPositionsById = Object.fromEntries(
    dragNodeIds
      .map((nodeId) => {
        const candidate = nodeMap.value.get(nodeId)
        if (!candidate) return null
        return [nodeId, { x: candidate.x, y: candidate.y }]
      })
      .filter((item): item is [string, { x: number; y: number }] => item !== null),
  )
  dragging.value = {
    nodeIds: dragNodeIds,
    anchorNodeId: node.id,
    anchorOffsetX: pointerWorld.x - node.x,
    anchorOffsetY: pointerWorld.y - node.y,
    startPositionsById,
  }
  hasMovedNodeDuringDrag.value = false
}

const onBoardPointerDown = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null
  if (!target) return
  if (target.closest('.canvas-overlay')) return
  if (shouldStartPanGesture(event)) {
    event.preventDefault()
    startPanGesture(event)
    return
  }
  if (target.closest('.node-card') || target.closest('.node-tooltip') || target.closest('.cable-tooltip')) return
  if (event.button !== 0) return

  event.preventDefault()

  if (cableDraft.value && event.button === 0) {
    cancelCableDraft()
    return
  }

  if (event.button === 0) {
    const pointerWorld = boardToWorld(event.clientX, event.clientY)
    selectionBox.value = {
      startWorldX: pointerWorld.x,
      startWorldY: pointerWorld.y,
      currentWorldX: pointerWorld.x,
      currentWorldY: pointerWorld.y,
      toggleMode: event.ctrlKey || event.metaKey,
      baseSelectedNodeIds: [...selectedNodeIds.value],
    }
    if (!selectionBox.value.toggleMode) {
      clearSelection()
    }
    return
  }

}

const onPointerMove = (event: PointerEvent) => {
  if (panelDrag.value) {
    const nextX = panelDrag.value.startPanelX + event.clientX - panelDrag.value.startClientX
    const nextY = panelDrag.value.startPanelY + event.clientY - panelDrag.value.startClientY
    if (panelDrag.value.panel === 'tools') {
      const clamped = clampPanelPosition(toolsPanelRef.value, nextX, nextY)
      toolsPanel.value.x = clamped.x
      toolsPanel.value.y = clamped.y
    } else if (panelDrag.value.panel === 'intent') {
      const clamped = clampPanelPosition(intentPanelRef.value, nextX, nextY)
      intentPanel.value.x = clamped.x
      intentPanel.value.y = clamped.y
    } else {
      const clamped = clampPanelPosition(addPanelRef.value, nextX, nextY)
      addPanel.value.x = clamped.x
      addPanel.value.y = clamped.y
    }
    return
  }

  if (cableDraft.value) {
    const pointerWorld = boardToWorld(event.clientX, event.clientY)
    cableDraft.value.cursorX = pointerWorld.x
    cableDraft.value.cursorY = pointerWorld.y
  }

  if (dragging.value) {
    const pointerWorld = boardToWorld(event.clientX, event.clientY)
    const anchorStart = dragging.value.startPositionsById[dragging.value.anchorNodeId]
    if (!anchorStart) return

    const rawX = pointerWorld.x - dragging.value.anchorOffsetX
    const rawY = pointerWorld.y - dragging.value.anchorOffsetY
    const maxX = WORLD_WIDTH - NODE_WIDTH - BOARD_PADDING
    const maxY = WORLD_HEIGHT - NODE_HEIGHT - BOARD_PADDING

    const anchorNextX = snapToGrid(clamp(rawX, BOARD_PADDING, maxX))
    const anchorNextY = snapToGrid(clamp(rawY, BOARD_PADDING, maxY))
    const deltaX = anchorNextX - anchorStart.x
    const deltaY = anchorNextY - anchorStart.y

    for (const nodeId of dragging.value.nodeIds) {
      const dragNode = nodes.value.find((node) => node.id === nodeId)
      const startPos = dragging.value.startPositionsById[nodeId]
      if (!dragNode || !startPos) continue

      const nextX = snapToGrid(clamp(startPos.x + deltaX, BOARD_PADDING, maxX))
      const nextY = snapToGrid(clamp(startPos.y + deltaY, BOARD_PADDING, maxY))
      if (dragNode.x !== nextX || dragNode.y !== nextY) {
        hasMovedNodeDuringDrag.value = true
        dragNode.x = nextX
        dragNode.y = nextY
      }
    }
    return
  }

  if (selectionBox.value) {
    const pointerWorld = boardToWorld(event.clientX, event.clientY)
    selectionBox.value.currentWorldX = pointerWorld.x
    selectionBox.value.currentWorldY = pointerWorld.y
    applySelectionBoxSelection()
    return
  }

  if (panning.value) {
    const deltaX = event.clientX - panning.value.startClientX
    const deltaY = event.clientY - panning.value.startClientY
    const nextX = panning.value.startPanX + deltaX
    const nextY = panning.value.startPanY + deltaY
    if (pan.value.x !== nextX || pan.value.y !== nextY) {
      hasPannedDuringGesture.value = true
      pan.value.x = nextX
      pan.value.y = nextY
    }
  }
}

const onPointerUp = () => {
  panelDrag.value = null
  const movedNode = hasMovedNodeDuringDrag.value
  const movedPan = hasPannedDuringGesture.value
  if (selectionBox.value) {
    applySelectionBoxSelection()
  }
  dragging.value = null
  panning.value = null
  selectionBox.value = null
  hasMovedNodeDuringDrag.value = false
  hasPannedDuringGesture.value = false
  if (movedNode || movedPan) {
    scheduleStateSave()
  }
}

const onBoardWheel = (event: WheelEvent) => {
  if (!boardRef.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.canvas-add-panel') || target?.closest('.canvas-intent-panel')) return

  event.preventDefault()

  if (!event.ctrlKey) {
    const lineHeight = 16
    const pageHeight = boardRef.value.getBoundingClientRect().height || 240
    const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? lineHeight
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? pageHeight
        : 1
    const nextX = pan.value.x - event.deltaX * multiplier
    const nextY = pan.value.y - event.deltaY * multiplier
    if (nextX !== pan.value.x || nextY !== pan.value.y) {
      pan.value.x = nextX
      pan.value.y = nextY
      scheduleStateSave()
    }
    return
  }

  const boardRect = boardRef.value.getBoundingClientRect()
  const cursorBoardX = event.clientX - boardRect.left
  const cursorBoardY = event.clientY - boardRect.top
  const worldX = (cursorBoardX - pan.value.x) / scale.value
  const worldY = (cursorBoardY - pan.value.y) / scale.value

  const zoomFactor = event.deltaY > 0 ? 0.92 : 1.08
  const nextScale = clamp(scale.value * zoomFactor, MIN_SCALE, MAX_SCALE)

  pan.value.x = cursorBoardX - worldX * nextScale
  pan.value.y = cursorBoardY - worldY * nextScale
  scale.value = nextScale
  scheduleStateSave()
}

const zoomIn = () => {
  scale.value = clamp(scale.value * 1.12, MIN_SCALE, MAX_SCALE)
  scheduleStateSave()
}

const zoomOut = () => {
  scale.value = clamp(scale.value * 0.88, MIN_SCALE, MAX_SCALE)
  scheduleStateSave()
}

const resetView = () => {
  scale.value = DEFAULT_SCALE
  pan.value = { ...DEFAULT_PAN }
  void saveStateNow()
}

const cancelCableDraft = () => {
  cableDraft.value = null
  showConnectModal.value = false
  connectTargetNodeId.value = null
  if (props.floatingMode) {
    closeFloatingConnectWindows()
  }
}

const beginCableFromPort = (nodeId: string, portId: string) => {
  const node = nodeMap.value.get(nodeId)
  if (!node) return

  const startX = node.x + NODE_WIDTH
  const startY = node.y + NODE_HEIGHT * 0.5

  cableDraft.value = {
    fromNodeId: nodeId,
    fromPortId: portId,
    cursorX: startX + 60,
    cursorY: startY,
  }

  showConnectModal.value = false
  connectTargetNodeId.value = null
}

const closeConnectModal = () => {
  showConnectModal.value = false
  connectTargetNodeId.value = null
}

const addCable = (fromNodeId: string, fromPortId: string, toNodeId: string, toPortId: string) => {
  cables.value.push({
    id: `cable-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
  })
}

const hasKnownExternalConnectionForPort = (nodeId: string, portId: string) => {
  const component = existingComponentByNodeId.value[nodeId]
  if (!component) return false
  return component.componentHandles.includes(portId)
}

const isTargetPortOccupied = (nodeId: string, portId: string) => {
  return getPortConnections(nodeId, portId).length > 0 || hasKnownExternalConnectionForPort(nodeId, portId)
}

const connectDraftToTargetPort = (targetNodeId: string, targetPortId: string) => {
  if (!cableDraft.value) return

  const sourceNodeId = cableDraft.value.fromNodeId
  const sourcePortId = cableDraft.value.fromPortId

  if (sourceNodeId === targetNodeId && sourcePortId === targetPortId) return

  const alreadyExists = cables.value.some((cable) => {
    const sameDirection =
      cable.fromNodeId === sourceNodeId &&
      cable.fromPortId === sourcePortId &&
      cable.toNodeId === targetNodeId &&
      cable.toPortId === targetPortId
    const reverseDirection =
      cable.fromNodeId === targetNodeId &&
      cable.fromPortId === targetPortId &&
      cable.toNodeId === sourceNodeId &&
      cable.toPortId === sourcePortId
    return sameDirection || reverseDirection
  })
  if (alreadyExists) {
    cancelCableDraft()
    return
  }

  const sourcePeerSlot = slotForPeerHandle(targetPortId)
  const targetPeerSlot = slotForPeerHandle(sourcePortId)
  const nextCables = cables.value.filter((cable) => {
    const sourceConflict = sourcePeerSlot
      ? cableUsesEndpointSlot(cable, sourcePortId, sourcePeerSlot)
      : false
    const targetConflict = targetPeerSlot
      ? cableUsesEndpointSlot(cable, targetPortId, targetPeerSlot)
      : false
    return !sourceConflict && !targetConflict
  })
  const replacedCount = cables.value.length - nextCables.length
  if (replacedCount > 0) {
    cables.value = nextCables
    connectConflictMessage.value = `Replaced ${replacedCount} conflicting route${replacedCount === 1 ? '' : 's'} for this slot.`
  } else if (isTargetPortOccupied(targetNodeId, targetPortId)) {
    connectConflictMessage.value = 'Connection conflict detected: this destination port is already in use. Saving will overwrite the existing route for that slot.'
  }

  addCable(sourceNodeId, sourcePortId, targetNodeId, targetPortId)

  cancelCableDraft()
  scheduleStateSave()
}

const deleteSelectedNodes = () => {
  if (selectedNodeIds.value.length === 0) return
  const selectedIds = new Set(selectedNodeIds.value)
  const deletedNodes = nodes.value.filter((node) => selectedIds.has(node.id))

  nodes.value = nodes.value.filter((node) => !selectedIds.has(node.id))
  cables.value = cables.value.filter((cable) => !selectedIds.has(cable.fromNodeId) && !selectedIds.has(cable.toNodeId))
  const nextExistingByNodeId = { ...existingComponentByNodeId.value }
  for (const nodeId of selectedIds) {
    delete nextExistingByNodeId[nodeId]
  }
  existingComponentByNodeId.value = nextExistingByNodeId
  if (deletedNodes.some((node) => isNodeInRevealedChain(node))) {
    clearRevealedChain()
  }
  if (connectedNoticeNodeId.value && selectedIds.has(connectedNoticeNodeId.value)) {
    connectedNoticeNodeId.value = null
  }
  dragging.value = null

  if (
    (hoveredNodeId.value && selectedIds.has(hoveredNodeId.value)) ||
    (hoverPreviewNodeId.value && selectedIds.has(hoverPreviewNodeId.value)) ||
    (pinnedTooltipNodeId.value && selectedIds.has(pinnedTooltipNodeId.value))
  ) {
    hoveredNodeId.value = null
    hoverPreviewNodeId.value = null
    pinnedTooltipNodeId.value = null
    hoverProgress.value = 0
    clearHoverTimers()
  }

  if (
    (cableDraft.value?.fromNodeId && selectedIds.has(cableDraft.value.fromNodeId)) ||
    (connectTargetNodeId.value && selectedIds.has(connectTargetNodeId.value))
  ) {
    cancelCableDraft()
  }

  clearSelection()
  scheduleStateSave()
}

const closePinnedTooltip = () => {
  pinnedTooltipNodeId.value = null
  hoverPreviewNodeId.value = null
  hoveredNodeId.value = null
  hoverProgress.value = 0
  isHoveringTooltip.value = false
  clearHoverTimers()
  clearHideHoverTimer()
}

const openAddModal = () => {
  showAddModal.value = true
  catalogTab.value = 'devices'
  addSearchQuery.value = ''
  connectedNoticeNodeId.value = null
  requestAnimationFrame(() => {
    clampPanelsToBoard()
  })
}

const hasNodeForDeviceId = (deviceId: number) => {
  const device = store.devices.find((row) => row.id === deviceId)
  return nodes.value.some((node) => {
    if (Number(node.deviceId) === deviceId) return true
    if (!node.deviceId && node.kind === 'device' && device && node.title === device.name) return true
    return false
  })
}

const getDeviceTemplateById = (deviceId: number): NodeTemplate | null => {
  return deviceCatalog.value.find((template) => template.deviceId === deviceId) ?? null
}

const addDeviceIdsToGraph = async (deviceIds: number[]) => {
  const seen = new Set<number>()
  for (const deviceId of deviceIds) {
    if (!Number.isFinite(deviceId) || deviceId <= 0) continue
    if (seen.has(deviceId)) continue
    seen.add(deviceId)
    if (hasNodeForDeviceId(deviceId)) continue
    const template = getDeviceTemplateById(deviceId)
    if (!template) continue
    await addNodeFromTemplate(template, { closeModal: false })
  }
}

const openIntentMatchesWindow = (intent: ApiIntent, matchResponse: ApiDeviceMatchResponse) => {
  if (!props.floatingMode) return
  windowManager.openChildWindow(
    graphParentWindowId.value,
    'canvas-intent-matches',
    'Intent Device Matches',
    {
      intent: matchResponse.intent,
      queryText: matchResponse.query_text,
      matches: matchResponse.matches,
      topCandidates: matchResponse.top_candidates,
      onAddSelected: (deviceIds: number[]) => {
        void addDeviceIdsToGraph(deviceIds)
      },
    },
    { id: `canvas-intent-matches:${graphParentWindowId.value}` },
  )
  intentMatchError.value = null
  intentPrompt.value = intent.notes || intentPrompt.value
}

const runIntentDeviceMatch = async () => {
  const prompt = intentPrompt.value.trim()
  if (!prompt || intentMatchLoading.value) return
  if (!canRunIntentDeviceMatch.value) {
    intentMatchError.value = 'This workspace plan does not allow device intent matching.'
    store.pushToast({ type: 'error', message: 'Tu plan no incluye esta función.' })
    return
  }

  intentMatchError.value = null
  intentMatchLoading.value = true
  try {
    const parsedIntent = await api.parseIntent({ text: prompt })
    const matchResponse = await api.matchDevicesFromIntent({
      intent: parsedIntent,
      query_text: prompt,
      limit: 30,
    })
    if (props.floatingMode) {
      openIntentMatchesWindow(parsedIntent, matchResponse)
    } else {
      await addDeviceIdsToGraph(matchResponse.matches.slice(0, 10).map((item) => item.device_id))
    }
  } catch (error: unknown) {
    const candidate = error as { message?: unknown }
    intentMatchError.value = typeof candidate?.message === 'string' ? candidate.message : 'Intent match failed'
  } finally {
    intentMatchLoading.value = false
  }
}

const closeAddModal = () => {
  showAddModal.value = false
}

const getViewportCenterWorld = () => {
  if (!boardRef.value) {
    return { x: 220, y: 180 }
  }

  const boardRect = boardRef.value.getBoundingClientRect()
  return {
    x: (boardRect.width * 0.5 - pan.value.x) / scale.value,
    y: (boardRect.height * 0.5 - pan.value.y) / scale.value,
  }
}

const addNodeFromTemplate = async (
  item: NodeTemplate,
  options?: { closeModal?: boolean },
) => {
  const center = getViewportCenterWorld()
  const placement = normalizeWorldNodePlacement(center.x - NODE_WIDTH * 0.5, center.y - NODE_HEIGHT * 0.5)

  const id = `${item.kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  const createdNode: CanvasNode = {
    id,
    deviceId: item.deviceId ? String(item.deviceId) : null,
    title: item.title,
    subtitle: item.subtitle,
    kind: item.kind,
    details: [...item.details],
    ports: item.ports.map((port) => ({ ...port })),
    x: placement.x,
    y: placement.y,
  }

  nodes.value.push(createdNode)

  selectSingleNode(id)
  if (options?.closeModal ?? false) {
    closeAddModal()
  }
  scheduleStateSave()
  await lookupExistingComponentForNode(createdNode)
}

const onAddCatalogRowClick = (item: NodeTemplate) => {
  void addNodeFromTemplate(item, { closeModal: false })
}

const hydrateCanvas = async () => {
  persistence.setHydrating(true)
  try {
    const persisted = await persistence.load()

    if (persisted) {
      const hydrated = fromPersistedState(persisted)
      nodes.value = hydrated.nodes
      cables.value = hydrated.cables
      pan.value = { ...hydrated.pan }
      scale.value = hydrated.scale
    } else {
      nodes.value = buildDefaultNodesFromDevices()
      cables.value = []
      pan.value = { ...DEFAULT_PAN }
      scale.value = DEFAULT_SCALE
      if (persistence.canPersistToBackend.value) {
        await saveStateNow()
      }
    }
    existingComponentByNodeId.value = {}
    connectedNoticeNodeId.value = null
    clearRevealedChain()
    applyStatusMessage.value = null
    applyErrorMessage.value = null
    applyUndoPayload.value = null
  } finally {
    persistence.setHydrating(false)
  }
}

const onCablePointerEnter = (cableId: string) => {
  clearCableHideTimer()
  hoveredCableId.value = cableId
}

const onCablePointerLeave = () => {
  clearCableHideTimer()
  cableHideTimer.value = setTimeout(() => {
    if (isHoveringCableTooltip.value) return
    hoveredCableId.value = null
  }, 120)
}

const onCableTooltipPointerEnter = () => {
  isHoveringCableTooltip.value = true
  clearCableHideTimer()
}

const onCableTooltipPointerLeave = () => {
  isHoveringCableTooltip.value = false
  hoveredCableId.value = null
}

const cutHoveredCable = () => {
  if (!hoveredCableId.value) return
  const cableId = hoveredCableId.value
  cables.value = cables.value.filter((cable) => cable.id !== cableId)
  hoveredCableId.value = null
  isHoveringCableTooltip.value = false
  clearCableHideTimer()
  scheduleStateSave()
}

const onWindowKeyDown = (event: KeyboardEvent) => {
  const activeElement = document.activeElement as HTMLElement | null
  const activeTag = activeElement?.tagName
  const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || !!activeElement?.isContentEditable

  if (event.code === 'Space') {
    if (isEditingText) return
    isSpacePressed.value = true
    event.preventDefault()
    return
  }

  if (isEditingText) return

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!hasSelectedNodes.value) return
    event.preventDefault()
    deleteSelectedNodes()
    return
  }

  if (event.key === 'Escape') {
    clearSelection()
    selectionBox.value = null
    if (showAddModal.value) {
      closeAddModal()
      return
    }
    if (showConnectModal.value || cableDraft.value) {
      cancelCableDraft()
      return
    }
    if (isTooltipPinned.value) {
      closePinnedTooltip()
    }
  }
}

const onWindowKeyUp = (event: KeyboardEvent) => {
  if (event.code === 'Space') {
    isSpacePressed.value = false
  }
}

const onWindowBlur = () => {
  isSpacePressed.value = false
  panelDrag.value = null
}

const onWindowResize = () => {
  clampPanelsToBoard()
}

window.addEventListener('pointermove', onPointerMove)
window.addEventListener('pointerup', onPointerUp)
window.addEventListener('keydown', onWindowKeyDown)
window.addEventListener('keyup', onWindowKeyUp)
window.addEventListener('blur', onWindowBlur)
window.addEventListener('resize', onWindowResize)

onMounted(() => {
  void hydrateCanvas()
  requestAnimationFrame(() => {
    initializePanelPositions()
    clampPanelsToBoard()
  })
})

onBeforeUnmount(() => {
  persistence.dispose()
  clearHoverTimers()
  clearHideHoverTimer()
  clearCableHideTimer()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('keyup', onWindowKeyUp)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('resize', onWindowResize)
})
</script>

<template>
  <section class="node-view" :class="{ 'floating-mode': props.floatingMode }">
    <div v-if="cableDraft && draftSourceLabel" class="connect-banner">
      <span>Connecting from {{ draftSourceLabel }}. Click a destination node.</span>
      <button class="ghost-btn" @click="cancelCableDraft">Cancel</button>
    </div>

    <div v-if="connectConflictMessage" class="chain-banner warning">
      <span>{{ connectConflictMessage }}</span>
      <div class="chain-banner-actions">
        <button class="ghost-btn" @click="connectConflictMessage = null">Dismiss</button>
      </div>
    </div>

    <div v-if="intentMatchError" class="chain-banner warning">
      <span>{{ intentMatchError }}</span>
      <div class="chain-banner-actions">
        <button class="ghost-btn" @click="intentMatchError = null">Dismiss</button>
      </div>
    </div>

    <div v-if="connectedNotice" class="chain-banner">
      <span>{{ connectedNotice.nodeTitle }} is already connected ({{ connectedNotice.count }} handles in chain).</span>
      <div class="chain-banner-actions">
        <button class="ghost-btn" @click="revealExistingChainForNode(connectedNotice.nodeId)">Reveal chain</button>
        <button class="ghost-btn" @click="connectedNoticeNodeId = null">Dismiss</button>
      </div>
    </div>

    <div v-if="applyStatusMessage || applyErrorMessage" class="apply-banner" :class="{ error: !!applyErrorMessage }">
      <span>{{ applyErrorMessage ?? applyStatusMessage }}</span>
      <button v-if="applyUndoPayload && !applyErrorMessage" class="ghost-btn" :disabled="isApplyingConnections" @click="undoLastApply">
        Undo
      </button>
      <button v-if="hasRevealedChain" class="ghost-btn" @click="clearRevealedChain">Clear highlight</button>
    </div>

    <div
      ref="boardRef"
      class="board"
      :class="{
        panning: !!panning,
        wiring: !!cableDraft,
        selecting: !!selectionBox,
        'space-pan-ready': isSpacePressed,
      }"
      @pointerdown="onBoardPointerDown"
      @wheel="onBoardWheel"
    >
      <div
        ref="toolsPanelRef"
        class="canvas-overlay canvas-tools-panel"
        :class="{ minimized: toolsPanel.minimized }"
        :style="{ left: `${toolsPanel.x}px`, top: `${toolsPanel.y}px` }"
        @pointerdown.stop
      >
        <header class="canvas-panel-header" @pointerdown="startPanelDrag('tools', $event)">
          <strong>Canvas Tools</strong>
          <div class="canvas-panel-actions">
            <button
              class="tooltip-close panel-action-btn"
              type="button"
              :title="toolsPanel.minimized ? 'Restore tools panel' : 'Minimize tools panel'"
              @click="toolsPanel.minimized = !toolsPanel.minimized"
            >
              {{ toolsPanel.minimized ? '+' : '-' }}
            </button>
          </div>
        </header>
        <div v-if="!toolsPanel.minimized" class="canvas-panel-body">
          <p class="canvas-help">Pan: middle-click or Space+drag. Zoom: Ctrl+scroll.</p>
          <div class="persistence-status" :class="{ error: !!persistence.error.value, readonly: persistence.readOnly.value }">
            <span>{{ persistenceStatusLabel }}</span>
            <button v-if="persistence.error.value" class="ghost-btn tool-btn compact" title="Retry save" @click="persistence.retry">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66L4 9h6V3L7.75 5.25A10 10 0 1 1 2 12h2z"/></svg>
              <span>Retry</span>
            </button>
            <button v-if="!persistence.readOnly.value" class="ghost-btn tool-btn compact" title="Save now" @click="saveStateNow">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3H5a2 2 0 0 0-2 2v14h18V7l-4-4zm-5 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v2z"/></svg>
              <span>Save</span>
            </button>
          </div>
          <div class="tools-grid">
            <div class="zoom-controls">
              <button class="ghost-btn tool-btn" title="Zoom out" @click="zoomOut">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z"/></svg>
                <span>Zoom out</span>
              </button>
              <span class="zoom-label">{{ zoomPercent }}</span>
              <button class="ghost-btn tool-btn" title="Zoom in" @click="zoomIn">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v14h-2zM5 11h14v2H5z"/></svg>
                <span>Zoom in</span>
              </button>
              <button class="ghost-btn tool-btn" title="Reset view" @click="resetView">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 0 6.71 9h2.06A9 9 0 1 1 12 3v2zm1-2v6h6V7h-2.59A8.96 8.96 0 0 0 13 3z"/></svg>
                <span>Reset</span>
              </button>
            </div>
            <button class="ghost-btn tool-btn apply-btn" :disabled="persistence.readOnly.value || isApplyingConnections" @click="applyCanvasToWiring">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 16.17-3.88-3.88L3.7 13.7 9 19l12-12-1.41-1.41z"/></svg>
              <span>{{ isApplyingConnections ? 'Applying...' : 'Apply to wiring' }}</span>
            </button>
            <button class="ghost-btn tool-btn" :disabled="isRefreshingConnections" @click="void refreshCanvasConnections()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6V3L8 7l4 4V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6zm6 6a6 6 0 0 1-6 6v3l4-4-4-4v3a4 4 0 1 0 4-4h2z"/></svg>
              <span>{{ isRefreshingConnections ? 'Refreshing...' : 'Refresh live wiring' }}</span>
            </button>
            <button class="ghost-btn tool-btn add-btn" @click="openAddModal">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v14h-2zM5 11h14v2H5z"/></svg>
              <span>Add node</span>
            </button>
            <button class="ghost-btn tool-btn danger-btn" :disabled="!hasSelectedNodes" @click="deleteSelectedNodes">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7zm3-10v7h2v-7h-2zm4 0v7h2v-7h-2zM9 4h6l1 2h4v2H4V6h4l1-2z"/></svg>
              <span>Delete selected</span>
            </button>
            <button
              class="ghost-btn tool-btn panel-toggle-btn"
              :aria-pressed="showIntentPanel"
              :title="showIntentPanel ? 'Hide intent panel' : 'Show intent panel'"
              @click="showIntentPanel = !showIntentPanel"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v4H4V4zm0 6h16v10H4V10zm2 2v6h12v-6H6z"/></svg>
              <span>{{ showIntentPanel ? 'Hide intent' : 'Show intent' }}</span>
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="showIntentPanel"
        ref="intentPanelRef"
        class="canvas-overlay canvas-intent-panel"
        :style="{ left: `${intentPanel.x}px`, top: `${intentPanel.y}px` }"
        @pointerdown.stop
      >
        <header class="canvas-panel-header" @pointerdown="startPanelDrag('intent', $event)">
          <strong>Intent Match</strong>
          <div class="canvas-panel-actions">
            <button class="tooltip-close panel-action-btn" title="Close intent panel" @click="showIntentPanel = false">x</button>
          </div>
        </header>
        <div class="canvas-panel-body">
          <input
            v-model="intentPrompt"
            class="intent-input"
            placeholder="Describe your routing intent..."
            @keydown.enter.prevent="void runIntentDeviceMatch()"
          />
          <button class="ghost-btn tool-btn" :disabled="intentMatchLoading || !intentPrompt.trim() || !canRunIntentDeviceMatch" @click="void runIntentDeviceMatch()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 18-6-6 1.41-1.41L10 15.17l8.59-8.58L20 8l-10 10z"/></svg>
            <span>{{ intentMatchLoading ? 'Matching...' : 'Match devices' }}</span>
          </button>
        </div>
      </div>

      <div
        v-if="showAddModal"
        ref="addPanelRef"
        class="canvas-overlay canvas-add-panel"
        :style="{ left: `${addPanel.x}px`, top: `${addPanel.y}px` }"
        @pointerdown.stop
      >
        <header class="canvas-panel-header" @pointerdown="startPanelDrag('add', $event)">
          <strong>Add Node</strong>
          <div class="canvas-panel-actions">
            <button class="tooltip-close panel-action-btn" title="Close add panel" @click="closeAddModal">x</button>
          </div>
        </header>
        <div class="canvas-panel-body add-panel-body">
          <div class="catalog-tabs">
            <button class="ghost-btn" :class="{ active: catalogTab === 'devices' }" @click="catalogTab = 'devices'">
              Devices
            </button>
            <button class="ghost-btn" :class="{ active: catalogTab === 'patchbay' }" @click="catalogTab = 'patchbay'">
              Patchbay Ports
            </button>
          </div>
          <input
            v-model="addSearchQuery"
            class="add-search"
            :placeholder="catalogTab === 'devices' ? 'Search devices...' : 'Search patchbay ports...'"
          />
          <p class="add-panel-help">Drag a row into the canvas to place it, or click to add at center.</p>

          <div class="add-node-table" role="listbox" aria-label="Add node catalog">
            <div class="add-node-header" :class="{ patchbay: catalogTab === 'patchbay' }">
              <span>Name</span>
              <span>Type</span>
              <span v-if="catalogTab === 'devices'">Ports</span>
              <span v-else>Details</span>
            </div>
            <button
              v-for="item in filteredCatalog"
              :key="item.templateId"
              class="add-node-row"
              :class="{ patchbay: item.kind === 'patchbay' }"
              type="button"
              @click="onAddCatalogRowClick(item)"
            >
              <span class="cell-name">{{ item.title }}</span>
              <span class="cell-type">{{ item.kind === 'patchbay' ? item.details[1]?.replace('Type: ', '') || 'Patchbay' : item.details[0]?.replace('Type: ', '') || 'Device' }}</span>
              <span v-if="item.kind === 'device'" class="cell-ports">{{ item.ports.length }}</span>
              <span v-else class="cell-details">
                <span v-if="item.patchbayMeta?.tag" class="meta-chip">{{ item.patchbayMeta.tag }}</span>
                <span v-if="patchbayLocationLabel(item)" class="meta-chip">{{ patchbayLocationLabel(item) }}</span>
                <span v-if="!item.patchbayMeta?.tag && !patchbayLocationLabel(item)" class="text-muted">No extra details</span>
              </span>
            </button>
            <p v-if="filteredCatalog.length === 0" class="catalog-empty">No items found.</p>
          </div>
        </div>
      </div>

      <div class="world" :style="worldStyle">
        <svg class="wires" :viewBox="`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`" aria-hidden="true">
          <g v-for="item in cableGeometry" :key="item.id">
            <path
              class="cable-path"
              :class="{ hovered: hoveredCableId === item.id, 'chain-highlight': isCableInRevealedChain(item.cable) }"
              :d="item.path"
              @pointerenter="onCablePointerEnter(item.id)"
              @pointerleave="onCablePointerLeave"
            />
          </g>

          <path v-if="draftCablePath" class="cable-path draft" :d="draftCablePath" />
        </svg>
        <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle"></div>

        <article
          v-for="node in nodes"
          :key="node.id"
          class="node-card"
          :class="[
            getNodeClass(node.kind),
            {
              dragging: isNodeDragging(node.id),
              selected: isNodeSelected(node.id),
              'already-connected': !!existingComponentByNodeId[node.id],
              'chain-highlight': isNodeInRevealedChain(node),
            },
          ]"
          :style="{ left: `${node.x}px`, top: `${node.y}px` }"
          @pointerenter="startHoverTracking(node.id)"
          @pointerleave="stopHoverTracking(node.id)"
          @pointerdown="onNodePointerDown($event, node)"
        >
          <header class="node-card-header">
            <span class="node-kind">{{ node.subtitle }}</span>
            <span class="node-id">{{ node.id }}</span>
          </header>
          <h3>{{ node.title }}</h3>
          <p v-if="existingComponentByNodeId[node.id]" class="connection-pill">Already connected</p>
        </article>

        <aside
          v-if="activeTooltipNode"
          class="node-tooltip"
          :class="{ pinned: isTooltipPinned }"
          :style="tooltipStyle"
          @pointerenter="onTooltipPointerEnter"
          @pointerleave="onTooltipPointerLeave"
        >
          <header class="node-tooltip-header">
            <strong>{{ activeTooltipNode.title }}</strong>
            <button
              v-if="isTooltipPinned"
              class="tooltip-close"
              @click.stop="closePinnedTooltip"
            >
              x
            </button>
          </header>
          <p class="node-tooltip-subtitle">{{ activeTooltipNode.subtitle }}</p>

          <ul class="node-tooltip-list">
            <li v-for="detail in activeTooltipNode.details" :key="detail">{{ detail }}</li>
          </ul>

          <div class="ports-box">
            <p class="ports-title">Ports</p>
            <button
              v-for="port in activeTooltipNode.ports"
              :key="port.id"
              class="port-row"
              :class="{
                connected: getPortConnections(activeTooltipNode.id, port.id).length > 0,
                'chain-highlight': isPortInRevealedChain(port.id),
              }"
              @click.stop="beginCableFromPort(activeTooltipNode.id, port.id)"
            >
              <span class="port-name">{{ port.name }}</span>
              <span class="port-state">{{ getPortConnectionLabel(activeTooltipNode.id, port.id) }}</span>
            </button>
          </div>

          <button
            v-if="activeTooltipNodeComponent"
            class="ghost-btn reveal-chain-btn"
            @click.stop="revealExistingChainForNode(activeTooltipNode.id)"
          >
            Reveal existing chain ({{ activeTooltipNodeComponent.componentHandles.length }})
          </button>

          <div v-if="!isTooltipPinned" class="pin-progress" aria-hidden="true">
            <div class="pin-progress-fill" :style="tooltipProgressStyle"></div>
          </div>
          <p v-if="!isTooltipPinned" class="pin-hint">Hold hover to pin</p>
          <p v-else class="pin-hint">Pinned (moves out when cursor leaves popup)</p>
        </aside>

        <div
          v-if="hoveredCableLabel"
          class="cable-tooltip"
          :style="cableHoverTooltipStyle"
          @pointerenter="onCableTooltipPointerEnter"
          @pointerleave="onCableTooltipPointerLeave"
        >
          <span>{{ hoveredCableLabel }}</span>
          <button class="cut-cable-btn" @click.stop="cutHoveredCable">Cut cable</button>
        </div>
      </div>
    </div>

    <div v-if="showConnectModal && activeConnectTargetNode && !props.floatingMode" class="modal-overlay" @click="closeConnectModal">
      <div class="connect-modal" @click.stop>
        <header class="add-modal-header">
          <h3>Connect to {{ activeConnectTargetNode.title }}</h3>
          <button class="tooltip-close" @click="closeConnectModal">x</button>
        </header>

        <p class="connect-help">Select destination port. Ports already in use are marked as conflict candidates.</p>
        <div class="catalog-list">
          <button
            v-for="port in activeConnectTargetNode.ports"
            :key="port.id"
            class="catalog-item"
            :class="{ occupied: isTargetPortOccupied(activeConnectTargetNode.id, port.id) }"
            @click="connectDraftToTargetPort(activeConnectTargetNode.id, port.id)"
          >
            <span class="catalog-item-title">{{ port.name }}</span>
            <span class="catalog-item-subtitle">{{ getPortConnectionLabel(activeConnectTargetNode.id, port.id) }}</span>
            <span v-if="isTargetPortOccupied(activeConnectTargetNode.id, port.id)" class="connect-conflict-chip">
              Conflict candidate
            </span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.node-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: var(--space-3);
}

.node-view.floating-mode {
  gap: var(--space-2);
}

.persistence-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 10px;
  border: 1px solid rgba(191, 170, 131, 0.4);
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.persistence-status.error {
  border-color: rgba(176, 75, 61, 0.6);
  color: #e9b2a8;
}

.persistence-status.readonly {
  border-color: rgba(115, 168, 212, 0.6);
  color: #c8def3;
}

.ghost-btn {
  border: 1px solid rgba(191, 170, 131, 0.5);
  background: linear-gradient(180deg, rgba(52, 45, 35, 0.92), rgba(33, 29, 22, 0.92));
  color: #f0e5d2;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.18s ease, background 0.18s ease;
}

.ghost-btn:hover {
  border-color: rgba(212, 154, 79, 0.8);
  background: linear-gradient(180deg, rgba(67, 56, 42, 0.94), rgba(40, 35, 26, 0.94));
  transform: translateY(-1px);
}

.ghost-btn:active {
  transform: translateY(0);
}

.canvas-overlay {
  position: absolute;
  z-index: 14;
  border: 1px solid rgba(191, 170, 131, 0.4);
  border-radius: var(--radius-3);
  background: rgba(18, 15, 11, 0.94);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}

.canvas-tools-panel {
  width: min(540px, calc(100% - 20px));
}

.canvas-tools-panel.minimized {
  min-width: 190px;
}

.canvas-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(191, 170, 131, 0.3);
  background: linear-gradient(180deg, rgba(50, 42, 31, 0.95), rgba(34, 29, 23, 0.95));
  cursor: grab;
  user-select: none;
}

.canvas-panel-header:active {
  cursor: grabbing;
}

.canvas-panel-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.panel-action-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.canvas-panel-body {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.canvas-help {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.tools-grid {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  font-size: 0.82rem;
}

.tool-btn.compact {
  padding: 4px 8px;
}

.tool-btn svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.canvas-intent-panel {
  width: min(360px, calc(100% - 20px));
}

.canvas-add-panel {
  width: min(540px, calc(100% - 20px));
  z-index: 13;
}

.add-panel-body {
  max-height: min(460px, calc(100vh - 220px));
  overflow: auto;
}

.intent-input {
  width: 100%;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: rgba(31, 28, 24, 0.85);
  color: var(--text-primary);
  padding: 8px 10px;
}

.zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.zoom-label {
  min-width: 52px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.88rem;
  font-weight: 600;
}

.add-btn {
  border-color: rgba(106, 163, 111, 0.7);
  color: #bfe0be;
}

.add-panel-help {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.add-node-table {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  overflow: hidden;
  background: rgba(10, 9, 7, 0.5);
}

.add-node-header,
.add-node-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.8fr) minmax(100px, 1fr) 72px;
  gap: 8px;
  align-items: center;
}

.add-node-header.patchbay,
.add-node-row.patchbay {
  grid-template-columns: minmax(180px, 1.6fr) minmax(100px, 1fr) minmax(170px, 1.2fr);
}

.add-node-header {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-default);
  background: rgba(255, 255, 255, 0.03);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.add-node-row {
  width: 100%;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 9px 10px;
  text-align: left;
  color: var(--text-primary);
  background: transparent;
  cursor: grab;
}

.add-node-row:last-of-type {
  border-bottom: 0;
}

.add-node-row:hover {
  background: rgba(106, 163, 111, 0.14);
}

.add-node-row:active {
  cursor: grabbing;
}

.cell-name {
  font-weight: 600;
}

.cell-type {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.cell-ports {
  justify-self: center;
  font-weight: 700;
  color: #c8def3;
}

.cell-details {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(212, 154, 79, 0.45);
  background: rgba(212, 154, 79, 0.12);
  font-size: 0.7rem;
  color: #f0e5d2;
}

.text-muted {
  color: var(--text-muted);
  font-size: 0.74rem;
}

.apply-btn {
  border-color: rgba(115, 168, 212, 0.7);
  color: #c8def3;
}

.danger-btn {
  border-color: rgba(176, 75, 61, 0.7);
  color: #e9b2a8;
}

.danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.connect-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(212, 154, 79, 0.5);
  border-radius: var(--radius-2);
  background: rgba(212, 154, 79, 0.14);
}

.chain-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(106, 163, 111, 0.5);
  border-radius: var(--radius-2);
  background: rgba(106, 163, 111, 0.14);
}

.chain-banner.warning {
  border-color: rgba(176, 75, 61, 0.45);
  background: rgba(176, 75, 61, 0.14);
}

.chain-banner-actions {
  display: inline-flex;
  gap: var(--space-2);
}

.apply-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(115, 168, 212, 0.5);
  border-radius: var(--radius-2);
  background: rgba(115, 168, 212, 0.14);
}

.apply-banner.error {
  border-color: rgba(176, 75, 61, 0.5);
  background: rgba(176, 75, 61, 0.14);
}

.board {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  overflow: hidden;
  background: radial-gradient(circle at 0% 0%, rgba(106, 163, 111, 0.12), rgba(18, 16, 12, 0.96) 52%);
  cursor: default;
  touch-action: none;
}

.board.space-pan-ready {
  cursor: grab;
}

.board.panning {
  cursor: grabbing;
}

.board.wiring {
  cursor: crosshair;
}

.board.selecting {
  cursor: crosshair;
}

.world {
  position: absolute;
  inset: 0;
  width: 2200px;
  height: 1400px;
  transform-origin: 0 0;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 24px 24px, 24px 24px;
}

.wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.selection-box {
  position: absolute;
  border: 1px solid rgba(115, 168, 212, 0.95);
  background: rgba(115, 168, 212, 0.2);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  pointer-events: none;
  z-index: 3;
}

.cable-path {
  stroke: rgba(212, 154, 79, 0.8);
  stroke-width: 2.4;
  fill: none;
  pointer-events: stroke;
  cursor: pointer;
}

.cable-path.hovered {
  stroke: #f3c17a;
  stroke-width: 3;
}

.cable-path.chain-highlight {
  stroke: #8bd0a0;
  stroke-width: 3;
}

.cable-path.draft {
  stroke-dasharray: 7 5;
  opacity: 0.95;
}

.node-card {
  position: absolute;
  width: 188px;
  min-height: 88px;
  padding: 10px 12px;
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  background: rgba(31, 28, 24, 0.95);
  box-shadow: var(--shadow-1);
  cursor: move;
  user-select: none;
  touch-action: none;
  transition: border-color 0.18s ease, transform 0.18s ease;
}

.node-card.dragging {
  cursor: move;
  transform: scale(1.02);
  border-color: var(--accent);
}

.node-card.selected {
  border-color: #d49a4f;
  box-shadow: 0 0 0 2px rgba(212, 154, 79, 0.5), var(--shadow-1);
}

.node-card.device {
  border-left: 4px solid #6aa36f;
}

.node-card.port {
  border-left: 4px solid #d49a4f;
}

.node-card.patchbay {
  border-left: 4px solid #73a8d4;
}

.node-card.already-connected {
  box-shadow: 0 0 0 1px rgba(115, 168, 212, 0.45), var(--shadow-1);
}

.node-card.chain-highlight {
  box-shadow: 0 0 0 2px rgba(106, 163, 111, 0.65), var(--shadow-1);
}

.node-card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: 4px;
}

.node-kind {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.node-id {
  font-size: 0.66rem;
  color: var(--text-muted);
}

.node-card h3 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.2;
}

.connection-pill {
  margin: 8px 0 0;
  display: inline-flex;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(115, 168, 212, 0.5);
  color: #c8def3;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.node-tooltip {
  position: absolute;
  width: 280px;
  border: 1px solid rgba(212, 154, 79, 0.5);
  border-radius: var(--radius-3);
  background: rgba(16, 14, 11, 0.97);
  box-shadow: var(--shadow-2);
  padding: 10px;
  z-index: 10;
  cursor: default;
}

.node-tooltip.pinned {
  border-color: rgba(106, 163, 111, 0.7);
}

.node-tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 4px;
}

.node-tooltip-subtitle {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.node-tooltip-list {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-primary);
}

.ports-box {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: grid;
  gap: 6px;
}

.ports-title {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.port-row {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 9px;
  text-align: left;
  cursor: pointer;
}

.port-row:hover {
  border-color: rgba(212, 154, 79, 0.8);
}

.port-row.connected {
  border-color: rgba(106, 163, 111, 0.8);
}

.port-row.chain-highlight {
  box-shadow: inset 0 0 0 1px rgba(106, 163, 111, 0.6);
}

.port-name {
  font-size: 0.85rem;
  font-weight: 600;
}

.port-state {
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.pin-progress {
  margin-top: 8px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.pin-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #d49a4f, #6aa36f);
}

.pin-hint {
  margin: 6px 0 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.reveal-chain-btn {
  margin-top: 8px;
  width: 100%;
}

.cable-tooltip {
  position: absolute;
  max-width: 320px;
  padding: 6px 8px;
  border: 1px solid rgba(212, 154, 79, 0.65);
  border-radius: var(--radius-2);
  background: rgba(16, 14, 11, 0.96);
  color: var(--text-primary);
  font-size: 0.78rem;
  z-index: 11;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cut-cable-btn {
  border: 1px solid rgba(176, 75, 61, 0.7);
  border-radius: var(--radius-2);
  background: rgba(176, 75, 61, 0.16);
  color: #f1c2bb;
  padding: 3px 8px;
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
}

.tooltip-close {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  line-height: 1;
  cursor: pointer;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 7, 6, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.connect-modal {
  width: min(560px, calc(100vw - 32px));
  max-height: min(560px, calc(100vh - 32px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  background: rgba(31, 28, 24, 0.98);
  box-shadow: var(--shadow-2);
  padding: var(--space-4);
}

.add-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.add-modal-header h3 {
  margin: 0;
}

.catalog-tabs {
  display: flex;
  gap: var(--space-2);
}

.catalog-tabs .ghost-btn.active {
  border-color: rgba(212, 154, 79, 0.8);
  color: #f3c17a;
}

.add-search {
  width: 100%;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-primary);
  padding: 10px 12px;
}

.catalog-list {
  overflow: auto;
  display: grid;
  gap: var(--space-2);
}

.catalog-item {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.18);
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: grid;
  gap: 2px;
}

.catalog-item:hover {
  border-color: rgba(106, 163, 111, 0.8);
}

.catalog-item.occupied {
  border-color: rgba(176, 75, 61, 0.45);
}

.catalog-item-title {
  font-weight: 600;
}

.catalog-item-subtitle {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.connect-conflict-chip {
  margin-top: 6px;
  display: inline-flex;
  width: fit-content;
  border-radius: 999px;
  padding: 2px 8px;
  background: rgba(176, 75, 61, 0.16);
  color: var(--danger);
  font-size: 0.75rem;
  font-weight: 600;
}

.catalog-empty,
.connect-help {
  margin: 0;
  color: var(--text-muted);
}

@media (max-width: 960px) {
  .canvas-tools-panel,
  .canvas-intent-panel,
  .canvas-add-panel {
    width: min(360px, calc(100% - 16px));
  }

  .node-tooltip {
    width: 250px;
  }

  .tool-btn span {
    display: none;
  }
}
</style>
