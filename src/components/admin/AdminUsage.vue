<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminAccessStore } from '@/stores/adminAccess'
import { store } from '@/store'

const feature = ref('ai_detection')
const period = ref(String(new Date().getFullYear() * 100 + (new Date().getMonth() + 1)).padStart(6, '0'))

const usage = computed(() => {
  const parsedPeriod = Number(period.value)
  if (!Number.isFinite(parsedPeriod)) return null
  return adminAccessStore.getUsage(feature.value, parsedPeriod)
})

const remainingDisplay = computed(() => {
  const value = usage.value?.remaining
  if (typeof value === 'number') return String(value)
  if (usage.value?.limit == null) return 'Unlimited'
  return 'n/a'
})

async function loadUsage() {
  if (!adminAccessStore.workspaceId) return

  const parsedPeriod = Number(period.value)
  if (!Number.isFinite(parsedPeriod) || period.value.length !== 6) {
    store.pushToast({ type: 'error', message: 'Period must be YYYYMM.' })
    return
  }

  try {
    await adminAccessStore.loadUsage(feature.value, parsedPeriod)
  } catch (error: any) {
    const message = error?.message === 'AUTH_FORBIDDEN'
      ? 'Not authorized to read usage.'
      : (error?.message || 'Failed to load usage.')
    store.pushToast({ type: 'error', message })
  }
}
</script>

<template>
  <section class="panel" v-if="adminAccessStore.workspaceId">
    <h3>AI Usage</h3>

    <div class="controls">
      <label class="field">
        <span>Feature</span>
        <select v-model="feature">
          <option value="ai_detection">ai_detection</option>
          <option value="ai_intent">ai_intent</option>
        </select>
      </label>

      <label class="field">
        <span>Period (YYYYMM)</span>
        <input v-model="period" type="text" inputmode="numeric" maxlength="6" placeholder="202602" />
      </label>

      <button class="btn" :disabled="adminAccessStore.loading.usage" @click="loadUsage">
        {{ adminAccessStore.loading.usage ? 'Loading...' : 'Load usage' }}
      </button>
    </div>

    <div class="usage-card" v-if="usage">
      <div><strong>Limit:</strong> {{ usage.limit == null ? 'Unlimited' : usage.limit }}</div>
      <div><strong>Used:</strong> {{ usage.used }}</div>
      <div><strong>Remaining:</strong> {{ remainingDisplay }}</div>
    </div>

    <div class="empty" v-else>
      No usage loaded for the selected feature/period.
    </div>
  </section>

  <section v-else class="panel empty">
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

.controls {
  display: flex;
  gap: var(--space-3);
  align-items: end;
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field input,
.field select {
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
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

.usage-card {
  display: grid;
  gap: 8px;
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-3);
}

.empty {
  color: var(--text-secondary);
}
</style>
