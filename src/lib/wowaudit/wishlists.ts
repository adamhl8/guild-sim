import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { serverMessage } from "#lib/http.ts"
import type { WowauditClient } from "#lib/wowaudit/client.ts"

export interface WishlistUpload {
  reportId: string
  configurationName: string
  characterId: number
  characterName: string
  replaceManualEdits: boolean
}

/** Wowaudit fetches the report from Raidbots itself, so only the bare report id is sent. */
export const uploadWishlist = async (client: WowauditClient, upload: WishlistUpload): Promise<Result> => {
  const response = await client.post<{ created?: boolean }>("/wishlists", {
    report_id: upload.reportId,
    configuration_name: upload.configurationName,
    character_id: upload.characterId,
    character_name: upload.characterName,
    replace_manual_edits: upload.replaceManualEdits,
  })
  if (isErr(response)) {
    return err(
      `wowaudit rejected report ${upload.reportId} for ${upload.characterName}${serverMessage(response)}`,
      response,
    )
  }

  if (response.created !== true)
    return err(`wowaudit rejected report ${upload.reportId} for ${upload.characterName}`, undefined).ctx({ response })

  return undefined
}
