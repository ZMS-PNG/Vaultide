import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

export const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['mathml2omml', 'pptxgenjs', '@openmaic/importer'],
  // These agent packages do a runtime `import(specifier)` with a computed
  // specifier (to lazily load node:fs/os/path without breaking browser/Vite
  // builds). webpack can't statically analyze that and bundling it throws
  // "Cannot find module as expression is too dynamic" at runtime on the server
  // (the "Edit with AI" Pro-mode path), which broke the #619 keep-alive e2e.
  // Mark them server-external so Next loads them natively and the dynamic
  // import resolves as a real Node call.
  serverExternalPackages: ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core'],
  // Prompt templates are read with fs at runtime. Their paths are built from the
  // selected prompt id, so output tracing cannot discover them statically.
  // The durable workflow runs under `/.well-known/workflow/*`, not `/api/*`.
  // Use Next's global route glob so both the consolidated API function and the
  // workflow step function receive the same reviewed prompt assets.
  outputFileTracingIncludes: {
    '/*': [
      './lib/prompts/templates/**/*',
      './lib/prompts/snippets/**/*',
      // Official @openmaic/generation templates are read via fs at runtime.
      './packages/@openmaic/generation/templates/**/*',
      './packages/@openmaic/generation/snippets/**/*',
      './packages/@openmaic/generation/prompts-pbl/**/*',
    ],
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async headers() {
    const extraAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim();
    const frameAncestors = extraAncestors ? `'self' ${extraAncestors}` : "'self'";

    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors}`,
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default withWorkflow(nextConfig);
