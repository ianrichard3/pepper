<script setup lang="ts">
import { computed, watchEffect, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SignedIn, SignedOut, UserButton, OrganizationSwitcher, useAuth, useClerk } from '@clerk/vue'
import { registerTokenGetter } from './lib/authToken'
import { useAuthz } from './lib/authz'
import { useEntitlements } from './lib/useEntitlements'
import { quotaStore } from './stores/quota'
import PatchBayGrid from './components/PatchBayGrid.vue'
import DevicesManager from './components/DevicesManager.vue'
import ConnectionFinder from './components/ConnectionFinder.vue'
import AuthScreen from './components/AuthScreen.vue'
import AuthDiagnosticsPanel from './components/AuthDiagnosticsPanel.vue'
import AccessDisabledScreen from './components/AccessDisabledScreen.vue'
import AdminAccessPanel from './components/admin/AdminAccessPanel.vue'
import DataPortability from './components/settings/DataPortability.vue'
import ToastHost from './ui/ToastHost.vue'
import { strings } from './ui/strings'
import { store } from './store'
import logoUrl from './assets/el-riche-mark.svg'
import { isAdminRole } from './lib/adminAuth'

const t = strings
const route = useRoute()
const router = useRouter()
const { isLoaded, isSignedIn, getToken, orgId } = useAuth()
const clerk = useClerk()
const {
  authContext,
  authContextLoaded,
  authContextLoading,
  authContextError,
  role,
  loadAuthContext,
  resetAuthContext,
} = useAuthz()
const { hasAppAccess, canExport } = useEntitlements()
const isDev = import.meta.env.DEV
const showAuthDiagnostics = isDev && new URLSearchParams(window.location.search).has('authdiag')

// orgLoaded se considera true cuando el usuario no está autenticado
// o cuando Clerk está completamente cargado
const orgLoaded = computed(() => {
  return !isSignedIn.value || isLoaded.value
})

const needsOrganization = computed(() => {
  return isSignedIn.value && (!orgId.value || store.orgRequired)
})

// Registrar la función getToken para que api.ts pueda usarla
watchEffect(() => {
  if (isLoaded.value && isSignedIn.value && getToken) {
    // getToken es un ComputedRef, necesitamos extraer su función
    const tokenFn = getToken.value
    if (tokenFn) {
      registerTokenGetter(tokenFn)
    }
  }
})

// Resetear el store cuando el usuario se desloguea o cambia de org
watch([isSignedIn, orgId], ([newSignedIn, newOrgId], [oldSignedIn, oldOrgId]) => {
  // Si el usuario se deslogueó, resetear todo
  if (oldSignedIn && !newSignedIn) {
    console.log('[App] User signed out, resetting store')
    store.resetState()
    resetAuthContext()
    quotaStore.reset()
  }
  
  // Si cambió la org, resetear para cargar datos de la nueva org
  if (newSignedIn && oldOrgId && newOrgId && oldOrgId !== newOrgId) {
    console.log('[App] Organization changed, resetting store')
    store.resetState()
    resetAuthContext()
    quotaStore.reset()
  }

  if (newSignedIn && newOrgId && (!oldSignedIn || oldOrgId !== newOrgId)) {
    void loadAuthContext({ force: true }).catch(() => {})
  }
})

// Cargar datos cuando el usuario esté autenticado, tenga org activa y Clerk esté listo
watchEffect(() => {
  if (!isLoaded.value || !orgLoaded.value) return
  
  const userSignedIn = isSignedIn.value
  const hasOrg = !!orgId.value
  
  if (userSignedIn && hasOrg) {
    // Usuario autenticado con org activa
    // Solo cargar si no se han cargado datos aún y no hay error de auth
    const authReady =
      authContextLoaded.value ||
      authContextError.value === 'AUTH_CONTEXT_UNSUPPORTED' ||
      Boolean(authContextError.value)
    if (authReady && hasAppAccess.value && !store.hasLoadedInitialData && !store.loading && !store.authError) {
      console.log('[App] Loading initial data...')
      store.loadData()
    }
    void loadAuthContext().catch(() => {})
  } else if (userSignedIn && !hasOrg) {
    // Usuario autenticado pero sin org activa (la UI lo maneja)
  }
})

watch(() => authContext.value, (context) => {
  quotaStore.updateFromAuthContext(context)
}, { immediate: true })

// Desloguear al usuario cuando hay error AUTH_EXPIRED
watchEffect(() => {
  if (store.authError && store.error?.includes('expirada')) {
    console.log('[App] Auth expired, signing out user...')
    // Dar tiempo para que el usuario vea el mensaje de error
    setTimeout(() => {
      clerk.value?.signOut()
    }, 2000)
  }
})

const statusLabel = computed(() => {
  if (store.loading) return t.app.syncing
  if (store.error) return t.app.syncIssue
  return t.app.synced
})

const showAuthContextBanner = computed(() => {
  return authContextError.value && authContextError.value !== 'AUTH_CONTEXT_UNSUPPORTED'
})

const notifyComingSoon = () => {
  store.pushToast({ type: 'info', message: t.app.comingSoon })
}

const isAdminRoute = computed(() => route.path === '/admin/access')
const isPortabilityRoute = computed(() => route.path === '/settings/portability')
const canAccessAdmin = computed(() => isAdminRole(role.value))

const goToTab = (tab: 'patchbay' | 'devices' | 'connections') => {
  store.setTab(tab)
  if (route.path !== '/') {
    void router.push('/')
  }
}

const goToAdmin = () => {
  if (!canAccessAdmin.value) return
  void router.push('/admin/access')
}

const goToPortability = () => {
  void router.push('/settings/portability')
}
</script>

<template>
  <!-- Loading state while Clerk initializes -->
  <div v-if="!isLoaded || !orgLoaded" class="auth-loading">
    <div class="loading-card">Cargando...</div>
  </div>

  <!-- Signed out: show login screen -->
  <SignedOut>
    <AuthScreen />
  </SignedOut>

  <!-- Signed in: show app or org selector -->
  <SignedIn>
    <!-- Organization Required Screen -->
    <div v-if="needsOrganization" class="org-required-screen">
      <div class="org-required-container">
        <div class="org-required-header">
          <img class="org-logo" :src="logoUrl" alt="" />
          <h1 class="org-title">Workspace Requerido</h1>
          <p class="org-subtitle">
            Para continuar, necesitás seleccionar o crear un workspace (organización)
          </p>
        </div>
        
        <div class="org-switcher-wrapper">
          <OrganizationSwitcher 
            :appearance="{
              elements: {
                rootBox: 'org-switcher-root',
                organizationSwitcherTrigger: 'org-switcher-trigger'
              }
            }"
          />
        </div>

        <div class="org-help">
          <p class="help-text">
            💡 <strong>¿Qué es un workspace?</strong><br>
            Un workspace es tu espacio de trabajo donde se guardan todos tus dispositivos,
            conexiones y configuración del patchbay. Podés tener múltiples workspaces
            y cambiar entre ellos cuando quieras.
          </p>
        </div>
      </div>
    </div>

    <!-- Main App (only when org is active) -->
    <div v-else class="app-container">
      <div v-if="showAuthContextBanner" class="auth-context-banner">
        <strong>{{ t.app.syncIssue }}</strong>
        <span>{{ authContextError }}</span>
      </div>
      <div v-if="store.backendAuthDegraded" class="auth-degraded-banner">
        <div class="auth-degraded-text">
          <strong>{{ t.app.authDegradedTitle }}</strong>
          <span>{{ t.app.authDegradedMessage }}</span>
        </div>
        <button class="ghost-btn" @click="store.retryInitialLoad()">{{ t.app.retry }}</button>
      </div>
      <div v-if="authContextLoading" class="loading-overlay">
        <div class="loading-card">Loading access...</div>
      </div>
      <AccessDisabledScreen v-else-if="!hasAppAccess && !isAdminRoute && !isPortabilityRoute" />
      <div v-else class="app-shell">
        <div v-if="store.loading" class="loading-overlay">
          <div class="loading-card">{{ t.app.loadingData }}</div>
        </div>

        <header class="topbar">
          <div class="brand">
            <img class="brand-mark" :src="logoUrl" alt="" />
            <div class="brand-text">
              <span class="brand-title">{{ t.app.name }}</span>
              <span class="brand-subtitle">{{ t.app.tagline }}</span>
            </div>
          </div>

          <div class="topbar-center">
            <div class="status-chip" :class="{ loading: store.loading, error: store.error }">
              <span class="status-dot"></span>
              <span class="status-text">{{ statusLabel }}</span>
            </div>
            <div class="topbar-actions">
              <button
                class="ghost-btn"
                :disabled="!canExport"
                :title="!canExport ? t.app.exportDisabled : ''"
                @click="goToPortability"
              >
                {{ t.app.export }}
              </button>
              <button class="ghost-btn" @click="notifyComingSoon">{{ t.app.help }}</button>
              <button class="ghost-btn" @click="notifyComingSoon">{{ t.app.shortcuts }}</button>
            </div>
          </div>

          <div class="topbar-right">
            <nav class="main-nav">
              <button
                :class="{ active: !isAdminRoute && !isPortabilityRoute && store.activeTab === 'patchbay' }"
                @click="goToTab('patchbay')"
              >
                {{ t.nav.patchbay }}
              </button>
              <button
                :class="{ active: !isAdminRoute && !isPortabilityRoute && store.activeTab === 'devices' }"
                @click="goToTab('devices')"
              >
                {{ t.nav.devices }}
              </button>
              <button
                :class="{ active: !isAdminRoute && !isPortabilityRoute && store.activeTab === 'connections' }"
                @click="goToTab('connections')"
              >
                {{ t.nav.connections }}
              </button>
              <button :class="{ active: isPortabilityRoute }" @click="goToPortability">
                {{ t.nav.portability }}
              </button>
              <button
                v-if="canAccessAdmin"
                :class="{ active: isAdminRoute }"
                @click="goToAdmin"
              >
                Admin
              </button>
            </nav>
            <div class="user-menu">
              <UserButton />
            </div>
          </div>
        </header>

        <main class="content-area">
          <template v-if="isAdminRoute">
            <div v-if="canAccessAdmin" class="admin-content">
              <AdminAccessPanel />
            </div>
            <div v-else class="not-authorized">
              <h2>Not authorized</h2>
              <p>You must be an organization admin to access this section.</p>
            </div>
          </template>
          <template v-else-if="isPortabilityRoute">
            <DataPortability />
          </template>
          <template v-else>
            <PatchBayGrid v-if="store.activeTab === 'patchbay'" />
            <DevicesManager v-if="store.activeTab === 'devices'" />
            <ConnectionFinder v-if="store.activeTab === 'connections'" />
          </template>
        </main>

        <AuthDiagnosticsPanel v-if="showAuthDiagnostics" />

        <ToastHost />
      </div>
    </div>
  </SignedIn>
</template>

<style scoped>
.auth-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1e 100%);
}

/* Organization Required Screen */
.org-required-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1e 100%);
  padding: var(--space-4);
}

.org-required-container {
  width: 100%;
  max-width: 520px;
  text-align: center;
}

.org-required-header {
  margin-bottom: var(--space-6);
}

.org-logo {
  width: 80px;
  height: 80px;
  margin-bottom: var(--space-4);
  filter: drop-shadow(0 4px 12px rgba(212, 154, 79, 0.3));
}

.org-title {
  font-size: 2rem;
  font-weight: 700;
  color: var(--accent, #d49a4f);
  margin: 0 0 var(--space-3) 0;
}

.org-subtitle {
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.8);
  margin: 0;
  line-height: 1.6;
}

.org-switcher-wrapper {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: var(--space-6);
  backdrop-filter: blur(10px);
  margin-bottom: var(--space-5);
  display: flex;
  justify-content: center;
}

.org-help {
  background: rgba(212, 154, 79, 0.1);
  border: 1px solid rgba(212, 154, 79, 0.3);
  border-radius: 8px;
  padding: var(--space-4);
}

.help-text {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  line-height: 1.6;
  text-align: left;
}

/* Main App */
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  animation: fade-in 0.6s ease-out;
}

.app-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.auth-context-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: rgba(212, 154, 79, 0.12);
  border-bottom: 1px solid rgba(212, 154, 79, 0.35);
  color: var(--text-primary);
  font-size: 0.9rem;
}

.auth-degraded-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  background: rgba(176, 75, 61, 0.15);
  border-bottom: 1px solid rgba(176, 75, 61, 0.4);
  color: var(--text-primary);
}

.auth-degraded-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.95rem;
}

.topbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) var(--space-5);
  background: rgba(26, 23, 19, 0.94);
  border-bottom: 1px solid var(--border-default);
  backdrop-filter: blur(14px);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.user-menu {
  display: flex;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.brand-mark {
  width: 44px;
  height: 44px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-title {
  font-family: var(--font-display);
  font-size: 1.4rem;
  letter-spacing: 0.04em;
}

.brand-subtitle {
  font-size: 0.85rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.topbar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 12px;
  border-radius: var(--radius-round);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  background: var(--surface-1);
}

.status-chip.loading {
  border-color: rgba(212, 154, 79, 0.6);
  color: var(--warning);
}

.status-chip.error {
  border-color: rgba(176, 75, 61, 0.7);
  color: var(--danger);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-2);
}

.status-chip.loading .status-dot {
  background: var(--warning);
}

.status-chip.error .status-dot {
  background: var(--danger);
}

.topbar-actions {
  display: flex;
  gap: var(--space-2);
}

.ghost-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-weight: 600;
  transition: border-color 0.2s ease, color 0.2s ease;
}

.ghost-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  border-color: var(--border-subtle);
  color: var(--text-tertiary);
}

.main-nav {
  display: flex;
  gap: var(--space-2);
  background: var(--surface-2);
  padding: var(--space-1);
  border-radius: var(--radius-round);
  border: 1px solid var(--border-default);
}

.main-nav button {
  background-color: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 8px 16px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 600;
  border-radius: var(--radius-round);
  transition: all 0.2s;
}

.main-nav button:hover {
  color: var(--text-primary);
  background-color: var(--surface-3);
}

.main-nav button.active {
  color: #11130f;
  background-color: var(--accent);
}

.content-area {
  flex: 1;
  overflow: hidden;
  position: relative;
  padding: var(--space-5);
}

.admin-content {
  height: 100%;
  overflow: auto;
}

.not-authorized {
  display: grid;
  gap: var(--space-2);
  align-content: start;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(8, 7, 6, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.loading-card {
  background: var(--surface-2);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  box-shadow: var(--shadow-1);
}

@media (max-width: 960px) {
  .topbar {
    grid-template-columns: 1fr;
    justify-items: stretch;
  }

  .topbar-center {
    justify-content: space-between;
  }

  .topbar-right {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
  }

  .main-nav {
    justify-content: space-between;
  }

  .user-menu {
    justify-content: center;
  }
}
</style>
