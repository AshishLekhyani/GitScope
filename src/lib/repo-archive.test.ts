import { describe, expect, it } from "vitest";
import { defaultArchiveFilter, parseTar } from "@/lib/repo-archive";

function header(name: string, size: number, type = "0"): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8");
  h.write(type, 156, "utf8");
  return h;
}

function entry(name: string, body: Buffer | string, type = "0"): Buffer {
  const data = typeof body === "string" ? Buffer.from(body) : body;
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header(name, data.length, type), data, pad]);
}

function pax(path: string): Buffer {
  const record = (len: number) => `${len} path=${path}\n`;
  let len = record(0).length;
  while (record(len).length !== len) len = record(len).length;
  return Buffer.from(record(len));
}

const opts = { maxFileBytes: 64, maxLockfileBytes: 1024, include: defaultArchiveFilter };

describe("parseTar", () => {
  it("strips the archive root directory and keeps text sources", () => {
    const tar = Buffer.concat([
      entry("acme-app-abc123/", "", "5"),
      entry("acme-app-abc123/src/index.ts", "export const a = 1;\n"),
      entry("acme-app-abc123/README.md", "# hi\n"),
      Buffer.alloc(1024),
    ]);
    const { files } = parseTar(tar, opts);
    expect([...files.keys()].sort()).toEqual(["README.md", "src/index.ts"]);
    expect(files.get("src/index.ts")).toBe("export const a = 1;\n");
  });

  it("uses PAX long names and skips binaries, oversized files and vendored code", () => {
    const longPath = `acme-app-abc123/${"deep/".repeat(25)}file.ts`;
    const tar = Buffer.concat([
      entry("acme-app-abc123/", "", "5"),
      entry("pax_header", pax(longPath), "x"),
      entry("ignored-short-name", "export {};\n"),
      entry("acme-app-abc123/logo.ts", Buffer.from([0x89, 0x50, 0x00, 0x47])),
      entry("acme-app-abc123/big.ts", "x".repeat(200)),
      entry("acme-app-abc123/node_modules/pkg/index.js", "module.exports = 1;\n"),
      entry("acme-app-abc123/package-lock.json", `{"lockfileVersion":3,"packages":{"${"a".repeat(100)}":{}}}`),
      Buffer.alloc(1024),
    ]);
    const { files, skipped } = parseTar(tar, opts);
    expect(files.has(longPath.slice("acme-app-abc123/".length))).toBe(true);
    expect(files.has("logo.ts")).toBe(false);
    expect(files.has("big.ts")).toBe(false);
    expect(files.has("node_modules/pkg/index.js")).toBe(false);
    expect(files.has("package-lock.json")).toBe(true);
    expect(skipped).toBe(2);
  });
});
