import fs from "fs";
import path from "path";

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

test("the public shell has no executable inline or remote script", () => {
  const html = read("public/index.html");

  expect(html).not.toMatch(/<script\b/i);
  expect(html).not.toMatch(/emergent|posthog/i);
  expect(html).not.toMatch(/unsafe-eval/i);
});

test("Vercel production headers enforce the static-site baseline", () => {
  const config = JSON.parse(read("vercel.json"));
  const headers = config.headers[0].headers;
  const values = Object.fromEntries(headers.map(({ key, value }) => [key, value]));

  expect(values["Content-Security-Policy"]).toContain("script-src 'self'");
  expect(values["Content-Security-Policy"]).toContain("style-src-attr 'unsafe-inline'");
  expect(values["Content-Security-Policy"]).not.toMatch(/script-src[^;]*unsafe-(?:inline|eval)/i);
  expect(values["X-Content-Type-Options"]).toBe("nosniff");
  expect(values["X-Frame-Options"]).toBe("DENY");
});
