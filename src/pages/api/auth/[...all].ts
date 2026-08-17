import type { APIRoute } from "astro"

import { auth } from "#lib/auth.ts"

export const ALL: APIRoute = async (context) => auth.handler(context.request)
