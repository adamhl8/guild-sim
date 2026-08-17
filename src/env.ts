import { parseEnv, requireWhen } from "@adamhl8/configs/env"
import { type } from "arkenv"

const BaseEnv = type({
  // `test` is included because `bun test` sets it, and env is imported transitively by most modules.
  NODE_ENV: "('production' | 'development' | 'test') = 'development'",
  /**
   * Set by `just build-site`. `astro build` runs with NODE_ENV=production, so without this a build would demand runtime
   * credentials it has no use for.
   */
  ASTRO_BUILD: "boolean = false",
})
const baseEnv = parseEnv(BaseEnv)

const isProd = baseEnv.NODE_ENV === "production"
/** Production, and actually serving rather than building. */
const isRuntime = isProd && !baseEnv.ASTRO_BUILD

export const env = parseEnv(
  type({
    // Relative to WORKDIR, so `db/` is the mounted volume in the container.
    DATABASE_URL: type("string").default(isProd ? "file:db/prod.db" : "file:./dev.db"),
    /** The public origin. Better Auth builds absolute URLs from it, and it is the CSRF origin allowlist. */
    PUBLIC_SITE_URL: requireWhen(isRuntime, "string > 0", "http://localhost:4321"),
    /** `version:secret` pairs, newest first. Versioned so rotating cannot orphan encrypted tokens. */
    BETTER_AUTH_SECRETS: requireWhen(isRuntime, "string > 0", "1:dev-secret-not-for-production-use-000000"),
    BNET_CLIENT_ID: requireWhen(isRuntime, "string > 0", ""),
    BNET_CLIENT_SECRET: requireWhen(isRuntime, "string > 0", ""),
    WOWAUDIT_API_KEY: requireWhen(isRuntime, "string > 0", ""),
    RAIDBOTS_EMAIL: requireWhen(isRuntime, "string > 0", ""),
    // Escape any `$` as `\$`: Bun's dotenv interpolates it even inside quotes.
    RAIDBOTS_PASSWORD: requireWhen(isRuntime, "string > 0", ""),
    /**
     * Comma-separated proxy IPs or CIDRs in front of the app, e.g. "10.8.8.0/24". Without this Better Auth only trusts
     * a single-hop X-Forwarded-For, and rate limiting falls back to one shared bucket.
     */
    TRUSTED_PROXIES: "string = ''",
    // Read by the node adapter from process.env, not by this app. Declared so a typo like PORT=abc
    // fails at boot instead of resolving to NaN inside the adapter.
    PORT: "number = 4321",
  }).merge(BaseEnv),
)

export const isProduction = isProd
