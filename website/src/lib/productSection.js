export function currentProduct(pathname) {
  return pathname === "/docs" || pathname.startsWith("/docs/") ? "docs" : "code";
}
