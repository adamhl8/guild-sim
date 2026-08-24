import { auth, BATTLENET_PROVIDER_ID } from "#lib/auth.ts"
import { prisma } from "#lib/db.ts"
import type { ClaimStatus } from "#lib/roster/claim.ts"
import { claimAndRecord } from "#lib/roster/claim.ts"

/**
 * Re-resolves a raider's characters and reports what happened, which the boolean this replaced could not. Always asks
 * Blizzard: the stored scope looks like it could rule a refusal in advance, but it cannot, and trusting it once pinned
 * a working account to "no permission" permanently.
 *
 * This imports `auth`, so nothing the auth config reaches may import it back: `claim.ts` stays the shared piece.
 */
export const reclaim = async (userId: string): Promise<ClaimStatus> => {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: BATTLENET_PROVIDER_ID },
    select: { id: true },
  })
  if (!account) return "stale"

  const token = await auth.api
    .getAccessToken({ body: { accountId: account.id, userId } })
    .catch((): undefined => undefined)
  if (!token?.accessToken) return "stale"

  return claimAndRecord(userId, token.accessToken)
}
