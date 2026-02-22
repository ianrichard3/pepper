export const featureKeys = [
  'ai_detection',
  'ai_intent',
  'ai_intent_device_match',
  'export',
  'catalog',
  'device_edit',
  'patchbay_edit',
  'patchbay_layout_edit',
  'routing_edit',
  'portability_import',
] as const
export type FeatureKey = typeof featureKeys[number]

export const limitKeys = [
  'ai_detection_per_month',
  'ai_intent_per_month',
  'ai_intent_device_match_per_month',
  'max_devices',
  'max_device_ports_total',
  'max_ports_per_device',
  'max_patchbay_points',
] as const
export type LimitKey = typeof limitKeys[number]
