# Agent DX research site

The research report runs as an independent Astro site with Starlight and a React chart. The AgentDX harness stays at the repository root. The report serves the checked-in aggregate data and frozen guide archive.

Use the Node.js version in `.node-version`. From `site/`, run the following commands.

```sh
npm ci
npm run build
npm run preview
```

The report is available at `/`. The results JSON and the frozen guide archive retain their `/agent-dx/results.json` and `/agent-dx/guide-snapshots.zip` paths.

The report links to the public Moderato.Effects documentation by default. Set `PUBLIC_DOCS_ORIGIN` to the documentation Preview origin when reviewing changes before the guides are published.

## Cloudflare Workers

The [publish workflow](../.github/workflows/publish-research-site.yml) builds, tests, and deploys changes to `site/` pushed to `docs/agent-dx-site`. The `moderato-effects-agent-dx` Worker serves `dist/` as static assets on `workers.dev`.

Set the `CLOUDFLARE_API_TOKEN` repository secret to a token with Workers Scripts write access for the target Cloudflare account. The workflow links to the public documentation. Set the `PUBLIC_DOCS_ORIGIN` repository variable to override the links.

Validate packaging locally with `npx wrangler deploy --dry-run` after the build.
