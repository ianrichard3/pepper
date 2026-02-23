<script setup lang="ts">
import PatchbayPointEditor from '@/components/PatchbayPointEditor.vue'

defineProps<{
  mode: 'add' | 'edit'
  patchbayId?: number
  parentWindowId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <PatchbayPointEditor
    :mode="mode"
    :patchbay-id="patchbayId"
    @close="emit('close')"
  />
</template>
