<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminAccessStore } from '@/stores/adminAccess'
import { store } from '@/store'
import AdminWorkspaceAccess from './AdminWorkspaceAccess.vue'
import AdminUserOverrides from './AdminUserOverrides.vue'
import AdminUsage from './AdminUsage.vue'

type AdminTab = 'workspace' | 'users' | 'usage'

const props = withDefaults(defineProps<{ floatingMode?: boolean }>(), {
  floatingMode: false,
})

const activeTab = ref<AdminTab>('workspace')
const workspaceInput = ref('')
adminAccessStore.initializeWorkspaceFromAuthContext()
if (adminAccessStore.workspaceId) {
  workspaceInput.value = String(adminAccessStore.workspaceId)
}

onMounted(() => {
  if (adminAccessStore.workspaceId) {
    void adminAccessStore.loadWorkspace(adminAccessStore.workspaceId).catch(() => {})
  }
})

const workspaceLabel = computed(() => {
  if (!adminAccessStore.workspaceId) return 'No workspace selected'
  return `Workspace #${adminAccessStore.workspaceId}`
})

function parseWorkspaceId(): number | null {
  const parsed = Number(workspaceInput.value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

async function loadWorkspace() {
  const workspaceId = parseWorkspaceId()
  if (!workspaceId) {
    store.pushToast({ type: 'error', message: 'Workspace ID must be a positive number.' })
    return
  }

  try {
    await adminAccessStore.loadWorkspace(workspaceId)
    store.pushToast({ type: 'success', message: `Loaded workspace #${workspaceId}.` })
    if (activeTab.value === 'users') {
      await adminAccessStore.loadMemberOverrides()
    }
  } catch (error: any) {
    const message = error?.message === 'AUTH_FORBIDDEN'
      ? 'Not authorized to access this workspace.'
      : (error?.message || 'Failed to load workspace.')
    store.pushToast({ type: 'error', message })
  }
}

async function onTabChange(tab: AdminTab) {
  activeTab.value = tab
  if (tab === 'users' && adminAccessStore.workspaceId) {
    try {
      await adminAccessStore.loadMemberOverrides()
    } catch {
      // error toast handled by component/store consumers
    }
  }
}
</script>

<template>
  <section class="admin-access" :class="{ 'floating-mode': props.floatingMode }">
    <header v-if="!props.floatingMode" class="admin-header">
      <p>Manage workspace access, per-user overrides, and AI usage.</p>
    </header>

    <div class="workspace-row">
      <label class="field">
        <span>Workspace ID</span>
        <input v-model="workspaceInput" type="text" inputmode="numeric" placeholder="123" />
      </label>
      <button class="btn" :disabled="adminAccessStore.loading.workspace" @click="loadWorkspace">
        {{ adminAccessStore.loading.workspace ? 'Loading...' : 'Load workspace' }}
      </button>
      <span class="workspace-label">{{ workspaceLabel }}</span>
    </div>

    <nav class="admin-tabs">
      <button :class="{ active: activeTab === 'workspace' }" @click="onTabChange('workspace')">Workspace Access</button>
      <button :class="{ active: activeTab === 'users' }" @click="onTabChange('users')">Users Overrides</button>
      <button :class="{ active: activeTab === 'usage' }" @click="onTabChange('usage')">AI Usage</button>
    </nav>

    <AdminWorkspaceAccess v-if="activeTab === 'workspace'" :floating-mode="props.floatingMode" />
    <AdminUserOverrides v-else-if="activeTab === 'users'" :floating-mode="props.floatingMode" />
    <AdminUsage v-else :floating-mode="props.floatingMode" />
  </section>
</template>

<style scoped>
.admin-access {
  display: grid;
  gap: var(--space-4);
  height: 100%;
  overflow: auto;
  min-height: 0;
}

.admin-access.floating-mode {
  gap: var(--space-3);
  padding: var(--space-2);
}

.admin-header h2 {
  margin: 0 0 6px 0;
}

.admin-header p {
  margin: 0;
  color: var(--text-secondary);
}

.workspace-row {
  display: flex;
  align-items: end;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field input {
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
}

.workspace-label {
  color: var(--text-secondary);
}

.btn {
  background: var(--accent);
  color: #11130f;
  border: none;
  border-radius: var(--radius-2);
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.admin-tabs {
  display: flex;
  gap: var(--space-2);
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-round);
  padding: var(--space-1);
  width: fit-content;
}

.admin-tabs button {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 8px 12px;
  border-radius: var(--radius-round);
  cursor: pointer;
  font-weight: 600;
}

.admin-tabs button.active {
  background: var(--accent);
  color: #11130f;
}
</style>
