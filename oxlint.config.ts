import { oxlintConfig } from "@adamhl8/configs"
import { defineConfig } from "oxlint"

const config = oxlintConfig({
  ignorePatterns: ["src/generated"],
  // Turn off `unicorn/no-null` because Prisma's model types and the web APIs both use `null`.
  rules: { "unicorn/no-null": "off" },
  overrides: [
    {
      // Keep this global `declare module` a script, because an export would make it augment a module that doesn't exist.
      // oxlint reports `import/unambiguous` at the top of the file, where no disable comment reaches it.
      files: ["src/astro-entry.d.ts"],
      rules: { "import/unambiguous": "off" },
    },
    {
      // Allow markup-only components and a frontmatter `return Astro.redirect(...)`, which are both idiomatic Astro.
      files: ["**/*.astro"],
      rules: { "import/unambiguous": "off", "unicorn/prefer-module": "off" },
    },
    {
      // Run these loops sequentially on purpose: they poll, back off between retries, or order SQLite writes.
      files: ["src/lib/http.ts", "src/lib/raidbots/job.ts", "src/lib/sync.ts", "src/worker/queue.ts"],
      rules: { "no-await-in-loop": "off" },
    },
  ],
})

export default defineConfig(config)
