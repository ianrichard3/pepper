<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import GraphView from '@/components/GraphView.vue'
import { canvasStore } from '@/stores/graph'
import { store } from '@/store'
import type { CanvasEndpoint } from '@/types/graph'
import { api, type ApiRecommendationPlan } from '@/lib/api'

const searchQuery = ref('')
const onlyConnected = ref(false)
const hoveredNodeId = ref<string | null>(null)

onMounted(() => {
  void canvasStore.loadWorkspaceGraph()
})

const filteredNodes = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query && !onlyConnected.value) return canvasStore.nodes

  return canvasStore.nodes.filter((node) => {
    const connected = !node.endpoint || canvasStore.connectedEndpointKeys.has(`${node.endpoint.type}:${node.endpoint.id}`)
    if (onlyConnected.value && !connected) return false
    if (!query) return true
    return `${node.label} ${node.kind}`.toLowerCase().includes(query)
  })
})

const selectedNode = computed(() => canvasStore.selectedNode)
const selectedEdge = computed(() => canvasStore.selectedEdge)
const recommendationPrompt = ref('')
const recommendationLoading = ref(false)
const recommendationError = ref('')
const recommendationPlans = ref<ApiRecommendationPlan[]>([])
const selectedPlanId = ref<string | null>(null)
const previewByPlanId = ref<Record<string, string>>({})

const connectCandidate = computed(() => {
  if (!selectedNode.value?.endpoint) return null
  return selectedNode.value.endpoint
})

const canStartConnect = computed(() => !!connectCandidate.value)

const createConnection = async () => {
  if (!canvasStore.selection.pendingEndpoint || !connectCandidate.value) return
  await canvasStore.connectEndpoints(canvasStore.selection.pendingEndpoint, connectCandidate.value)
  await canvasStore.loadWorkspaceGraph()
}

const beginConnect = () => {
  if (!connectCandidate.value) return
  canvasStore.setPendingEndpoint(connectCandidate.value)
}

const clearConnect = () => {
  canvasStore.setPendingEndpoint(null)
}

const removeSelectedEdge = async () => {
  if (!selectedEdge.value) return
  const ok = await canvasStore.disconnectEdge(selectedEdge.value.id)
  if (ok) {
    await canvasStore.loadWorkspaceGraph()
  }
}

const openDeviceDetail = () => {
  if (!selectedNode.value?.deviceId) return
  store.requestDeviceFocus(selectedNode.value.deviceId)
  store.setTab('devices')
}

const endpointLabel = (endpoint: CanvasEndpoint) => `${endpoint.type}:${endpoint.id}`

const selectedPlan = computed(() => {
  return recommendationPlans.value.find((plan) => plan.id === selectedPlanId.value) || null
})

const requestRecommendations = async () => {
  const text = recommendationPrompt.value.trim()
  if (!text) return
  recommendationLoading.value = true
  recommendationError.value = ''
  previewByPlanId.value = {}
  try {
    const result = await api.recommendConnectionsFromIntent({ text, limit: 3, min_score: 0.55, max_hops: 6 })
    recommendationPlans.value = result.plans || []
    selectedPlanId.value = recommendationPlans.value[0]?.id || null
    if (!recommendationPlans.value.length) {
      recommendationError.value = 'No feasible plans found for this workspace state.'
    }
  } catch (err: any) {
    recommendationError.value = err?.message || 'Failed to generate recommendations.'
  } finally {
    recommendationLoading.value = false
  }
}

const previewSelectedPlan = async () => {
  if (!selectedPlan.value) return
  try {
    const result = await api.previewRecommendationPlan(selectedPlan.value)
    previewByPlanId.value[selectedPlan.value.id] = result.ok
      ? 'Ready to apply.'
      : (result.conflicts[0]?.message || 'Plan has conflicts.')
  } catch (err: any) {
    previewByPlanId.value[selectedPlan.value.id] = err?.message || 'Preview failed.'
  }
}

const applySelectedPlan = async () => {
  if (!selectedPlan.value) return
  try {
    await api.applyRecommendationPlan(selectedPlan.value)
    await canvasStore.loadWorkspaceGraph()
    await store.syncConnectionsProjectionSafe()
    previewByPlanId.value[selectedPlan.value.id] = 'Applied successfully.'
  } catch (err: any) {
    previewByPlanId.value[selectedPlan.value.id] = err?.message || 'Apply failed.'
  }
}
</script>

<template>
  <section class="workspace-graph">
    <header class="graph-header">
      <h2>Workspace Graph</h2>
      <div class="graph-actions">
        <input v-model="searchQuery" class="graph-search" placeholder="Search devices, ports, or patchbay points" />
        <label class="connected-filter"><input v-model="onlyConnected" type="checkbox" /> Only connected</label>
        <button class="ghost-btn" @click="canvasStore.loadWorkspaceGraph">Refresh</button>
      </div>
    </header>

    <div v-if="canvasStore.loading" class="loading">Loading graph...</div>
    <div v-else-if="canvasStore.error" class="error">{{ canvasStore.error }}</div>

    <div v-else class="graph-layout">
      <GraphView
        :nodes="filteredNodes"
        :edges="canvasStore.edges"
        :selected-node-id="canvasStore.selection.selectedNodeId"
        :selected-edge-id="canvasStore.selection.selectedEdgeId"
        :hovered-node-id="hoveredNodeId"
        @select-node="(id) => { hoveredNodeId = id; canvasStore.selectNode(id) }"
        @select-edge="(id) => canvasStore.selectEdge(id)"
      />

      <aside class="details-panel">
        <h3>Details</h3>

        <div v-if="canvasStore.selection.pendingEndpoint" class="connect-banner">
          Endpoint A: <strong>{{ endpointLabel(canvasStore.selection.pendingEndpoint) }}</strong>
          <button class="ghost-btn" @click="clearConnect">Cancel</button>
        </div>

        <template v-if="selectedNode">
          <p><strong>Node:</strong> {{ selectedNode.label }}</p>
          <p><strong>Kind:</strong> {{ selectedNode.kind }}</p>
          <p v-if="selectedNode.endpoint"><strong>Endpoint:</strong> {{ endpointLabel(selectedNode.endpoint) }}</p>
          <div class="detail-actions">
            <button v-if="canStartConnect" class="ghost-btn" @click="beginConnect">Set as endpoint A</button>
            <button
              v-if="canvasStore.selection.pendingEndpoint && connectCandidate"
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

        <hr />
        <div class="reco-box">
          <h4>Recommend Connections</h4>
          <textarea
            v-model="recommendationPrompt"
            class="reco-input"
            rows="3"
            placeholder="Example: Record vocal mic through preamp + compressor into Pro Tools"
          />
          <button class="primary-btn" :disabled="recommendationLoading || !recommendationPrompt.trim()" @click="requestRecommendations">
            {{ recommendationLoading ? 'Generating...' : 'Generate Plans' }}
          </button>
          <p v-if="recommendationError" class="hint error">{{ recommendationError }}</p>

          <div v-if="recommendationPlans.length" class="reco-list">
            <button
              v-for="plan in recommendationPlans"
              :key="plan.id"
              type="button"
              class="reco-plan"
              :class="{ selected: selectedPlanId === plan.id }"
              @click="selectedPlanId = plan.id"
            >
              <strong>{{ plan.id }}</strong>
              <span>Score {{ plan.score.toFixed(2) }}</span>
              <span>{{ plan.stages.map((stage) => stage.label).join(' -> ') }}</span>
            </button>
          </div>

          <div v-if="selectedPlan" class="reco-detail">
            <p><strong>Why</strong></p>
            <p v-for="reason in selectedPlan.why" :key="reason" class="muted">{{ reason }}</p>
            <p><strong>Instructions</strong></p>
            <p v-for="step in selectedPlan.instructions" :key="step" class="muted">{{ step }}</p>
            <p><strong>Device use notes</strong></p>
            <p v-for="device in selectedPlan.devices" :key="device.device_id" class="muted">
              {{ device.device_name }} · Use: {{ device.why_use || 'n/a' }} · Avoid: {{ device.why_not || 'n/a' }}
            </p>
            <div class="detail-actions">
              <button class="ghost-btn" @click="previewSelectedPlan">Preview plan</button>
              <button class="primary-btn" @click="applySelectedPlan">Apply plan</button>
            </div>
            <p v-if="previewByPlanId[selectedPlan.id]" class="hint">{{ previewByPlanId[selectedPlan.id] }}</p>
          </div>
        </div>
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

.reco-box {
  display: grid;
  gap: 8px;
}

.reco-input {
  width: 100%;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-1);
  color: var(--text-primary);
  padding: 8px;
}

.reco-list {
  display: grid;
  gap: 6px;
}

.reco-plan {
  display: grid;
  gap: 2px;
  text-align: left;
  padding: 8px;
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background: var(--surface-1);
  color: var(--text-primary);
  cursor: pointer;
}

.reco-plan.selected {
  border-color: rgba(212, 154, 79, 0.6);
}

.reco-detail {
  display: grid;
  gap: 4px;
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
