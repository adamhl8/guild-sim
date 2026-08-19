import { defineMiddleware } from "astro:middleware"

import { env } from "#env.ts"
import { auth } from "#lib/auth.ts"
import { prisma } from "#lib/db.ts"
import { getSettings } from "#lib/settings.ts"

// /sign-out and /refresh-characters are listed because the roster gate below would otherwise bounce a
// signed-in account with no characters to /no-roster, the one page that offers both of them.
const PUBLIC_PATHS = new Set(["/", "/no-roster", "/sign-out", "/refresh-characters"])

/**
 * Logged once per process. Better Auth resolves a client IP only from a single-hop `X-Forwarded-For`, or from a longer
 * chain when every proxy hop is listed in TRUSTED_PROXIES. When it cannot, it warns and rate limits everyone into one
 * bucket. This prints what actually arrived so the fix is not a guess.
 */
let loggedForwarded = false
const UNSAFE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"])
const SITE_ORIGIN = new URL(env.PUBLIC_SITE_URL).origin

const isPublic = (pathname: string): boolean =>
  PUBLIC_PATHS.has(pathname) || pathname.startsWith("/api/auth/") || pathname.startsWith("/_")

const logForwardedOnce = (request: Request, pathname: string): void => {
  if (loggedForwarded) return
  loggedForwarded = true

  const forwardedFor = request.headers.get("x-forwarded-for")
  const hops = forwardedFor?.split(",").length ?? 0
  console.info(
    `first request: x-forwarded-for=${forwardedFor ?? "(absent)"} hops=${String(hops)} ` +
      `proto=${request.headers.get("x-forwarded-proto") ?? "(absent)"} path=${pathname}`,
  )
}

export const onRequest = defineMiddleware(async (context, next) => {
  logForwardedOnce(context.request, context.url.pathname)

  // Astro's own checkOrigin is disabled because it is baked at build time; this is the runtime
  // equivalent. A same-origin form always sends Origin, so a mismatch is a cross-site post.
  if (UNSAFE_METHODS.has(context.request.method)) {
    const origin = context.request.headers.get("origin")
    if (origin !== null && origin !== SITE_ORIGIN) return new Response("Forbidden", { status: 403 })
  }

  const session = await auth.api.getSession({ headers: context.request.headers })

  context.locals.user = session?.user ?? null
  context.locals.session = session?.session ?? null
  context.locals.characters = []
  context.locals.isAdmin = false

  if (session?.user) {
    const claims = await prisma.characterClaim.findMany({
      where: { userId: session.user.id },
      include: { character: true },
      orderBy: { character: { name: "asc" } },
    })
    context.locals.characters = claims.map((claim) => claim.character)

    // Admin is derived from the roster rather than stored, so the guild's own ranks stay the single
    // source of truth and promoting someone in-game is enough.
    const { adminRanks } = await getSettings()
    const allowed = new Set(adminRanks.map((rank) => rank.toLowerCase()))
    context.locals.isAdmin = context.locals.characters.some((character) => allowed.has(character.rank.toLowerCase()))
  }

  const { pathname } = context.url
  if (isPublic(pathname)) return next()

  if (!session?.user) return context.redirect("/")
  // Signed in but owning nothing on the roster: they authenticated fine, they are just not a raider.
  if (context.locals.characters.length === 0 && pathname !== "/no-roster") return context.redirect("/no-roster")
  if (pathname.startsWith("/admin") && !context.locals.isAdmin) return context.redirect("/submit")

  return next()
})
