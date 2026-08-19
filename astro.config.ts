import node from "@astrojs/node"
import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, fontProviders } from "astro/config"

export default defineConfig({
  // Nearly every route is auth-gated or a form POST, so on-demand is the safe default. A missing
  // opt-out on an auth page would be a security bug; a missing opt-in on a static page is just slower.
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Better Auth owns sessions, so Astro's session runtime is dead weight in the bundle.
  session: false,
  security: {
    // Astro bakes `allowedDomains` into the build manifest and derives checkOrigin from it, which would
    // make the published image host-specific: a form POST behind a different hostname 403s. Origin is
    // checked in middleware against the runtime PUBLIC_SITE_URL instead, so one image serves any host.
    checkOrigin: false,
  },
  // Downloaded and self-hosted at build time, so the running app still makes no third-party request.
  // Weights are enumerated rather than pulling whole families.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "IBM Plex Sans",
      cssVariable: "--font-ibm-plex-sans",
      weights: [400, 500, 600],
      subsets: ["latin"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "IBM Plex Mono",
      cssVariable: "--font-ibm-plex-mono",
      weights: [400, 500],
      subsets: ["latin"],
    },
  ],
  vite: { plugins: [tailwindcss()] },
  integrations: [react()],
})
