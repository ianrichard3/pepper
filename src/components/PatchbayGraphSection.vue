<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import GraphView from '@/components/GraphView.vue'
import { canvasStore } from '@/stores/graph'
import type { CanvasScopeMode } from '@/types/graph'

const props = defineProps<{ patchbayId: number }>()

const mode = ref<CanvasScopeMode>('direct')

const load = async () => {
  await canvasStore.loadPatchbayGraph(props.patchbayId, mode.value)
}

onMounted(() => {
  void load()
})

watch(() => props.patchbayId, () => {
  void load()
})

watch(mode, () => {
  void load()
})

const createFromSelection = async () => {
  const node = canvasStore.selectedNode
  if (!canvasStore.selection.pendingEndpoint || !node?.endpoint) return
  const ok = await canvasStore.connectEndpoints(canvasStore.selection.pendingEndpoint, node.endpoint)
  if (ok) await load()
}

const disconnectSelection = async () => {
  const edge = canvasStore.selectedEdge
  if (!edge) return
  const ok = await canvasStore.disconnectEdge(edge.id)
  if (ok) await load()
}
</script>

<template>
  <section class="patchbay-graph-section">
    <header class="head">
      <h3>Patchbay Graph</h3>
      <div class="controls">
        <button class="chip" :class="{ active: mode === 'direct' }" @click="mode = 'direct'">Points + connected ports</button>
        <button class="chip" :class="{ active: mode === 'reachable' }" @click="mode = 'reachable'">Reachable graph</button>
        <button class="ghost-btn" @click="load">Refresh</button>
      </div>
    </header>

    <div v-if="canvasStore.loading" class="hint">Loading graph...</div>
    <div v-else-if="canvasStore.error" class="hint error">{{ canvasStore.error }}</div>

    <div v-else class="content">
      <GraphView
        :nodes="canvasStore.nodes"
        :edges="canvasStore.edges"
        :selected-node-id="canvasStore.selection.selectedNodeId"
        :selected-edge-id="canvasStore.selection.selectedEdgeId"
        @select-node="canvasStore.selectNode"
        @select-edge="canvasStore.selectEdge"
      />

      <aside class="side">
        <p v-if="canvasStore.selectedNode"><strong>Node:</strong> {{ canvasStore.selectedNode.label }}</p>
        <p v-if="canvasStore.selectedEdge"><strong>Edge:</strong> {{ canvasStore.selectedEdge.id }}</p>

        <div v-if="canvasStore.selectedNode?.endpoint" class="actions">
          <button class="ghost-btn" @click="canvasStore.setPendingEndpoint(canvasStore.selectedNode.endpoint)">Set endpoint A</button>
          <button v-if="canvasStore.selection.pendingEndpoint" class="primary-btn" @click="createFromSelection">Create connection</button>
        </div>

        <button v-if="canvasStore.selectedEdge" class="danger-btn" @click="disconnectSelection">Disconnect edge</button>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.patchbay-graph-section {
  display: grid;
  gap: var(--space-3);
}

.head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  align-items: center;
}

.controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.content {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: var(--space-3);
}

.side {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  display: grid;
  gap: 8px;
  align-content: start;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip,
.ghost-btn,
.primary-btn,
.danger-btn {
  border: 1px solid var(--border-default);
  border-radius: 999px;
  padding: 5px 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.chip.active {
  background: rgba(61, 122, 88, 0.2);
  color: var(--text-primary);
  border-color: rgba(61, 122, 88, 0.45);
}

.primary-btn {
  background: var(--accent);
  color: #17120b;
}

.danger-btn {
  border-radius: var(--radius-2);
  border-color: rgba(176, 75, 61, 0.45);
  background: rgba(176, 75, 61, 0.15);
  color: var(--danger);
}

.hint {
  color: var(--text-secondary);
}

.hint.error {
  color: var(--danger);
}

@media (max-width: 980px) {
  .content {
    grid-template-columns: 1fr;
  }
}
</style>
