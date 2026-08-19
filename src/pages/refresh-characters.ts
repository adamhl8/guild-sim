import type { APIRoute } from "astro"
import { isErr } from "ts-explicit-errors"

import { auth, BATTLENET_PROVIDER_ID } from "#lib/auth.ts"
import { prisma } from "#lib/db.ts"
import { claimCharacters } from "#lib/roster/claim.ts"

/**
 * Whether Battle.net answered. Blizzard issues no refresh token and its access tokens last a day, so most stored tokens
 * are dead and re-claiming in place would silently do nothing. Hence the round trip through the provider: the callback
 * mints a fresh token before this runs.
 */
const reclaim = async (userId: string): Promise<boolean> => {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: BATTLENET_PROVIDER_ID },
    select: { id: true },
  })
  if (!account) return false

  const token = await auth.api
    .getAccessToken({ body: { accountId: account.id, userId } })
    .catch((): undefined => undefined)
  if (!token?.accessToken) return false

  const claimed = await claimCharacters(userId, token.accessToken)
  if (isErr(claimed)) {
    console.error(`refresh claim failed -> ${claimed.messageChain}`)
    return false
  }

  return true
}

const statusFor = (reached: boolean, claims: number): string => {
  if (!reached) return "bnet"
  return claims > 0 ? "ok" : "empty"
}

/** Starts the round trip. The sign-in hook claims on the way back, and the GET below reports what happened. */
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
  if (!response.url) return context.redirect("/no-roster?refresh=bnet", 303)

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

  const reached = !context.url.searchParams.has("failed") && (await reclaim(userId))
  const claims = await prisma.characterClaim.count({ where: { userId } })

  return context.redirect(`${claims > 0 ? "/submit" : "/no-roster"}?refresh=${statusFor(reached, claims)}`)
}
