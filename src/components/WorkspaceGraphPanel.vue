<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import GraphView from '@/components/GraphView.vue'
import { graphStore } from '@/stores/graph'
import { store } from '@/store'
import type { GraphEndpoint } from '@/types/graph'

const searchQuery = ref('')
const onlyConnected = ref(false)
const hoveredNodeId = ref<string | null>(null)

onMounted(() => {
  void graphStore.loadWorkspaceGraph()
})

const filteredNodes = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query && !onlyConnected.value) return graphStore.nodes

  return graphStore.nodes.filter((node) => {
    const connected = !node.endpoint || graphStore.connectedEndpointKeys.has(`${node.endpoint.type}:${node.endpoint.id}`)
    if (onlyConnected.value && !connected) return false
    if (!query) return true
    return `${node.label} ${node.kind}`.toLowerCase().includes(query)
  })
})

const selectedNode = computed(() => graphStore.selectedNode)
const selectedEdge = computed(() => graphStore.selectedEdge)

const connectCandidate = computed(() => {
  if (!selectedNode.value?.endpoint) return null
  return selectedNode.value.endpoint
})

const canStartConnect = computed(() => !!connectCandidate.value)

const createConnection = async () => {
  if (!graphStore.selection.pendingEndpoint || !connectCandidate.value) return
  await graphStore.connectEndpoints(graphStore.selection.pendingEndpoint, connectCandidate.value)
  await graphStore.loadWorkspaceGraph()
}

const beginConnect = () => {
  if (!connectCandidate.value) return
  graphStore.setPendingEndpoint(connectCandidate.value)
}

const clearConnect = () => {
  graphStore.setPendingEndpoint(null)
}

const removeSelectedEdge = async () => {
  if (!selectedEdge.value) return
  const ok = await graphStore.disconnectEdge(selectedEdge.value.id)
  if (ok) {
    await graphStore.loadWorkspaceGraph()
  }
}

const openDeviceDetail = () => {
  if (!selectedNode.value?.deviceId) return
  store.requestDeviceFocus(selectedNode.value.deviceId)
  store.setTab('devices')
}

const endpointLabel = (endpoint: GraphEndpoint) => `${endpoint.type}:${endpoint.id}`
</script>

<template>
  <section class="workspace-graph">
    <header class="graph-header">
      <h2>Workspace Graph</h2>
      <div class="graph-actions">
        <input v-model="searchQuery" class="graph-search" placeholder="Search devices, ports, or patchbay points" />
        <label class="connected-filter"><input v-model="onlyConnected" type="checkbox" /> Only connected</label>
        <button class="ghost-btn" @click="graphStore.loadWorkspaceGraph">Refresh</button>
      </div>
    </header>

    <div v-if="graphStore.loading" class="loading">Loading graph...</div>
    <div v-else-if="graphStore.error" class="error">{{ graphStore.error }}</div>

    <div v-else class="graph-layout">
      <GraphView
        :nodes="filteredNodes"
        :edges="graphStore.edges"
        :selected-node-id="graphStore.selection.selectedNodeId"
        :selected-edge-id="graphStore.selection.selectedEdgeId"
        :hovered-node-id="hoveredNodeId"
        @select-node="(id) => { hoveredNodeId = id; graphStore.selectNode(id) }"
        @select-edge="(id) => graphStore.selectEdge(id)"
      />

      <aside class="details-panel">
        <h3>Details</h3>

        <div v-if="graphStore.selection.pendingEndpoint" class="connect-banner">
          Endpoint A: <strong>{{ endpointLabel(graphStore.selection.pendingEndpoint) }}</strong>
          <button class="ghost-btn" @click="clearConnect">Cancel</button>
        </div>

        <template v-if="selectedNode">
          <p><strong>Node:</strong> {{ selectedNode.label }}</p>
          <p><strong>Kind:</strong> {{ selectedNode.kind }}</p>
          <p v-if="selectedNode.endpoint"><strong>Endpoint:</strong> {{ endpointLabel(selectedNode.endpoint) }}</p>
          <div class="detail-actions">
            <button v-if="canStartConnect" class="ghost-btn" @click="beginConnect">Set as endpoint A</button>
            <button
              v-if="graphStore.selection.pendingEndpoint && connectCandidate"
              class="primary-btn"
              @click="createConnection"
            >
              Create connection to endpoint A
            </button>
            <button v-if="selectedNode.kind === 'device' && selectedNode.deviceId" class="ghost-btn" @click="openDeviceDetail">
              Open device detail
            </button>
          </div>
        </template>

        <template v-else-if="selectedEdge">
          <p><strong>Edge ID:</strong> {{ selectedEdge.id }}</p>
          <p><strong>Kind:</strong> {{ selectedEdge.kind }}</p>
          <p><strong>A:</strong> {{ endpointLabel(selectedEdge.a) }}</p>
          <p><strong>B:</strong> {{ endpointLabel(selectedEdge.b) }}</p>
          <button class="danger-btn" @click="removeSelectedEdge">Disconnect</button>
        </template>

        <p v-else class="muted">Select a node or edge.</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.workspace-graph {
  display: grid;
  gap: var(--space-3);
  height: 100%;
}

.graph-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.graph-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.graph-search {
  width: 280px;
  padding: 8px 10px;
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background: var(--surface-1);
  color: var(--text-primary);
}

.connected-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.graph-layout {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--space-3);
}

.details-panel {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  padding: var(--space-3);
  display: grid;
  align-content: start;
  gap: var(--space-2);
  overflow: auto;
}

.connect-banner {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(212, 154, 79, 0.45);
  background: rgba(212, 154, 79, 0.12);
  border-radius: var(--radius-2);
  padding: 8px;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.loading,
.error,
.muted {
  color: var(--text-secondary);
}

.primary-btn,
.ghost-btn,
.danger-btn {
  padding: 6px 10px;
  border-radius: var(--radius-2);
  cursor: pointer;
  border: 1px solid var(--border-default);
}

.primary-btn {
  background: var(--accent);
  color: #17120b;
  border-color: transparent;
}

.ghost-btn {
  background: transparent;
  color: var(--text-secondary);
}

.danger-btn {
  background: rgba(176, 75, 61, 0.18);
  color: var(--danger);
  border-color: rgba(176, 75, 61, 0.4);
}

@media (max-width: 1180px) {
  .graph-layout {
    grid-template-columns: 1fr;
  }

  .graph-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .graph-search {
    width: 100%;
  }
}
</style>
