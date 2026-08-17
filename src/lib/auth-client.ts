import { createAuthClient } from "better-auth/client"

// Vanilla rather than the React client: every page already has the session from Astro.locals, so the
// only client-side needs are the sign-in and sign-out calls.
export const authClient = createAuthClient()
