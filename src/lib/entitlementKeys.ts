export const featureKeys = ['ai_detection', 'ai_intent', 'export', 'catalog'] as const
export type FeatureKey = typeof featureKeys[number]

export const limitKeys = ['ai_detection_per_month', 'ai_intent_per_month'] as const
export type LimitKey = typeof limitKeys[number]
