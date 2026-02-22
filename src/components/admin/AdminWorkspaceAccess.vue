<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { adminAccessStore } from '@/stores/adminAccess'
import { featureKeys, limitKeys, type LimitKey } from '@/lib/entitlementKeys'
import { store } from '@/store'
import AdminFeatureBuckets from './AdminFeatureBuckets.vue'

const props = withDefaults(defineProps<{ floatingMode?: boolean }>(), {
  floatingMode: false,
})

const allowlistedDraft = ref(false)
const allowlistReason = ref('')
const limitDrafts = reactive(
  Object.fromEntries(limitKeys.map((key) => [key, ''])) as Record<LimitKey, string>
)

watch(
  () => adminAccessStore.allowlisted,
  (value) => {
    allowlistedDraft.value = value
  },
  { immediate: true }
)

watch(
  () => adminAccessStore.workspaceEntitlementsStored,
  (entitlements) => {
    for (const key of limitKeys) {
      const value = entitlements?.limits[key]
      limitDrafts[key] = typeof value === 'number' ? String(value) : ''
    }
  },
  { immediate: true }
)

const hasWorkspace = computed(() => adminAccessStore.workspaceId !== null)
const hasEntitlements = computed(() => Boolean(adminAccessStore.workspaceEntitlementsStored))

const hasInvalidLimit = computed(() => {
  for (const key of limitKeys) {
    const raw = limitDrafts[key].trim()
    if (!raw) continue
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) return true
  }
  return false
})

function applyLimitDrafts() {
  const entitlements = adminAccessStore.workspaceEntitlementsStored
  if (!entitlements) return

  for (const key of limitKeys) {
    const raw = limitDrafts[key].trim()
    if (!raw) {
      delete entitlements.limits[key]
      continue
    }
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      entitlements.limits[key] = parsed
    }
  }
}

async function saveWorkspaceAccess() {
  if (!adminAccessStore.workspaceEntitlementsStored || !hasWorkspace.value) return
  if (hasInvalidLimit.value) {
    store.pushToast({ type: 'error', message: 'Limits must be numbers greater than or equal to 0.' })
    return
  }

  applyLimitDrafts()

  try {
    await adminAccessStore.saveWorkspace()

    if (allowlistedDraft.value !== adminAccessStore.allowlisted) {
      await adminAccessStore.setAllowlist(allowlistedDraft.value, allowlistedDraft.value ? allowlistReason.value : undefined)
    }

    store.pushToast({ type: 'success', message: 'Workspace access updated.' })
    await adminAccessStore.loadWorkspace(adminAccessStore.workspaceId!)
  } catch (error: any) {
    const message = error?.message === 'AUTH_FORBIDDEN'
      ? 'Not authorized to update workspace access.'
      : (error?.message || 'Failed to save workspace access.')
    store.pushToast({ type: 'error', message })
  }
}
</script>

<template>
  <section class="panel" :class="{ 'floating-mode': props.floatingMode }" v-if="hasEntitlements">
    <h3 v-if="!props.floatingMode">Workspace Access</h3>

    <label class="field checkbox-row">
      <input
        type="checkbox"
        :checked="adminAccessStore.workspaceEntitlementsStored!.enabled"
        @change="adminAccessStore.workspaceEntitlementsStored!.enabled = ($event.target as HTMLInputElement).checked"
      />
      <span>Enabled</span>
    </label>

    <label class="field checkbox-row">
      <input type="checkbox" v-model="allowlistedDraft" />
      <span>Allowlisted</span>
    </label>

    <label v-if="allowlistedDraft" class="field">
      <span>Allowlist reason (optional)</span>
      <input v-model="allowlistReason" type="text" placeholder="Support escalation / incident reference" />
    </label>

    <label class="field">
      <span>Plan</span>
      <select v-model="adminAccessStore.workspaceEntitlementsStored!.plan">
        <option value="free">free</option>
        <option value="plus">plus</option>
        <option value="pro">pro</option>
      </select>
    </label>

    <div class="field-group">
      <AdminFeatureBuckets
        :keys="[...featureKeys]"
        :model-value="adminAccessStore.workspaceEntitlementsStored!.features"
        title="Features"
        @update:model-value="adminAccessStore.workspaceEntitlementsStored!.features = $event"
      />
    </div>

    <div class="field-group">
      <h4 v-if="!props.floatingMode">Limits</h4>
      <label v-for="key in limitKeys" :key="key" class="field compact">
        <span>{{ key }}</span>
        <input v-model="limitDrafts[key]" type="number" min="0" step="1" placeholder="(unset)" />
      </label>
    </div>

    <button class="btn" :disabled="adminAccessStore.loading.saveWorkspace || hasInvalidLimit" @click="saveWorkspaceAccess">
      {{ adminAccessStore.loading.saveWorkspace ? 'Saving...' : 'Save' }}
    </button>
  </section>

  <section v-else class="panel empty" :class="{ 'floating-mode': props.floatingMode }">
    Load a workspace to edit access settings.
  </section>
</template>

<style scoped>
.panel {
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-4);
}

.panel.floating-mode {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: var(--space-2);
}

.empty {
  color: var(--text-secondary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-3);
}

.field input,
.field select {
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
}

.field-group {
  margin-bottom: var(--space-3);
}

.checkbox-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.compact {
  margin-bottom: var(--space-2);
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
</style>
