<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CanvasEdge, CanvasNode } from '@/types/graph'

const props = defineProps<{
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  selectedNodeId?: string | null
  selectedEdgeId?: string | null
  hoveredNodeId?: string | null
}>()

const emit = defineEmits<{
  (e: 'select-node', nodeId: string): void
  (e: 'select-edge', edgeId: string): void
}>()

const showDevices = ref(true)
const showPorts = ref(true)
const showPatchbayPoints = ref(true)

const visibleNodes = computed(() => {
  return props.nodes.filter((node) => {
    if (node.kind === 'device') return showDevices.value
    if (node.kind === 'port') return showPorts.value
    if (node.kind === 'patchbay_point') return showPatchbayPoints.value
    return true
  })
})

const visibleNodeIds = computed(() => new Set(visibleNodes.value.map((node) => node.id)))

const visibleEdges = computed(() => {
  return props.edges.filter((edge) => {
    const a = findNodeByEndpoint(edge.a.type, edge.a.id)
    const b = findNodeByEndpoint(edge.b.type, edge.b.id)
    return !!a && !!b && visibleNodeIds.value.has(a.id) && visibleNodeIds.value.has(b.id)
  })
})

function findNodeByEndpoint(type: string, endpointId: string | number): CanvasNode | undefined {
  return props.nodes.find((node) => node.endpoint?.type === type && String(node.endpoint.id) === String(endpointId))
}

const layout = computed(() => {
  const columns: Array<'device' | 'port' | 'patchbay_point'> = ['device', 'port', 'patchbay_point']
  const positions = new Map<string, { x: number; y: number }>()
  const counts = new Map<string, number>()

  columns.forEach((kind) => counts.set(kind, 0))
  for (const node of visibleNodes.value) {
    const kind = node.kind
    const colIndex = columns.indexOf(kind as any)
    const rowIndex = counts.get(kind) || 0
    counts.set(kind, rowIndex + 1)
    positions.set(node.id, {
      x: 48 + Math.max(0, colIndex) * 270,
      y: 48 + rowIndex * 94,
    })
  }

  const maxRows = Math.max(...Array.from(counts.values()), 1)
  const width = 860
  const height = Math.max(320, 120 + maxRows * 96)

  return { positions, width, height }
})

const renderedEdges = computed(() => {
  return visibleEdges.value
    .map((edge) => {
      const a = findNodeByEndpoint(edge.a.type, edge.a.id)
      const b = findNodeByEndpoint(edge.b.type, edge.b.id)
      if (!a || !b) return null
      const aPos = layout.value.positions.get(a.id)
      const bPos = layout.value.positions.get(b.id)
      if (!aPos || !bPos) return null
      return {
        edge,
        x1: aPos.x + 188,
        y1: aPos.y + 30,
        x2: bPos.x,
        y2: bPos.y + 30,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
})

const isEdgeConnectedToHovered = (edge: CanvasEdge) => {
  if (!props.hoveredNodeId) return false
  const hovered = visibleNodes.value.find((node) => node.id === props.hoveredNodeId)
  if (!hovered?.endpoint) return false
  const hoveredKey = `${hovered.endpoint.type}:${hovered.endpoint.id}`
  const aKey = `${edge.a.type}:${edge.a.id}`
  const bKey = `${edge.b.type}:${edge.b.id}`
  return hoveredKey === aKey || hoveredKey === bKey
}
</script>

<template>
  <section class="graph-view">
    <header class="graph-view-toolbar">
      <label><input v-model="showDevices" type="checkbox" /> Devices</label>
      <label><input v-model="showPorts" type="checkbox" /> Ports</label>
      <label><input v-model="showPatchbayPoints" type="checkbox" /> Patchbay points</label>
    </header>

    <div class="graph-canvas">
      <svg class="graph-edges" :viewBox="`0 0 ${layout.width} ${layout.height}`" preserveAspectRatio="xMinYMin meet">
        <g v-for="item in renderedEdges" :key="item.edge.id">
          <line
            :x1="item.x1"
            :y1="item.y1"
            :x2="item.x2"
            :y2="item.y2"
            class="edge-hit"
            @click="emit('select-edge', item.edge.id)"
          />
          <line
            :x1="item.x1"
            :y1="item.y1"
            :x2="item.x2"
            :y2="item.y2"
            class="edge-line"
            :class="{
              selected: selectedEdgeId === item.edge.id,
              highlight: isEdgeConnectedToHovered(item.edge),
            }"
          />
        </g>
      </svg>

      <button
        v-for="node in visibleNodes"
        :key="node.id"
        class="graph-node"
        :class="[node.kind, { selected: selectedNodeId === node.id }]"
        :style="{
          left: `${layout.positions.get(node.id)?.x || 0}px`,
          top: `${layout.positions.get(node.id)?.y || 0}px`,
        }"
        @click="emit('select-node', node.id)"
      >
        <span class="node-kind">{{ node.kind }}</span>
        <strong class="node-label">{{ node.label }}</strong>
      </button>
    </div>
  </section>
</template>

<style scoped>
.graph-view {
  display: grid;
  gap: var(--space-3);
  min-height: 320px;
}

.graph-view-toolbar {
  display: flex;
  gap: var(--space-3);
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.graph-view-toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.graph-canvas {
  position: relative;
  min-height: 340px;
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background:
    radial-gradient(circle at 20% 10%, rgba(212, 154, 79, 0.08), transparent 45%),
    linear-gradient(135deg, rgba(18, 16, 13, 0.92), rgba(10, 9, 7, 0.98));
}

.graph-edges {
  width: 860px;
  min-height: 100%;
}

.edge-line {
  stroke: rgba(212, 154, 79, 0.45);
  stroke-width: 2;
}

.edge-line.highlight {
  stroke: rgba(229, 182, 109, 0.85);
}

.edge-line.selected {
  stroke: rgba(61, 122, 88, 0.95);
  stroke-width: 3;
}

.edge-hit {
  stroke: transparent;
  stroke-width: 12;
  cursor: pointer;
}

.graph-node {
  position: absolute;
  width: 188px;
  min-height: 58px;
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background: rgba(30, 27, 22, 0.92);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px;
  cursor: pointer;
  text-align: left;
}

.graph-node.port {
  border-color: rgba(212, 154, 79, 0.5);
}

.graph-node.patchbay_point {
  border-color: rgba(61, 122, 88, 0.55);
}

.graph-node.selected {
  box-shadow: 0 0 0 2px rgba(212, 154, 79, 0.35);
}

.node-kind {
  font-size: 0.72rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.node-label {
  font-size: 0.92rem;
  line-height: 1.25;
}
</style>
