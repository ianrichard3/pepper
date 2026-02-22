import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const authContextRef = ref<any>({ admin_access: { allowed: false, source: 'none' } })
const loadAuthContext = vi.fn(() => Promise.resolve({}))

vi.mock('@/App.vue', () => ({
  default: {
    render: () => null,
  },
}))

vi.mock('@/lib/authz', () => ({
  loadAuthContext,
  useAuthz: () => ({
    authContext: authContextRef,
  }),
}))

const { resolveAdminGuard } = await import('@/router')

describe('admin route guard', () => {
  beforeEach(() => {
    authContextRef.value = { admin_access: { allowed: false, source: 'none' } }
    loadAuthContext.mockClear()
    loadAuthContext.mockResolvedValue({})
  })

  it('allows whitelisted admin user', async () => {
    authContextRef.value = { admin_access: { allowed: true, source: 'whitelist' } }

    const result = await resolveAdminGuard(true)

    expect(loadAuthContext).toHaveBeenCalledWith({ force: true })
    expect(result).toBe(true)
  })

  it('redirects non-whitelisted user', async () => {
    authContextRef.value = { admin_access: { allowed: false, source: 'none' } }

    const result = await resolveAdminGuard(true)

    expect(result).toEqual({ name: 'home' })
  })
})
