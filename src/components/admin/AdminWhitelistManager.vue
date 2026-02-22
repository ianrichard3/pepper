<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminAccessStore } from '@/stores/adminAccess'
import { store } from '@/store'

const props = withDefaults(defineProps<{ floatingMode?: boolean }>(), { floatingMode: false })

const newUserId = ref('')
const newNote = ref('')

onMounted(() => {
  void adminAccessStore.loadWhitelist().catch(() => {})
})

async function refresh() {
  try {
    await adminAccessStore.loadWhitelist()
  } catch (error: any) {
    store.pushToast({ type: 'error', message: error?.message || 'Failed to load whitelist.' })
  }
}

async function addEntry() {
  const clerkUserId = newUserId.value.trim()
  if (!clerkUserId) {
    store.pushToast({ type: 'error', message: 'Clerk user ID is required.' })
    return
  }
  try {
    await adminAccessStore.createWhitelistEntry({ clerk_user_id: clerkUserId, note: newNote.value.trim() || null })
    newUserId.value = ''
    newNote.value = ''
    store.pushToast({ type: 'success', message: 'Whitelist entry saved.' })
  } catch (error: any) {
    store.pushToast({ type: 'error', message: error?.message || 'Failed to save whitelist entry.' })
  }
}

async function toggleEntry(id: number, nextActive: boolean) {
  try {
    await adminAccessStore.updateWhitelistEntry(id, { active: nextActive })
    store.pushToast({ type: 'success', message: `Whitelist entry ${nextActive ? 'enabled' : 'disabled'}.` })
  } catch (error: any) {
    store.pushToast({ type: 'error', message: error?.message || 'Failed to update whitelist entry.' })
  }
}

async function removeEntry(id: number) {
  try {
    await adminAccessStore.deleteWhitelistEntry(id)
    store.pushToast({ type: 'success', message: 'Whitelist entry removed.' })
  } catch (error: any) {
    store.pushToast({ type: 'error', message: error?.message || 'Failed to remove whitelist entry.' })
  }
}
</script>

<template>
  <section class="panel" :class="{ 'floating-mode': props.floatingMode }">
    <header class="header">
      <div>
        <h3>Admin Whitelist</h3>
        <p>Only users listed here can access the admin panel (plus break-glass superadmins).</p>
      </div>
      <button class="btn secondary" :disabled="adminAccessStore.loading.whitelistList" @click="refresh">
        {{ adminAccessStore.loading.whitelistList ? 'Loading...' : 'Refresh' }}
      </button>
    </header>

    <div class="controls">
      <input v-model="adminAccessStore.whitelistQuery" type="text" placeholder="Search by Clerk user ID or note..." />
      <label class="checkbox">
        <input v-model="adminAccessStore.whitelistShowInactive" type="checkbox" @change="refresh" />
        <span>Show inactive</span>
      </label>
      <button class="btn secondary" @click="refresh">Search</button>
    </div>

    <div class="add-row">
      <input v-model="newUserId" type="text" placeholder="clerk_user_id" />
      <input v-model="newNote" type="text" placeholder="note (optional)" />
      <button class="btn" :disabled="adminAccessStore.loading.whitelistSave" @click="addEntry">
        {{ adminAccessStore.loading.whitelistSave ? 'Saving...' : 'Add / Reactivate' }}
      </button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Note</th>
            <th>Status</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in adminAccessStore.whitelistEntries" :key="entry.id">
            <td>{{ entry.clerk_user_id }}</td>
            <td>{{ entry.note || '—' }}</td>
            <td>
              <span class="pill" :class="{ inactive: !entry.active }">{{ entry.active ? 'Active' : 'Inactive' }}</span>
            </td>
            <td>{{ entry.updated_at ? new Date(entry.updated_at).toLocaleString() : '—' }}</td>
            <td class="actions">
              <button class="btn secondary compact" @click="toggleEntry(entry.id, !entry.active)">
                {{ entry.active ? 'Disable' : 'Enable' }}
              </button>
              <button class="btn danger compact" @click="removeEntry(entry.id)">Remove</button>
            </td>
          </tr>
          <tr v-if="adminAccessStore.whitelistEntries.length === 0">
            <td colspan="5" class="empty">No whitelist entries found.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-4);
  display: grid;
  gap: var(--space-3);
}
.panel.floating-mode {
  background: transparent;
  border: none;
  padding: var(--space-2);
}
.header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-3);
}
.header h3 {
  margin: 0;
}
.header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
}
.controls,
.add-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-2);
}
.add-row {
  grid-template-columns: 1fr 1fr auto;
}
input {
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
}
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.table-wrap {
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
}
.table {
  width: 100%;
  border-collapse: collapse;
  min-width: 760px;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-default);
}
.actions {
  display: flex;
  gap: 8px;
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
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}
.btn.danger {
  background: var(--danger);
  color: #fff;
}
.btn.compact {
  padding: 6px 10px;
  font-weight: 600;
}
.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  background: color-mix(in oklab, var(--accent) 15%, transparent);
}
.pill.inactive {
  background: color-mix(in oklab, var(--danger) 15%, transparent);
}
.empty {
  color: var(--text-secondary);
}
@media (max-width: 960px) {
  .controls,
  .add-row {
    grid-template-columns: 1fr;
  }
}
</style>
