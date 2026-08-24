import type { APIRoute } from "astro"

import { auth, BATTLENET_PROVIDER_ID } from "#lib/auth.ts"
import { prisma } from "#lib/db.ts"
import { reclaim } from "#lib/roster/reclaim.ts"

/**
 * Starts the round trip. Blizzard issues no refresh token and its access tokens last a day, so most stored tokens are
 * dead and re-claiming in place would silently do nothing: the callback mints a fresh one before the GET below runs.
 */
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) return context.redirect("/", 303)

  const { headers, response } = await auth.api.signInSocial({
    body: {
      provider: BATTLENET_PROVIDER_ID,
      callbackURL: "/refresh-characters",
      errorCallbackURL: "/refresh-characters?failed=1",
    },
    headers: context.request.headers,
    returnHeaders: true,
  })
  if (!response.url) return context.redirect("/no-roster?refresh=unreachable", 303)

  // The OAuth state rides in a cookie under either storeStateStrategy, and the callback rejects the round
  // trip without it.
  const redirect = new Headers({ location: response.url })
  for (const cookie of headers.getSetCookie()) redirect.append("set-cookie", cookie)

  return new Response(null, { status: 303, headers: redirect })
}

/**
 * Where the provider sends them back. The claim runs again here rather than trusting the sign-in hook's copy, because
 * only a return value can tell the raider that Battle.net was the problem rather than their roster.
 */
export const GET: APIRoute = async (context) => {
  const userId = context.locals.user?.id
  if (!userId) return context.redirect("/")

  const status = context.url.searchParams.has("failed") ? "unreachable" : await reclaim(userId)
  // Targeted on the claims rather than the status so a raider who already had characters is not bounced to
  // /no-roster by a transient failure.
  const claims = await prisma.characterClaim.count({ where: { userId } })

  return context.redirect(`${claims > 0 ? "/submit" : "/no-roster"}?refresh=${status}`)
}
