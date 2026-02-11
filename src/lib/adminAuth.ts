export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'org:admin' || role === 'superadmin'
}
