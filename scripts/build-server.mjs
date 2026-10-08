import { build } from "esbuild";

// Bundles the Hono API for production. Kept as a script instead of a long
// inline esbuild command so `npm run build` behaves the same on POSIX and
// Windows shells (the previous inline banner quoting did not).
await build({
  entryPoints: ["api/boot.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  target: "node22",
  outdir: "dist",
  banner: {
    js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
  },
});

console.log("bundled api/boot.ts -> dist/boot.js");
