<script setup lang="ts">
import DevicesManager from './DevicesManager.vue'

defineProps<{
  mode: 'add' | 'edit'
  deviceId?: number
  parentWindowId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <DevicesManager
    floating-mode
    modal-only
    :modal-mode="mode"
    :modal-device-id="deviceId"
    :modal-parent-window-id="parentWindowId"
    :on-request-close-modal-window="() => emit('close')"
  />
</template>
