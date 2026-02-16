<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { adminAccessStore, type EditableEntitlements } from '@/stores/adminAccess'
import { featureKeys, limitKeys, type FeatureKey, type LimitKey } from '@/lib/entitlementKeys'
import { store } from '@/store'

const props = withDefaults(defineProps<{ floatingMode?: boolean }>(), {
  floatingMode: false,
})

const selectedUserId = ref<string | null>(null)
const localOverride = reactive<EditableEntitlements>({
  enabled: true,
  plan: '',
  features: {
    ai_detection: false,
    ai_intent: false,
    export: false,
  },
  limits: {},
})

const hasWorkspace = computed(() => adminAccessStore.workspaceId !== null)

function resetLocalOverride() {
  localOverride.enabled = true
  localOverride.plan = ''
  for (const key of featureKeys) {
    localOverride.features[key] = false
  }
  for (const key of limitKeys) {
    delete localOverride.limits[key]
  }
}

function copyOverride(override: EditableEntitlements | null) {
  resetLocalOverride()
  if (!override) return

  for (const key of featureKeys) {
    localOverride.features[key] = Boolean(override.features[key])
  }

  for (const key of limitKeys) {
    const value = override.limits[key]
    if (typeof value === 'number' && value >= 0) {
      localOverride.limits[key] = value
    }
  }
}

async function openEditor(userId: string) {
  selectedUserId.value = userId
  try {
    const override = await adminAccessStore.loadUserOverride(userId)
    copyOverride(override)
  } catch (error: any) {
    const message = error?.message === 'AUTH_FORBIDDEN'
      ? 'Not authorized to read user overrides.'
      : (error?.message || 'Failed to load override.')
    store.pushToast({ type: 'error', message })
  }
}

async function saveSelected() {
  if (!selectedUserId.value) return
  adminAccessStore.memberOverrides[selectedUserId.value] = {
    enabled: true,
    plan: '',
    features: { ...localOverride.features },
    limits: { ...localOverride.limits },
  }

  try {
    await adminAccessStore.saveOverride(selectedUserId.value)
    store.pushToast({ type: 'success', message: 'User override saved.' })
  } catch (error: any) {
    const message = error?.message === 'AUTH_FORBIDDEN'
      ? 'Not authorized to update user overrides.'
      : (error?.message || 'Failed to save override.')
    store.pushToast({ type: 'error', message })
  }
}

async function removeSelected() {
  if (!selectedUserId.value) return

  try {
    await adminAccessStore.removeOverride(selectedUserId.value)
    resetLocalOverride()
    store.pushToast({ type: 'success', message: 'User override removed.' })
  } catch (error: any) {
    const message = error?.message === 'AUTH_FORBIDDEN'
      ? 'Not authorized to remove user overrides.'
      : (error?.message || 'Failed to remove override.')
    store.pushToast({ type: 'error', message })
  }
}

function setFeature(key: FeatureKey, value: boolean) {
  localOverride.features[key] = value
}

function setLimit(key: LimitKey, value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    delete localOverride.limits[key]
    return
  }

  const parsed = Number(trimmed)
  if (Number.isFinite(parsed) && parsed >= 0) {
    localOverride.limits[key] = parsed
  }
}
</script>

<template>
  <section class="panel" :class="{ 'floating-mode': props.floatingMode }" v-if="hasWorkspace">
    <h3 v-if="!props.floatingMode">User Overrides</h3>
    <p v-if="!props.floatingMode" class="sub">Select a member to create/update/remove per-user overrides.</p>

    <div class="members-grid">
      <div class="member-list">
        <button
          v-for="member in adminAccessStore.members"
          :key="member.clerk_user_id"
          class="member-btn"
          :class="{ active: selectedUserId === member.clerk_user_id }"
          @click="openEditor(member.clerk_user_id)"
        >
          <div class="member-primary">{{ member.clerk_user_id }}</div>
          <div v-if="member.email" class="member-secondary">{{ member.email }}</div>
        </button>
      </div>

      <div class="editor" v-if="selectedUserId">
        <h4 v-if="!props.floatingMode">Edit override</h4>
        <p class="sub">User: {{ selectedUserId }}</p>

        <div class="field-group">
          <h5 v-if="!props.floatingMode">Features</h5>
          <label v-for="key in featureKeys" :key="key" class="field checkbox-row compact">
            <input type="checkbox" :checked="localOverride.features[key]" @change="setFeature(key, ($event.target as HTMLInputElement).checked)" />
            <span>{{ key }}</span>
          </label>
        </div>

        <div class="field-group">
          <h5 v-if="!props.floatingMode">Limits</h5>
          <label v-for="key in limitKeys" :key="key" class="field compact">
            <span>{{ key }}</span>
            <input
              type="number"
              min="0"
              step="1"
              :value="localOverride.limits[key] ?? ''"
              @input="setLimit(key, ($event.target as HTMLInputElement).value)"
              placeholder="(inherit workspace)"
            />
          </label>
        </div>

        <div class="editor-actions">
          <button class="btn" :disabled="adminAccessStore.loading.override" @click="saveSelected">Save override</button>
          <button class="btn danger" :disabled="adminAccessStore.loading.override" @click="removeSelected">Remove override</button>
        </div>
      </div>
    </div>
  </section>

  <section v-else class="panel empty" :class="{ 'floating-mode': props.floatingMode }">
    Load a workspace first.
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

.sub {
  color: var(--text-secondary);
  margin-top: 0;
}

.members-grid {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: var(--space-4);
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 480px;
  overflow: auto;
}

.member-btn {
  text-align: left;
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: 10px;
  color: var(--text-primary);
  cursor: pointer;
}

.member-btn.active {
  border-color: var(--accent);
}

.member-secondary {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-2);
}

.checkbox-row {
  flex-direction: row;
  align-items: center;
}

.field input {
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
}

.editor-actions {
  display: flex;
  gap: var(--space-2);
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

.btn.danger {
  background: var(--danger);
  color: white;
}

.empty {
  color: var(--text-secondary);
}

@media (max-width: 960px) {
  .members-grid {
    grid-template-columns: 1fr;
  }
}
</style>
