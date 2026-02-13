<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import GraphView from '@/components/GraphView.vue'
import { graphStore } from '@/stores/graph'
import type { GraphScopeMode } from '@/types/graph'

const props = defineProps<{ deviceId: number }>()

const mode = ref<GraphScopeMode>('direct')

const load = async () => {
  await graphStore.loadDeviceGraph(props.deviceId, mode.value)
}

onMounted(() => {
  void load()
})

watch(() => props.deviceId, () => {
  void load()
})

watch(mode, () => {
  void load()
})

const selectedNode = computed(() => graphStore.selectedNode)
const selectedEdge = computed(() => graphStore.selectedEdge)

const createFromSelection = async () => {
  if (!graphStore.selection.pendingEndpoint) return
  if (!selectedNode.value?.endpoint) return
  const ok = await graphStore.connectEndpoints(graphStore.selection.pendingEndpoint, selectedNode.value.endpoint)
  if (ok) await load()
}

const disconnectSelection = async () => {
  if (!selectedEdge.value) return
  const ok = await graphStore.disconnectEdge(selectedEdge.value.id)
  if (ok) await load()
}
</script>

<template>
  <section class="device-graph-section">
    <header class="device-graph-header">
      <h4>Graph</h4>
      <div class="controls">
        <button class="chip" :class="{ active: mode === 'direct' }" @click="mode = 'direct'">This device only</button>
        <button class="chip" :class="{ active: mode === 'reachable' }" @click="mode = 'reachable'">This device + reachable</button>
        <button class="ghost-btn" @click="load">Refresh</button>
      </div>
    </header>

    <div v-if="graphStore.loading" class="hint">Loading graph...</div>
    <div v-else-if="graphStore.error" class="hint error">{{ graphStore.error }}</div>

    <div v-else class="section-layout">
      <GraphView
        :nodes="graphStore.nodes"
        :edges="graphStore.edges"
        :selected-node-id="graphStore.selection.selectedNodeId"
        :selected-edge-id="graphStore.selection.selectedEdgeId"
        @select-node="graphStore.selectNode"
        @select-edge="graphStore.selectEdge"
      />

      <div class="section-detail">
        <p v-if="selectedNode"><strong>Node:</strong> {{ selectedNode.label }}</p>
        <p v-if="selectedEdge"><strong>Edge:</strong> {{ selectedEdge.id }}</p>

        <div class="actions" v-if="selectedNode?.endpoint">
          <button class="ghost-btn" @click="graphStore.setPendingEndpoint(selectedNode.endpoint)">Set as endpoint A</button>
          <button v-if="graphStore.selection.pendingEndpoint" class="primary-btn" @click="createFromSelection">Create connection</button>
        </div>

        <button v-if="selectedEdge" class="danger-btn" @click="disconnectSelection">Disconnect</button>
        <p v-if="!selectedNode && !selectedEdge" class="hint">Select a node or edge in the graph.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.device-graph-section {
  border-top: 1px solid var(--border-default);
  padding-top: var(--space-3);
  margin-top: var(--space-3);
  display: grid;
  gap: var(--space-2);
}

.device-graph-header {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  align-items: center;
}

.controls {
  display: flex;
  align-items: center;
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
  background: rgba(212, 154, 79, 0.2);
  color: var(--text-primary);
  border-color: rgba(212, 154, 79, 0.45);
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

.section-layout {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: var(--space-2);
}

.section-detail {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  display: grid;
  align-content: start;
  gap: 8px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hint {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.hint.error {
  color: var(--danger);
}

@media (max-width: 900px) {
  .section-layout {
    grid-template-columns: 1fr;
  }
}
</style>
