<script setup lang="ts">
import { computed } from 'vue'
import { store, type DevicePort } from '@/store'
import { strings } from '@/ui/strings'

const props = defineProps<{
  deviceId: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const t = strings

const device = computed(() => store.devices.find((item) => item.id === props.deviceId) || null)

const deviceClassificationLabel = computed(() => {
  if (!device.value) return ''
  const subtype = String(device.value.type || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (!subtype || subtype === 'other') return device.value.category
  return `${device.value.category} · ${subtype}`
})

const isPortConnected = (port: DevicePort) => port.patchbayId !== null

const linkPortToPatchbay = (port: DevicePort) => {
  if (!device.value) return
  store.startLinkingPort(
    {
      portId: port.id,
      deviceId: device.value.id,
      deviceName: device.value.name,
      portLabel: port.label,
    },
    {
      returnTab: 'devices',
      returnPayload: { deviceId: device.value.id },
    },
  )
}

const unlinkPortFromDevice = async (port: DevicePort) => {
  if (!device.value) return
  await store.unlinkPort(device.value.id, port.id)
}

const goToPatchPoint = (port: DevicePort) => {
  if (port.patchbayId === null) return
  store.patchbayFocusId = port.patchbayId
  store.setTab('patchbay')
}

const patchTargetLabel = (port: DevicePort) => {
  if (port.patchbayId === null) return ''
  return t.devices.goToPatch(port.patchbayId)
}
</script>

<template>
  <section class="device-window-content">
    <template v-if="device">
      <div class="device-details">
        <p class="selectable-detail-text"><strong>{{ t.devices.typeLabel }}:</strong> {{ deviceClassificationLabel }}</p>
        <p class="selectable-detail-text"><strong>{{ t.devices.idLabel }}:</strong> {{ device.id }}</p>

        <h4>{{ t.devices.portsConfig }}</h4>
        <div class="ports-list">
          <div v-for="port in device.ports" :key="port.id" class="port-item">
            <div class="port-info">
              <span class="port-label selectable-detail-text">{{ port.label }}</span>
              <span class="port-type">{{ t.devices.portTypes[port.type] }}</span>
            </div>

            <div class="port-actions">
              <span class="port-connection" :class="{ empty: !isPortConnected(port) }">
                {{ isPortConnected(port) ? t.devices.connected : t.devices.notConnected }}
              </span>
              <button
                v-if="port.patchbayId === null"
                class="link-action-btn link"
                type="button"
                @click="linkPortToPatchbay(port)"
              >
                {{ t.devices.link }}
              </button>
              <button
                v-else
                class="link-action-btn ghost"
                type="button"
                @click="goToPatchPoint(port)"
              >
                {{ patchTargetLabel(port) }}
              </button>
              <button
                v-if="port.patchbayId !== null"
                class="link-action-btn unlink"
                type="button"
                @click="unlinkPortFromDevice(port)"
              >
                {{ t.devices.unlink }}
              </button>
            </div>
          </div>
        </div>
      </div>

    </template>

    <template v-else>
      <div class="missing-device">
        <p>Device not found.</p>
        <button class="ghost-btn" @click="emit('close')">{{ t.patchbay.close }}</button>
      </div>
    </template>

  </section>
</template>

<style scoped>
.device-window-content {
  display: grid;
  gap: var(--space-3);
}

.device-details h4 {
  margin-top: var(--space-3);
}

.ports-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.port-item {
  background-color: var(--surface-1);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid var(--border-default);
  gap: var(--space-2);
}

.port-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.port-label {
  font-weight: 600;
  color: var(--text-primary);
}

.port-type {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: var(--radius-1);
  text-transform: uppercase;
  background: var(--surface-3);
  color: var(--text-muted);
}

.port-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.port-connection {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.port-connection.empty {
  color: var(--text-muted);
  font-style: italic;
}

.link-action-btn {
  padding: 4px 8px;
  border-radius: var(--radius-1);
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
}

.link-action-btn.link {
  background-color: var(--accent);
  color: #0f120e;
}

.link-action-btn.unlink {
  background-color: var(--danger);
  color: #fef7ee;
}

.link-action-btn.ghost {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.missing-device {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}

.ghost-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: var(--radius-2);
  cursor: pointer;
}
</style>
