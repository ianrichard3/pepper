<script setup lang="ts">
import { computed, ref } from 'vue'
import { store } from '@/store'
import { strings } from '@/ui/strings'

const props = defineProps<{
  patchbayId: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const t = strings
const searchQuery = ref('')

const filteredDevices = computed(() => {
  if (!searchQuery.value) return store.devices
  const query = searchQuery.value.toLowerCase()
  return store.devices.filter((device) => device.name.toLowerCase().includes(query))
})

const selectDeviceForLink = async (deviceId: number, portId: string) => {
  await store.linkPatchbayToDevice(props.patchbayId, deviceId, portId)
  emit('close')
}
</script>

<template>
  <section class="link-search-window">
    <input
      v-model="searchQuery"
      :placeholder="t.patchbay.searchDevicesPlaceholder"
      class="search-input"
      autofocus
    />

    <div class="device-search-list">
      <div v-for="device in filteredDevices" :key="device.id" class="search-device-item">
        <div class="device-name selectable-detail-text">{{ device.name }}</div>
        <div class="device-ports">
          <button
            v-for="port in device.ports"
            :key="port.id"
            class="port-select-btn"
            :class="{ active: port.patchbayId === patchbayId, occupied: port.patchbayId && port.patchbayId !== patchbayId }"
            :disabled="!!(port.patchbayId && port.patchbayId !== patchbayId)"
            @click="selectDeviceForLink(device.id, port.id)"
          >
            {{ port.label }}
            <span v-if="port.patchbayId && port.patchbayId !== patchbayId" class="occupied-tag">
              {{ t.patchbay.occupiedTag(port.patchbayId) }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.link-search-window {
  display: grid;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.search-input {
  padding: 10px 12px;
  background-color: var(--surface-2);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  border-radius: var(--radius-2);
}

.device-search-list {
  display: grid;
  gap: var(--space-3);
}

.search-device-item {
  display: grid;
  gap: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  background: var(--surface-1);
}

.device-name {
  font-weight: 700;
}

.device-ports {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.port-select-btn {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  color: var(--text-secondary);
  padding: 6px 8px;
  cursor: pointer;
}

.port-select-btn.active {
  border-color: rgba(61, 122, 88, 0.8);
  color: var(--text-primary);
}

.port-select-btn.occupied {
  opacity: 0.5;
}

.occupied-tag {
  margin-left: 6px;
  color: var(--text-muted);
}
</style>
