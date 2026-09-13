// Copies src/agent/deepseekModels.json (synced from DeepSeek's pricing page by
// scripts/update-deepseek-models.ts) into the docs, so the site and /cost never disagree.
const fs = require("fs");
const path = require("path");

const sourcePath = path.resolve(__dirname, "../../src/agent/deepseekModels.json");
const outPath = path.resolve(__dirname, "../src/docs/data/deepseek-models.json");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.copyFileSync(sourcePath, outPath);
console.log(`generate-models: ${sourcePath} -> ${outPath}`);
