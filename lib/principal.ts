// Which principal the signed-in session carries.
//
// The database decides this: a Supabase access-token hook resolves the caller
// against auth_principal_map and stamps the `role` claim, which PostgREST then
// uses to SET ROLE. Reading it here is only so the UI can show the right thing
// - it is NOT an access control. A buyer who reached an operator screen would
// still be refused by the database, which is where the boundary actually lives.
export type Principal = "administrator" | "buyer" | "unmapped" | "unknown";

export function principalFromAccessToken(token: string | null | undefined): Principal {
  if (!token) return "unknown";
  const payload = token.split(".")[1];
  if (!payload) return "unknown";
  try {
    // base64url -> base64, then decode. atob is available in both the browser
    // and the Next server runtime.
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    if (role === "administrator" || role === "buyer" || role === "unmapped") return role;
    // `authenticated` is what a session carries before the hook is enabled, and
    // it is the operator's historical role.
    if (role === "authenticated") return "administrator";
    return "unknown";
  } catch {
    return "unknown";
  }
}
