import { PrismaLibSql } from "@prisma/adapter-libsql"

import { env } from "#env.ts"
import { PrismaClient } from "#generated/prisma/client.ts"

// Cached on globalThis so Astro's dev-server HMR does not open a new connection per reload.
declare global {
  var guildSimPrisma: PrismaClient | undefined
}

export const prisma: PrismaClient =
  globalThis.guildSimPrisma ?? new PrismaClient({ adapter: new PrismaLibSql({ url: env.DATABASE_URL }) })

globalThis.guildSimPrisma = prisma
