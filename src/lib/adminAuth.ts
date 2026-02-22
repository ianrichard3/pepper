export function canAccessAdminPanel(authContext: { admin_access?: { allowed?: boolean | null } | null } | null | undefined): boolean {
  return authContext?.admin_access?.allowed === true
}
