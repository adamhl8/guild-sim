import { prismaAdapter } from "better-auth/adapters/prisma"
import { createAuthMiddleware } from "better-auth/api"
import { betterAuth } from "better-auth/minimal"
import { genericOAuth } from "better-auth/plugins"

import { env, isProduction } from "#env.ts"
import { prisma } from "#lib/db.ts"
import { claimCharacters } from "#lib/roster/claim.ts"

const BATTLENET_PROVIDER_ID = "battlenet"

/** `version:secret` pairs, newest first. Versioned so rotating a secret cannot orphan encrypted tokens. */
const parseSecrets = (raw: string): { version: number; value: string }[] =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [version, ...rest] = entry.split(":")
      return { version: Number(version), value: rest.join(":") }
    })
    .filter((secret) => Number.isInteger(secret.version) && secret.value.length > 0)

const trustedProxies = env.TRUSTED_PROXIES.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  baseURL: env.PUBLIC_SITE_URL,
  secrets: parseSecrets(env.BETTER_AUTH_SECRETS),
  trustedOrigins: [env.PUBLIC_SITE_URL],
  account: {
    // The Blizzard token is stored at rest; encrypt it.
    encryptOAuthTokens: true,
    // Single provider, so linking can only ever be a foot-gun.
    accountLinking: { enabled: false },
  },
  advanced: {
    useSecureCookies: isProduction,
    // 1.7 stopped trusting forwarded headers by default. Required behind Caddy.
    trustedProxyHeaders: true,
    ipAddress: trustedProxies.length > 0 ? { trustedProxies } : {},
  },
  // These are real HTTP routes: without this the browser could POST for the raw Blizzard token.
  // In-process `auth.api.getAccessToken` still works.
  disabledPaths: ["/get-access-token", "/refresh-token", "/account-info"],
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: BATTLENET_PROVIDER_ID,
          clientId: env.BNET_CLIENT_ID,
          clientSecret: env.BNET_CLIENT_SECRET,
          // Explicit rather than `discoveryUrl`, which would refetch the discovery document on every
          // authorize and token call.
          authorizationUrl: "https://oauth.battle.net/authorize",
          tokenUrl: "https://oauth.battle.net/token",
          userInfoUrl: "https://oauth.battle.net/userinfo",
          scopes: ["openid", "wow.profile"],
          // Battle.net's userinfo is only { sub, id, battletag }. Better Auth rejects a profile with no
          // email or name, so both are synthesized from the account id. `.invalid` is reserved by
          // RFC 2606: these are identifiers, never contact addresses, and nothing may email them.
          mapProfileToUser: (profile) => {
            const battletag = typeof profile["battletag"] === "string" ? profile["battletag"] : undefined
            const accountId = String(profile.id ?? profile.sub ?? "")
            return {
              name: battletag ?? accountId,
              email: `${accountId}@battlenet.invalid`,
              emailVerified: false,
            }
          },
        },
      ],
    }),
  ],
  hooks: {
    // Runs on every sign-in, unlike `databaseHooks.user.create.after` which fires inside
    // createOAuthUser (before the session exists, and only once). Re-resolving each login means a
    // roster change is picked up without the raider doing anything.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/callback/:id") return
      const session = ctx.context.newSession
      if (!session) return

      // 1.7 keys getAccessToken on the account row id rather than the provider, and the stored token is
      // encrypted, so it has to come back through this call rather than straight off the row.
      const account = await prisma.account.findFirst({
        where: { userId: session.user.id, providerId: BATTLENET_PROVIDER_ID },
        select: { id: true },
      })
      if (!account) return

      const token = await auth.api
        .getAccessToken({ body: { accountId: account.id, userId: session.user.id } })
        .catch((): undefined => undefined)
      if (!token?.accessToken) return

      await ctx.context.runInBackgroundOrAwait(claimCharacters(session.user.id, token.accessToken))
    }),
  },
})
