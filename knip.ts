import { knipConfig } from "@adamhl8/configs"
import bun from "bun"

// `#astro-entry` is the node adapter's built entry, which only exists after `astro build`.
// Ignore it only when it's missing, because knip hints that the ignore is redundant once it exists.
const astroEntryBuilt = await bun.file("dist/server/entry.mjs").exists()

const config = knipConfig({
  // `locals.ts` is an ambient type augmentation: nothing imports it, but dropping it breaks `Astro.locals`.
  entry: ["src/server.ts", "src/lib/locals.ts"],
  ignore: ["src/generated/**"],
  ignoreUnresolved: astroEntryBuilt ? [] : ["#astro-entry"],
})

export default config
