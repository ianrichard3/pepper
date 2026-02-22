import { computed } from 'vue'
import { useAuthz } from './authz'

export function useEntitlements() {
  const { hasFeature, getLimit, authContextError, authContext } = useAuthz()

  const entitlementsSupported = computed(() => authContextError.value !== 'AUTH_CONTEXT_UNSUPPORTED')
  const entitlementsDegraded = computed(() => {
    return Boolean(authContextError.value) && authContextError.value !== 'AUTH_CONTEXT_UNSUPPORTED'
  })

  const hasAppAccess = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return true
    return authContext.value?.enabled !== false
  })

  const canUseAiDetection = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('ai_detection', false)
  })

  const canExport = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('export', false)
  })

  const canUseCatalog = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('catalog', false)
  })

  const canEditDevices = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('device_edit', false)
  })

  const canEditPatchbay = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('patchbay_edit', false)
  })

  const canEditPatchbayLayout = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('patchbay_layout_edit', false)
  })

  const canEditRouting = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('routing_edit', false)
  })

  const canRunIntentDeviceMatch = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('ai_intent_device_match', false)
  })

  const canImportPortability = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('portability_import', false)
  })

  const aiMonthlyLimit = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('ai_detection_per_month')
  })

  const aiIntentMonthlyLimit = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('ai_intent_per_month')
  })

  const aiIntentDeviceMatchMonthlyLimit = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('ai_intent_device_match_per_month')
  })

  const maxDevices = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('max_devices')
  })

  const maxDevicePortsTotal = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('max_device_ports_total')
  })

  const maxPortsPerDevice = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('max_ports_per_device')
  })

  const maxPatchbayPoints = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('max_patchbay_points')
  })

  return {
    entitlementsSupported,
    entitlementsDegraded,
    hasAppAccess,
    canUseAiDetection,
    canExport,
    canUseCatalog,
    canEditDevices,
    canEditPatchbay,
    canEditPatchbayLayout,
    canEditRouting,
    canRunIntentDeviceMatch,
    canImportPortability,
    aiMonthlyLimit,
    aiIntentMonthlyLimit,
    aiIntentDeviceMatchMonthlyLimit,
    maxDevices,
    maxDevicePortsTotal,
    maxPortsPerDevice,
    maxPatchbayPoints,
  }
}
