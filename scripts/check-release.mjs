import { lstat, readdir, readFile } from 'node:fs/promises';
import { extname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLISH_REF = 'refs/heads/codex/initial-web-port';
const allowedExtensions = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.m4a', '.mp3', '.wav', '.woff2']);
const privateNames = new Set(['source', 'output', 'var', 'node_modules', '__pycache__']);
const textExtensions = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg']);
const secretPattern = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAKIA[A-Z0-9]{16}\b/;

export function assertPublishRef(ref) {
  if (ref !== PUBLISH_REF) throw new Error(`Publication is allowed only from ${PUBLISH_REF}`);
}

export async function validateArtifact(root) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Artifact root must be a real directory');
  let files = 0, bytes = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${path}`);
      if (entry.name.startsWith('.') || privateNames.has(entry.name.toLowerCase())) throw new Error(`Private path in artifact: ${path}`);
      if (entry.isDirectory()) { await visit(path); continue; }
      const extension = extname(entry.name).toLowerCase();
      if (!entry.isFile() || !allowedExtensions.has(extension)) throw new Error(`Unexpected artifact file: ${path}`);
      const data = await readFile(path);
      if (textExtensions.has(extension) && secretPattern.test(data.toString('utf8'))) throw new Error(`Credential pattern in artifact: ${path}`);
      files++; bytes += data.length;
    }
  }
  await visit(root);
  const index = await lstat(join(root, 'index.html'));
  if (!index.isFile()) throw new Error('Artifact must contain index.html');
  return { files, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.includes('--publish')) assertPublishRef(process.env.GITHUB_REF);
    const result = await validateArtifact(fileURLToPath(new URL('../release', import.meta.url)));
    console.log(`Artifact checked: ${result.files} files, ${result.bytes} bytes`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
