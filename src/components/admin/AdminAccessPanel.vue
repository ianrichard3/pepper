<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { adminAccessStore } from '@/stores/adminAccess'
import { store } from '@/store'
import AdminWorkspaceAccess from './AdminWorkspaceAccess.vue'
import AdminUserOverrides from './AdminUserOverrides.vue'
import AdminUsage from './AdminUsage.vue'
import AdminWhitelistManager from './AdminWhitelistManager.vue'
import AdminSegmentedTabs from './AdminSegmentedTabs.vue'

type RootTab = 'workspaces' | 'whitelist'
type WorkspaceTab = 'workspace' | 'users' | 'usage'

const props = withDefaults(defineProps<{ floatingMode?: boolean }>(), {
  floatingMode: false,
})

const rootTab = ref<RootTab>('workspaces')
const workspaceTab = ref<WorkspaceTab>('workspace')
const workspaceSearchDraft = ref('')
const rootTabItems = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'whitelist', label: 'Whitelist' },
] as const
const workspaceTabItems = [
  { id: 'workspace', label: 'Workspace Access' },
  { id: 'users', label: 'Users' },
  { id: 'usage', label: 'AI Usage' },
] as const

const selectedWorkspaceLabel = computed(() => {
  const summary = adminAccessStore.selectedWorkspaceSummary
  if (!adminAccessStore.workspaceId) return 'No workspace selected'
  if (!summary) return `Workspace #${adminAccessStore.workspaceId}`
  return summary.name
    ? `${summary.name} (#${summary.workspace_id})`
    : `Workspace #${summary.workspace_id}`
})

onMounted(async () => {
  try {
    await adminAccessStore.loadWorkspaceList()
    workspaceSearchDraft.value = adminAccessStore.workspaceSearchQuery
  } catch {
    // toast on explicit user action
  }
  if (adminAccessStore.workspaceId) {
    void adminAccessStore.loadWorkspace(adminAccessStore.workspaceId).catch(() => {})
  }
})

watch(
  () => adminAccessStore.workspaceId,
  (workspaceId) => {
    if (!workspaceId) return
    adminAccessStore.selectedWorkspaceSummary =
      adminAccessStore.workspaceList.find((item) => item.workspace_id === workspaceId) || adminAccessStore.selectedWorkspaceSummary
  }
)

async function searchWorkspaces() {
  try {
    await adminAccessStore.loadWorkspaceList({ q: workspaceSearchDraft.value })
  } catch (error: any) {
    store.pushToast({ type: 'error', message: error?.message || 'Failed to load workspaces.' })
  }
}

async function selectWorkspace(workspaceId: number) {
  try {
    await adminAccessStore.selectWorkspace(workspaceId)
    if (workspaceTab.value === 'users') {
      await adminAccessStore.loadMemberOverrides()
    }
    store.pushToast({ type: 'success', message: `Loaded workspace #${workspaceId}.` })
  } catch (error: any) {
    const message = error?.message === 'AUTH_FORBIDDEN'
      ? 'Not authorized to access this workspace.'
      : (error?.message || 'Failed to load workspace.')
    store.pushToast({ type: 'error', message })
  }
}

async function onWorkspaceTabChange(tab: WorkspaceTab) {
  workspaceTab.value = tab
  if (tab === 'users' && adminAccessStore.workspaceId) {
    try {
      await adminAccessStore.loadMemberOverrides()
    } catch {
      // child/store handles errors
    }
  }
}
</script>

<template>
  <section class="admin-shell" :class="{ 'floating-mode': props.floatingMode }">
    <header v-if="!props.floatingMode" class="hero">
      <div>
        <h2>Admin Console</h2>
        <p>Whitelist access, search workspaces, and manage entitlements with a structured view.</p>
      </div>
      <div class="hero-meta">Selected: {{ selectedWorkspaceLabel }}</div>
    </header>

    <AdminSegmentedTabs
      v-model="rootTab"
      :items="[...rootTabItems]"
      :size="props.floatingMode ? 'sm' : 'md'"
    />

    <AdminWhitelistManager v-if="rootTab === 'whitelist'" :floating-mode="props.floatingMode" />

    <section v-else class="workspace-admin">
      <aside class="workspace-list-panel">
        <div class="workspace-search">
          <input
            v-model="workspaceSearchDraft"
            type="text"
            placeholder="Search by name, org ID, or workspace ID"
            @keydown.enter.prevent="void searchWorkspaces()"
          />
          <button class="btn secondary" :disabled="adminAccessStore.loading.workspaceList" @click="searchWorkspaces">
            {{ adminAccessStore.loading.workspaceList ? 'Loading...' : 'Search' }}
          </button>
        </div>

        <div class="workspace-table-wrap">
          <table class="workspace-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Org ID</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ws in adminAccessStore.workspaceList"
                :key="ws.workspace_id"
                :class="{ selected: adminAccessStore.workspaceId === ws.workspace_id }"
                @click="selectWorkspace(ws.workspace_id)"
              >
                <td>{{ ws.workspace_id }}</td>
                <td>{{ ws.name || '—' }}</td>
                <td>{{ ws.org_id }}</td>
              </tr>
              <tr v-if="adminAccessStore.workspaceList.length === 0">
                <td colspan="3" class="empty">No workspaces found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>

      <section class="workspace-detail">
        <header class="workspace-header">
          <div>
            <h3>{{ selectedWorkspaceLabel }}</h3>
            <p v-if="adminAccessStore.selectedWorkspaceSummary?.org_id">
              Org: {{ adminAccessStore.selectedWorkspaceSummary.org_id }}
            </p>
          </div>
          <button
            class="btn secondary"
            :disabled="!adminAccessStore.workspaceId || adminAccessStore.loading.workspace"
            @click="adminAccessStore.workspaceId && selectWorkspace(adminAccessStore.workspaceId)"
          >
            Refresh
          </button>
        </header>

        <AdminSegmentedTabs
          :model-value="workspaceTab"
          :items="[...workspaceTabItems]"
          :size="props.floatingMode ? 'sm' : 'md'"
          full-width
          @change="onWorkspaceTabChange($event as WorkspaceTab)"
        />

        <AdminWorkspaceAccess v-if="workspaceTab === 'workspace'" :floating-mode="props.floatingMode" />
        <AdminUserOverrides v-else-if="workspaceTab === 'users'" :floating-mode="props.floatingMode" />
        <AdminUsage v-else :floating-mode="props.floatingMode" />
      </section>
    </section>
  </section>
</template>

<style scoped>
.admin-shell {
  display: grid;
  gap: var(--space-4);
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.admin-shell.floating-mode {
  padding: var(--space-2);
  gap: var(--space-3);
}

.hero {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-3);
  background:
    radial-gradient(circle at 10% 10%, color-mix(in oklab, var(--accent) 15%, transparent), transparent 55%),
    linear-gradient(180deg, var(--surface-2), color-mix(in oklab, var(--surface-2) 70%, black));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-4);
}

.hero h2 {
  margin: 0;
}

.hero p {
  margin: 6px 0 0;
  color: var(--text-secondary);
}

.hero-meta {
  color: var(--text-secondary);
  white-space: nowrap;
}

.workspace-admin {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: var(--space-4);
  min-height: 0;
}

.workspace-list-panel,
.workspace-detail {
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-3);
  display: grid;
  gap: var(--space-3);
  min-height: 0;
}

.workspace-search {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-2);
}

.workspace-search input {
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
}

.workspace-table-wrap {
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
}

.workspace-table {
  width: 100%;
  border-collapse: collapse;
}

.workspace-table th,
.workspace-table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-default);
  vertical-align: top;
}

.workspace-table tbody tr {
  cursor: pointer;
}

.workspace-table tbody tr:hover {
  background: color-mix(in oklab, var(--accent) 8%, transparent);
}

.workspace-table tbody tr.selected {
  background: color-mix(in oklab, var(--accent) 16%, transparent);
}

.empty {
  color: var(--text-secondary);
}

.workspace-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: var(--space-3);
}

.workspace-header h3 {
  margin: 0;
}

.workspace-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
}

.btn {
  background: var(--accent);
  color: #11130f;
  border: none;
  border-radius: var(--radius-2);
  padding: 8px 12px;
  font-weight: 700;
  cursor: pointer;
}

.btn.secondary {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-primary);
}

@media (max-width: 1100px) {
  .workspace-admin {
    grid-template-columns: 1fr;
  }
}
</style>
