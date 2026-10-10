import { gunzipSync } from "node:zlib";

export interface RepoArchive {
  files: Map<string, string>;
  skipped: number;
  compressedBytes: number;
}

export interface ArchiveOptions {
  maxCompressedBytes?: number;
  maxUncompressedBytes?: number;
  maxFileBytes?: number;
  maxLockfileBytes?: number;
  timeoutMs?: number;
  include?: (path: string) => boolean;
}

const TEXT_FILE =
  /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|pyi|go|rs|java|kt|kts|scala|groovy|rb|rake|php|cs|swift|dart|c|cc|cpp|h|hpp|sql|prisma|graphql|gql|json|jsonc|ya?ml|toml|ini|cfg|conf|tf|hcl|sh|bash|zsh|md|mdx|txt|html|css|scss|xml|plist|gradle|lock|properties|env(?:\.\w+)?)$|(?:^|\/)(?:Dockerfile|Containerfile|Makefile|Procfile|Gemfile|Pipfile|Jenkinsfile|\.env(?:\.[\w-]+)?|\.npmrc|\.gitignore|go\.mod|go\.sum)$/i;
export const LOCKFILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;
const SKIP_DIR = /(?:^|\/)(?:node_modules|vendor|dist|build|out|\.next|\.nuxt|coverage|\.git|target|__pycache__|\.venv|venv|bower_components)\//;

export function defaultArchiveFilter(path: string): boolean {
  return TEXT_FILE.test(path) && !SKIP_DIR.test(path);
}

function readString(buf: Buffer, start: number, length: number): string {
  const end = buf.indexOf(0, start);
  return buf.toString("utf8", start, end >= 0 && end < start + length ? end : start + length);
}

function readOctal(buf: Buffer, start: number, length: number): number {
  const raw = readString(buf, start, length).trim();
  return raw ? parseInt(raw, 8) : 0;
}

function paxPath(data: Buffer): string | null {
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    if (space < 0) break;
    const len = parseInt(data.toString("utf8", i, space), 10);
    if (!len) break;
    const record = data.toString("utf8", space + 1, i + len - 1);
    if (record.startsWith("path=")) return record.slice(5);
    i += len;
  }
  return null;
}

export function parseTar(tar: Buffer, opts: { maxFileBytes: number; maxLockfileBytes?: number; include: (path: string) => boolean }): { files: Map<string, string>; skipped: number } {
  const files = new Map<string, string>();
  let skipped = 0;
  let offset = 0;
  let pendingName: string | null = null;
  let root: string | null = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    offset = dataStart + Math.ceil(size / 512) * 512;
    if (dataEnd > tar.length) break;

    if (type === "x") {
      pendingName = paxPath(tar.subarray(dataStart, dataEnd));
      continue;
    }
    if (type === "L") {
      pendingName = readString(tar, dataStart, size);
      continue;
    }
    if (type === "g") continue;

    const prefix = readString(header, 345, 155);
    const name = pendingName ?? (prefix ? `${prefix}/${readString(header, 0, 100)}` : readString(header, 0, 100));
    pendingName = null;
    if (type !== "0" && type !== "\0" && type !== "7") continue;

    const slash = name.indexOf("/");
    if (root === null && slash > 0) root = name.slice(0, slash + 1);
    const path = root && name.startsWith(root) ? name.slice(root.length) : name;
    if (!path || !opts.include(path)) continue;
    if (size > (LOCKFILE.test(path) ? Math.max(opts.maxFileBytes, opts.maxLockfileBytes ?? 0) : opts.maxFileBytes)) { skipped++; continue; }

    const data = tar.subarray(dataStart, dataEnd);
    if (data.subarray(0, Math.min(data.length, 8000)).includes(0)) { skipped++; continue; }
    files.set(path, data.toString("utf8"));
  }
  return { files, skipped };
}

export async function fetchRepoArchive(
  repo: string,
  ref: string,
  token: string | null,
  opts: ArchiveOptions = {},
): Promise<RepoArchive | null> {
  const maxCompressed = opts.maxCompressedBytes ?? 40 * 1024 * 1024;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(ref)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      cache: "no-store",
    });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxCompressed) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxCompressed) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const tar = gunzipSync(Buffer.concat(chunks.map((c) => Buffer.from(c))), {
      maxOutputLength: opts.maxUncompressedBytes ?? 200 * 1024 * 1024,
    });
    const { files, skipped } = parseTar(tar, {
      maxFileBytes: opts.maxFileBytes ?? 512 * 1024,
      maxLockfileBytes: opts.maxLockfileBytes ?? 12 * 1024 * 1024,
      include: opts.include ?? defaultArchiveFilter,
    });
    return { files, skipped, compressedBytes: total };
  } catch {
    return null;
  }
}
