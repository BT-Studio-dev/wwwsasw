import fs from "node:fs";
import path from "node:path";

// Cross-platform production entrypoint: NODE_ENV must be set before the
// server module runs, and `NODE_ENV=production node ...` only works in
// POSIX shells.
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const bundle = path.resolve(import.meta.dirname, "../dist/boot.js");
const assets = path.resolve(import.meta.dirname, "../dist/public/index.html");

if (!fs.existsSync(bundle) || !fs.existsSync(assets)) {
  console.error("No build found. Run `npm run build` before `npm start`.");
  process.exit(1);
}

await import(bundle);
