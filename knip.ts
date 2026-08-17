import { knipConfig } from "@adamhl8/configs"

const config = knipConfig({
  // locals.ts is an ambient type augmentation: nothing imports it, but dropping it breaks Astro.locals.
  entry: ["src/server.ts", "src/lib/locals.ts", "src/pages/**/*.{astro,ts}"],
  project: ["!./src/generated/**/*"],
  // The node adapter's built entry, which does not exist until after `astro build`.
  ignoreUnresolved: ["#astro-entry"],
})

export default config
