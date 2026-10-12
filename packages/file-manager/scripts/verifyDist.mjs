// Checks the emitted package surface without a browser.
import { checkPackage } from "./packageChecks.mjs";

const root = Bun.fileURLToPath(new URL("..", import.meta.url));
const { problems, summary } = await checkPackage(root.replace(/\/$/u, ""));

for (const problem of problems) {
  console.error(`verify: ${problem}`);
}
if (problems.length > 0) {
  process.exit(1);
}
console.log(`verify: ok (${summary})`);
