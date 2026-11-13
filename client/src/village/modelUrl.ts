/**
 * A model/texture URL with its content hash appended (?v=<hash>), so every deploy that changes the file busts the
 * browser cache while unchanged files stay cached. Unknown paths are returned unchanged.
 */
export function versionedUrl(path: string): string {
  const hashes: Record<string, string> = typeof __MODEL_HASHES__ === "undefined" ? {} : __MODEL_HASHES__;
  const h = hashes[path];
  return h ? `${path}?v=${h}` : path;
}
