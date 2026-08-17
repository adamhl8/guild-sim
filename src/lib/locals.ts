import type { Session, User } from "better-auth"

import type { RosterCharacter } from "#generated/prisma/client.ts"

/** The shape middleware puts on `Astro.locals`, exported so consumers do not depend on a global merge. */
export interface AppLocals {
  user: User | null
  session: Session | null
  /** Roster characters this account owns, resolved from Battle.net at login. */
  characters: RosterCharacter[]
  /** Derived from the roster rank, so promoting someone in-game is enough to grant access. */
  isAdmin: boolean
}

declare global {
  // oxlint-disable-next-line typescript/no-namespace -- Astro declares App as a global namespace
  namespace App {
    // oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- merging into Astro's Locals is the whole point
    interface Locals extends AppLocals {}
  }
}
