<script setup lang="ts">
import { computed } from 'vue'
import { store } from '@/store'
import { windowManager } from '@/stores/windowManager'
import { strings } from '@/ui/strings'

const props = defineProps<{
  patchbayId: number
  parentWindowId: string
}>()

const t = strings

const node = computed(() => store.patchbayNodes.find((item) => item.id === props.patchbayId) || null)
const connection = computed(() => store.getDeviceByPatchbayId(props.patchbayId))

const handleUnlink = async () => {
  if (!connection.value) return
  await store.unlinkPort(connection.value.device.id, connection.value.port.id)
}

const openLinkSearch = () => {
  windowManager.openChildWindow(
    props.parentWindowId,
    'patchbay-link-search',
    t.patchbay.linkDeviceTitle(props.patchbayId),
    { patchbayId: props.patchbayId, parentWindowId: props.parentWindowId },
    { id: `patchbay-link-search:${props.patchbayId}` },
  )
}
</script>

<template>
  <section v-if="node" class="detail-window">
    <p class="selectable-detail-text"><strong>{{ t.patchbay.nameLabel }}:</strong> {{ node.name }}</p>
    <p class="selectable-detail-text"><strong>{{ t.patchbay.typeLabel }}:</strong> {{ node.type }}</p>
    <p class="selectable-detail-text"><strong>{{ t.patchbay.descriptionLabel }}:</strong> {{ node.description }}</p>

    <div class="connection-status">
      <h3 class="selectable-detail-text">{{ t.patchbay.connectionLabel }}</h3>
      <div v-if="connection" class="connected-info">
        <p class="selectable-detail-text">
          {{ t.patchbay.connectedTo }}:
          <strong>{{ connection.device.name }}</strong>
        </p>
        <p class="selectable-detail-text">
          {{ t.patchbay.portLabel }}:
          <strong>{{ connection.port.label }}</strong>
        </p>
        <button class="unlink-btn" @click="handleUnlink">{{ t.patchbay.unlink }}</button>
      </div>
      <div v-else class="disconnected-info">
        <p class="selectable-detail-text">{{ t.patchbay.notConnected }}</p>
        <button class="link-btn" @click="openLinkSearch">{{ t.patchbay.linkDeviceAction }}</button>
      </div>
    </div>
  </section>
  <section v-else class="detail-window">
    <p class="selectable-detail-text">Patch point not found.</p>
  </section>
</template>

<style scoped>
.detail-window {
  display: grid;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.connection-status {
  display: grid;
  gap: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-3);
  background: var(--surface-1);
}

.connected-info,
.disconnected-info {
  display: grid;
  gap: var(--space-2);
}

.unlink-btn,
.link-btn {
  width: fit-content;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: 6px 10px;
  cursor: pointer;
}

.unlink-btn {
  background: rgba(176, 75, 61, 0.9);
  color: #fff;
}

.link-btn,
.link-btn {
  background: var(--surface-2);
  color: var(--text-secondary);
}
</style>
