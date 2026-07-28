// occt-import-js'in wasm binary'si public/ altında serve edilmeli (bkz.
// StepViewer'daki locateFile: (path) => `/${path}`). Repoya binary commit
// etmek yerine her dev/build öncesi node_modules'tan kopyalanır.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const src = join(dirname(require.resolve("occt-import-js/package.json")), "dist", "occt-import-js.wasm");
const destDir = join(__dirname, "..", "public");
const dest = join(destDir, "occt-import-js.wasm");

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`occt-import-js.wasm kopyalandı: ${dest}`);
