import { reactive } from 'vue'
import type { AuthContextResponse } from '@/lib/api'

function parseHeaderInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const quotaStore = reactive({
  aiDetectionUsedToday: null as number | null,
  aiDetectionRemaining: null as number | null,
  aiDetectionLimit: null as number | null,
  aiIntentUsedToday: null as number | null,
  aiIntentRemaining: null as number | null,
  aiIntentLimit: null as number | null,
  usageResetAt: null as string | null,

  updateFromAuthContext(context: AuthContextResponse | null) {
    const limit = typeof context?.limits?.ai_detection_per_month === 'number'
      ? context?.limits?.ai_detection_per_month
      : null
    this.aiDetectionLimit = limit

    const usage = context?.usage?.ai_detection
    const used = typeof usage?.used === 'number' ? usage.used : null
    if (used !== null) {
      this.aiDetectionUsedToday = used
    }

    const effectiveLimit = typeof usage?.limit === 'number' ? usage.limit : limit
    if (effectiveLimit !== null && used !== null) {
      this.aiDetectionRemaining = Math.max(effectiveLimit - used, 0)
      this.aiDetectionLimit = effectiveLimit
    }

    const intentLimit = typeof context?.limits?.ai_intent_per_month === 'number'
      ? context?.limits?.ai_intent_per_month
      : null
    this.aiIntentLimit = intentLimit

    const intentUsage = context?.usage?.ai_intent
    const intentUsed = typeof intentUsage?.used === 'number' ? intentUsage.used : null
    if (intentUsed !== null) {
      this.aiIntentUsedToday = intentUsed
    }

    const effectiveIntentLimit = typeof intentUsage?.limit === 'number' ? intentUsage.limit : intentLimit
    if (effectiveIntentLimit !== null && intentUsed !== null) {
      this.aiIntentRemaining = Math.max(effectiveIntentLimit - intentUsed, 0)
      this.aiIntentLimit = effectiveIntentLimit
    }
  },

  updateFromQuotaHeaders(headers: Headers): boolean {
    const remaining = parseHeaderInt(headers.get('X-Quota-Remaining'))
    const limit = parseHeaderInt(headers.get('X-Quota-Limit'))
    const reset = headers.get('X-Quota-Reset')

    const didUpdate =
      remaining !== null || limit !== null || (typeof reset === 'string' && reset.length > 0)

    if (limit !== null) {
      this.aiDetectionLimit = limit
    }
    if (remaining !== null) {
      this.aiDetectionRemaining = remaining
      if (this.aiDetectionLimit !== null) {
        this.aiDetectionUsedToday = Math.max(this.aiDetectionLimit - remaining, 0)
      }
    }
    if (reset) {
      this.usageResetAt = reset
    }

    return didUpdate
  },

  recordAiDetectionSuccess() {
    if (this.aiDetectionUsedToday !== null) {
      this.aiDetectionUsedToday = Math.max(this.aiDetectionUsedToday + 1, 0)
    }
    if (this.aiDetectionRemaining !== null) {
      this.aiDetectionRemaining = Math.max(this.aiDetectionRemaining - 1, 0)
    }
  },

  reset() {
    this.aiDetectionUsedToday = null
    this.aiDetectionRemaining = null
    this.aiDetectionLimit = null
    this.aiIntentUsedToday = null
    this.aiIntentRemaining = null
    this.aiIntentLimit = null
    this.usageResetAt = null
  },
})
