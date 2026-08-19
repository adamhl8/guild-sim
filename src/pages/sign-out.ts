import type { APIRoute } from "astro"

import { auth } from "#lib/auth.ts"

/**
 * Better Auth's `/api/auth/sign-out` only accepts `application/json`, which an HTML form cannot send, and answers with
 * JSON rather than a redirect. Calling it in-process keeps the plain form working and the raider never sees it.
 */
export const POST: APIRoute = async (context) => {
  const { headers } = await auth.api.signOut({ headers: context.request.headers, returnHeaders: true })

  // Sign-out expires several cookies at once, and `.get` would join them into one value that the
  // `Expires=Thu, 01 Jan 1970` commas make unparseable.
  const redirect = new Headers({ location: "/" })
  for (const cookie of headers.getSetCookie()) redirect.append("set-cookie", cookie)

  // 303 so the browser reissues as a GET and a refresh cannot re-post.
  return new Response(null, { status: 303, headers: redirect })
}
