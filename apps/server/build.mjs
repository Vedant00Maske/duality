// Bundle the server (and the shared package) into a single ESM file.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  sourcemap: true,
  packages: 'external',
  // The shared workspace package is TypeScript source; bundle it in.
  external: [],
  plugins: [{
    name: 'bundle-shared',
    setup(b) {
      b.onResolve({ filter: /^@duality\/shared$/ }, () => ({ path: new URL('../../packages/shared/src/index.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') }));
    },
  }],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log('server bundled → apps/server/dist/index.js');
