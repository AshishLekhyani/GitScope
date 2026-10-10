import { describe, expect, it } from "vitest";
import {
  collectPackages,
  compareVersions,
  cvss3BaseScore,
  fixedVersions,
  groupVulnerabilities,
  queryOsv,
  vulnSeverity,
  type LockedPackage,
} from "@/lib/osv";

const find = (pkgs: LockedPackage[], name: string) => pkgs.find((p) => p.name === name);

describe("collectPackages", () => {
  it("reads exact versions, dev flags and direct deps from package-lock v3", () => {
    const { packages, lockfiles } = collectPackages({
      "package.json": JSON.stringify({ dependencies: { next: "^16.0.0" }, devDependencies: { vitest: "^4.0.0" } }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "app" },
          "node_modules/next": { version: "16.2.1" },
          "node_modules/vitest": { version: "4.1.0", dev: true },
          "node_modules/@scope/util": { version: "1.0.0" },
          "node_modules/next/node_modules/postcss": { version: "8.4.31" },
          "packages/local": { version: "0.0.0", link: true },
        },
      }),
    });
    expect(lockfiles).toEqual(["package-lock.json"]);
    expect(find(packages, "next")).toMatchObject({ version: "16.2.1", direct: true, dev: false, approximate: false });
    expect(find(packages, "vitest")).toMatchObject({ dev: true, direct: true });
    expect(find(packages, "@scope/util")).toMatchObject({ version: "1.0.0", direct: false });
    expect(find(packages, "postcss")).toMatchObject({ version: "8.4.31", direct: false });
    expect(packages.some((p) => p.version === "^16.0.0")).toBe(false);
  });

  it("parses yarn v1, yarn berry and pnpm lockfiles", () => {
    const yarnV1 = '"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.23.0"\n  resolved "x"\n\nlodash@^4.17.0:\n  version "4.17.20"\n';
    const berry = '__metadata:\n  version: 6\n\n"react@npm:^18.0.0":\n  version: 18.2.0\n\n"app@workspace:.":\n  version: 0.0.0-use.local\n';
    const pnpm = "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies: {}\n\npackages:\n\n  '@types/node@20.1.0':\n    resolution: {integrity: x}\n\n  react-dom@18.2.0(react@18.2.0):\n    resolution: {integrity: y}\n\n  /semver/7.5.0_abc:\n    dev: true\n";
    const yarn = collectPackages({ "yarn.lock": yarnV1 }).packages;
    expect(find(yarn, "@babel/core")?.version).toBe("7.23.0");
    expect(find(yarn, "lodash")?.version).toBe("4.17.20");
    const b = collectPackages({ "web/yarn.lock": berry }).packages;
    expect(find(b, "react")?.version).toBe("18.2.0");
    expect(find(b, "app")).toBeUndefined();
    const p = collectPackages({ "pnpm-lock.yaml": pnpm }).packages;
    expect(find(p, "@types/node")?.version).toBe("20.1.0");
    expect(find(p, "react-dom")?.version).toBe("18.2.0");
    expect(find(p, "semver")).toMatchObject({ version: "7.5.0", dev: true });
  });

  it("parses Python, Rust, Ruby, PHP and Go manifests", () => {
    const { packages } = collectPackages({
      "poetry.lock": '[[package]]\nname = "django"\nversion = "4.2.1"\ncategory = "main"\n\n[[package]]\nname = "pytest"\nversion = "7.0.0"\ncategory = "dev"\n',
      "Cargo.lock": '[[package]]\nname = "serde"\nversion = "1.0.100"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "mycrate"\nversion = "0.1.0"\n',
      "Gemfile.lock": "GEM\n  remote: https://rubygems.org/\n  specs:\n    nokogiri (1.15.4-x86_64-linux)\n      racc (~> 1.4)\n    rails (7.0.4)\n\nPLATFORMS\n  ruby\n",
      "composer.lock": JSON.stringify({ packages: [{ name: "guzzlehttp/guzzle", version: "v7.4.0" }], "packages-dev": [{ name: "phpunit/phpunit", version: "9.5.0" }] }),
      "go.mod": "module x\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgolang.org/x/net v0.10.0 // indirect\n)\n\nrequire github.com/pkg/errors v0.9.1\n",
      "requirements-dev.txt": "requests==2.25.0\nflask>=2.0\n",
    });
    expect(find(packages, "django")).toMatchObject({ ecosystem: "PyPI", version: "4.2.1", dev: false });
    expect(find(packages, "pytest")?.dev).toBe(true);
    expect(find(packages, "serde")).toMatchObject({ ecosystem: "crates.io", version: "1.0.100" });
    expect(find(packages, "mycrate")).toBeUndefined();
    expect(find(packages, "nokogiri")).toMatchObject({ ecosystem: "RubyGems", version: "1.15.4" });
    expect(find(packages, "racc")).toBeUndefined();
    expect(find(packages, "guzzlehttp/guzzle")).toMatchObject({ ecosystem: "Packagist", version: "7.4.0" });
    expect(find(packages, "phpunit/phpunit")?.dev).toBe(true);
    expect(find(packages, "github.com/gin-gonic/gin")).toMatchObject({ ecosystem: "Go", version: "1.9.0", direct: true });
    expect(find(packages, "golang.org/x/net")?.direct).toBe(false);
    expect(find(packages, "github.com/pkg/errors")?.version).toBe("0.9.1");
    expect(find(packages, "requests")).toMatchObject({ version: "2.25.0", dev: true });
    expect(find(packages, "flask")).toBeUndefined();
  });

  it("falls back to declared ranges only where no lockfile covers the manifest", () => {
    const { packages } = collectPackages({
      "package.json": JSON.stringify({ dependencies: { express: "^4.17.1", local: "workspace:*" } }),
      "tools/package.json": JSON.stringify({ dependencies: { lodash: "4.17.20" } }),
      "tools/package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/lodash": { version: "4.17.21" } } }),
      "node_modules/x/package.json": JSON.stringify({ dependencies: { evil: "1.0.0" } }),
    });
    expect(find(packages, "express")).toMatchObject({ version: "4.17.1", approximate: true });
    expect(find(packages, "local")).toBeUndefined();
    expect(packages.filter((p) => p.name === "lodash").map((p) => p.version)).toEqual(["4.17.21"]);
    expect(find(packages, "evil")).toBeUndefined();
  });
});

describe("version and severity helpers", () => {
  it("compares versions numerically with prerelease ordering", () => {
    expect(compareVersions("16.10.0", "16.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("v2.0.0", "2.0.0")).toBe(0);
  });

  it("computes CVSS 3.x base scores", () => {
    expect(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N")).toBe(6.1);
    expect(cvss3BaseScore("CVSS:3.0/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H")).toBe(5.9);
    expect(cvss3BaseScore("CVSS:2.0/garbage")).toBeNull();
  });

  it("prefers the advisory severity label and falls back to the CVSS score", () => {
    expect(vulnSeverity({ id: "A", database_specific: { severity: "MODERATE" }, severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }).severity).toBe("medium");
    expect(vulnSeverity({ id: "B", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] })).toEqual({ severity: "critical", score: 9.8 });
    expect(vulnSeverity({ id: "C" }).severity).toBe("medium");
  });

  it("returns only fix versions newer than the installed one for the matching package", () => {
    const record = {
      id: "GHSA-x",
      affected: [
        { package: { name: "next", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "14.2.30" }, { introduced: "15.0.0" }, { fixed: "15.3.4" }] }] },
        { package: { name: "other", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ fixed: "99.0.0" }] }] },
      ],
    };
    expect(fixedVersions(record, { name: "next", ecosystem: "npm", version: "15.1.0" })).toEqual(["15.3.4"]);
    expect(fixedVersions(record, { name: "next", ecosystem: "npm", version: "14.0.0" })).toEqual(["14.2.30", "15.3.4"]);
  });
});

describe("queryOsv", () => {
  const pkgs: LockedPackage[] = [
    { name: "lodash", version: "4.17.20", ecosystem: "npm", dev: false, direct: true, source: "package-lock.json", approximate: false },
    { name: "left-pad", version: "1.0.0", ecosystem: "npm", dev: true, direct: false, source: "package-lock.json", approximate: false },
  ];

  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/querybatch")) {
      const body = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string } }> };
      return new Response(JSON.stringify({
        results: body.queries.map((q) => (q.package.name === "lodash" ? { vulns: [{ id: "GHSA-lodash" }, { id: "CVE-2021-23337" }] } : {})),
      }));
    }
    if (u.endsWith("/vulns/GHSA-lodash")) {
      return new Response(JSON.stringify({
        id: "GHSA-lodash",
        aliases: ["CVE-2021-23337"],
        summary: "Command injection in lodash",
        database_specific: { severity: "HIGH" },
        affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }],
        references: [{ type: "ADVISORY", url: "https://example.test/advisory" }],
      }));
    }
    if (u.endsWith("/vulns/CVE-2021-23337")) {
      return new Response(JSON.stringify({ id: "CVE-2021-23337", aliases: ["GHSA-lodash"], summary: "dup" }));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  it("batches the query, fetches details and collapses alias duplicates", async () => {
    const result = await queryOsv(pkgs, { fetchImpl: fakeFetch });
    expect(result.complete).toBe(true);
    expect(result.scanned).toBe(2);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0]).toMatchObject({
      id: "GHSA-lodash", package: "lodash", version: "4.17.20", severity: "high",
      fixedIn: ["4.17.21"], aliases: ["CVE-2021-23337"], url: "https://example.test/advisory", direct: true,
    });
  });

  it("reports an incomplete scan instead of throwing when OSV is unreachable", async () => {
    const failing = (async () => { throw new Error("offline"); }) as typeof fetch;
    const result = await queryOsv(pkgs, { fetchImpl: failing });
    expect(result.vulnerabilities).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it("groups advisories per package with the highest fix target", () => {
    const groups = groupVulnerabilities([
      { id: "A", aliases: ["CVE-1"], package: "next", version: "15.0.0", ecosystem: "npm", summary: "RCE", severity: "critical", fixedIn: ["15.0.5"], url: "u", dev: false, direct: true, approximate: false, source: "package-lock.json" },
      { id: "B", aliases: [], package: "next", version: "15.0.0", ecosystem: "npm", summary: "DoS", severity: "high", fixedIn: ["15.2.0"], url: "u", dev: false, direct: true, approximate: false, source: "package-lock.json" },
      { id: "C", aliases: [], package: "tool", version: "1.0.0", ecosystem: "npm", summary: "x", severity: "low", url: "u", dev: true, direct: false, approximate: false, source: "package-lock.json" },
    ]);
    expect(groups[0]).toMatchObject({ name: "next", severity: "critical", fixTarget: "15.2.0", counts: { critical: 1, high: 1, medium: 0, low: 0 }, cves: ["CVE-1"] });
    expect(groups[1]).toMatchObject({ name: "tool", unfixed: 1, dev: true });
  });
});
