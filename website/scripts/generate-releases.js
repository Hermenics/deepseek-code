// Generates src/docs/data/releases.json from the root CHANGELOG.md.
// Run before build/start so the changelog page never duplicates release data.
const fs = require("fs");
const path = require("path");

const changelogPath = path.resolve(__dirname, "../../CHANGELOG.md");
const outPath = path.resolve(__dirname, "../src/docs/data/releases.json");

const text = fs.readFileSync(changelogPath, "utf8");
const releases = [];
let cur = null;
for (const line of text.split("\n")) {
  const m = line.match(/^## (.+)$/);
  if (m) {
    cur = { version: m[1], changes: [] };
    releases.push(cur);
  } else if (line.startsWith("- ") && cur) {
    cur.changes.push(line.slice(2));
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(releases, null, 2));
console.log(`generate-releases: ${releases.length} releases -> ${outPath}`);
