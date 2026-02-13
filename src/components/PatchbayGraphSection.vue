<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import GraphView from '@/components/GraphView.vue'
import { graphStore } from '@/stores/graph'
import type { GraphScopeMode } from '@/types/graph'

const props = defineProps<{ patchbayId: number }>()

const mode = ref<GraphScopeMode>('direct')

const load = async () => {
  await graphStore.loadPatchbayGraph(props.patchbayId, mode.value)
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
  const node = graphStore.selectedNode
  if (!graphStore.selection.pendingEndpoint || !node?.endpoint) return
  const ok = await graphStore.connectEndpoints(graphStore.selection.pendingEndpoint, node.endpoint)
  if (ok) await load()
}

const disconnectSelection = async () => {
  const edge = graphStore.selectedEdge
  if (!edge) return
  const ok = await graphStore.disconnectEdge(edge.id)
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

    <div v-if="graphStore.loading" class="hint">Loading graph...</div>
    <div v-else-if="graphStore.error" class="hint error">{{ graphStore.error }}</div>

    <div v-else class="content">
      <GraphView
        :nodes="graphStore.nodes"
        :edges="graphStore.edges"
        :selected-node-id="graphStore.selection.selectedNodeId"
        :selected-edge-id="graphStore.selection.selectedEdgeId"
        @select-node="graphStore.selectNode"
        @select-edge="graphStore.selectEdge"
      />

      <aside class="side">
        <p v-if="graphStore.selectedNode"><strong>Node:</strong> {{ graphStore.selectedNode.label }}</p>
        <p v-if="graphStore.selectedEdge"><strong>Edge:</strong> {{ graphStore.selectedEdge.id }}</p>

        <div v-if="graphStore.selectedNode?.endpoint" class="actions">
          <button class="ghost-btn" @click="graphStore.setPendingEndpoint(graphStore.selectedNode.endpoint)">Set endpoint A</button>
          <button v-if="graphStore.selection.pendingEndpoint" class="primary-btn" @click="createFromSelection">Create connection</button>
        </div>

        <button v-if="graphStore.selectedEdge" class="danger-btn" @click="disconnectSelection">Disconnect edge</button>
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
