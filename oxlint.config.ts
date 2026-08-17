import { oxlintConfig } from "@adamhl8/configs"
import { defineConfig } from "oxlint"

const config = oxlintConfig({
  ignorePatterns: ["src/generated"],
  // the Prisma model types are nullable, so we can't avoid null
  rules: { "unicorn/no-null": "off" },
  overrides: [
    {
      files: ["**/*.astro"],
      rules: { "import/unambiguous": "off", "unicorn/prefer-module": "off" },
    },
    {
      files: ["src/lib/http.ts", "src/worker/**/*.ts", "src/lib/raidbots/job.ts", "src/lib/sync.ts"],
      rules: { "no-await-in-loop": "off" },
    },
  ],
})

export default defineConfig(config)
