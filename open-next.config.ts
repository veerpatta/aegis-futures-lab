import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'

// Serve the pages prerendered at build time (○ in `next build`) from Workers
// static assets, as Vercel does. Without a cache they are re-rendered on each
// request, and /diagnostics then reads docs/research/*.json from a disk the
// Worker does not have, showing "No measurement has been run yet".
// Read-only: /guide's daily revalidate becomes "refreshed on each deploy".
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
})
