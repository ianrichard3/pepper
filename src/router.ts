import { createRouter, createWebHistory } from 'vue-router'
import App from '@/App.vue'
import { loadAuthContext, useAuthz } from '@/lib/authz'
import { canAccessAdminPanel } from '@/lib/adminAuth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: App,
      name: 'home',
    },
    {
      path: '/admin/access',
      component: App,
      name: 'admin-access',
      meta: {
        requiresAdmin: true,
      },
    },
    {
      path: '/settings/portability',
      component: App,
      name: 'settings-portability',
    },
  ],
})

export async function resolveAdminGuard(requiresAdmin: boolean) {
  if (!requiresAdmin) return true
  try {
    await loadAuthContext({ force: true })
  } catch {
    return { name: 'home' }
  }

  const { authContext } = useAuthz()
  if (canAccessAdminPanel(authContext.value)) return true

  return { name: 'home' }
}

router.beforeEach(async (to) => {
  return resolveAdminGuard(Boolean(to.meta.requiresAdmin))
})

export default router
export { canAccessAdminPanel }
