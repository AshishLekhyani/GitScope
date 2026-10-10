import { describe, expect, it } from "vitest";
import { analyzeWithInternalAI, scanRepoWithInternalAI, type InternalAnalysisInput } from "@/lib/internal-ai";
import { LineIndex, maskSource, parsePatch, parseSuppressions, redactSecrets } from "@/lib/internal-ai-engine";

function review(filename: string, code: string, extra: Partial<InternalAnalysisInput> = {}) {
  const patch = code.split("\n").map((l) => `+${l}`).join("\n");
  return analyzeWithInternalAI({
    repo: "acme/app",
    analysisType: "pr",
    prMeta: { title: "feat: change", body: null, user: { login: "dev" }, additions: 1, deletions: 0, changed_files: 1, draft: false, labels: [] },
    files: [{ filename, status: "modified", additions: 1, deletions: 0, patch }],
    ...extra,
  });
}

function securityFindings(filename: string, code: string) {
  return review(filename, code).findings.filter((f) => f.category === "security");
}

describe("maskSource", () => {
  it("keeps template-literal expressions as code but blanks the static text", () => {
    const m = maskSource("db.query(`SELECT * FROM u WHERE id = ${req.query.id}`); // done", "js");
    expect(m.code).toContain("${req.query.id}");
    expect(m.code).not.toContain("SELECT");
    expect(m.text).toContain("SELECT");
    expect(m.text).not.toContain("done");
  });

  it("distinguishes regex literals from division", () => {
    const m = maskSource('const a = b / 2; const r = /eval\\(/; const s = "x//y";', "js");
    expect(m.code).toContain("b / 2");
    expect(m.code).not.toContain("eval");
    expect(m.text).toContain("x//y");
  });

  it("masks JSX text so prose and demo snippets are never treated as code", () => {
    const m = maskSource("<div>- const result = eval(userInput);</div>\n{eval(x)}", "js", "a.tsx");
    expect(m.code.split("\n")[0]).not.toContain("eval");
    expect(m.code.split("\n")[1]).toContain("eval(x)");
  });

  it("keeps Python f-string holes and strips comments", () => {
    const m = maskSource('q = f"SELECT * FROM t WHERE id = {uid}"  # note', "py");
    expect(m.code).toContain("{uid}");
    expect(m.code).not.toContain("SELECT");
    expect(m.code).not.toContain("note");
  });

  it("only treats # as a YAML comment after whitespace", () => {
    const m = maskSource("url: http://x#frag # tail", "yaml");
    expect(m.code).toContain("http://x#frag");
    expect(m.code).not.toContain("tail");
  });

  it("preserves offsets and line breaks", () => {
    const src = "a = '1'\n// c\nb = `x${y}z`";
    const m = maskSource(src, "js");
    expect(m.code.length).toBe(src.length);
    expect(m.text.split("\n").length).toBe(3);
  });
});

describe("diff and line helpers", () => {
  it("maps hunks to new-file line numbers and tracks added lines", () => {
    const view = parsePatch("@@ -1,2 +10,3 @@\n ctx\n+added\n-removed\n ctx2\n@@ -40 +50,1 @@\n+late");
    expect(view.hunks[0].newLines).toEqual([10, 11, 12]);
    expect([...view.added]).toEqual([11, 50]);
  });

  it("resolves offsets to 1-based lines", () => {
    const idx = new LineIndex("a\nbb\nccc");
    expect(idx.lineOf(0)).toBe(1);
    expect(idx.lineOf(5)).toBe(3);
    expect(idx.lineText(2)).toBe("bb");
  });

  it("parses suppression comments", () => {
    const s = parseSuppressions("x // gitscope-ignore\n// gitscope-ignore-next-line: eval-usage\ny\nz # nosec");
    expect(s.byLine.get(1)).toBe("all");
    expect(s.byLine.get(3)).toEqual(new Set(["eval-usage"]));
    expect(s.nosec.has(4)).toBe(true);
  });

  it("redacts credentials but leaves code identifiers alone", () => {
    const out = redactSecrets('key "sk-proj-a8Fk2LmQ9zR4tY7wX1cV5bN3mJ6hG0dS2pK9qL4eT7" and `NextResponse.redirect()` postgres://u:hunter22@db.example.com/x');
    expect(out).not.toContain("a8Fk2LmQ9zR4tY7wX1cV5bN3mJ6hG0dS2pK9qL4eT7");
    expect(out).not.toContain("hunter22");
    expect(out).toContain("NextResponse.redirect()");
  });
});

describe("PR analysis — detection", () => {
  const cases: Array<[string, string, string, RegExp]> = [
    ["sql template literal", "src/app/api/users/route.ts", "const r = await db.query(`SELECT * FROM users WHERE id = ${req.query.id}`);", /SQL/],
    ["prisma raw unsafe", "src/lib/search.ts", "const rows = await prisma.$queryRawUnsafe(`SELECT * FROM t WHERE name = '${name}'`);", /queryRawUnsafe|SQL/],
    ["shell template", "src/lib/git.ts", "exec(`git clone ${repoUrl}`, cb);", /shell|command/i],
    ["new Function", "src/lib/calc.ts", "const fn = new Function('a', userExpr);", /new Function/],
    ["python shell=True", "app/run.py", "subprocess.run(cmd, shell=True)", /shell=True/],
    ["python pickle", "app/load.py", "data = pickle.loads(request.data)", /deserializ/i],
    ["python yaml.load", "app/cfg.py", "cfg = yaml.load(open(p))", /SafeLoader/],
    ["python verify=False", "app/http.py", "requests.get(url, verify=False)", /TLS/],
    ["python sql f-string", "app/db.py", 'cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")', /SQL/],
    ["go sql sprintf", "pkg/db.go", 'rows, err := db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", id))', /SQL/],
    ["go InsecureSkipVerify", "pkg/http.go", "cfg := &tls.Config{InsecureSkipVerify: true}", /InsecureSkipVerify/],
    ["openai key", "src/lib/ai.ts", "const key = 'sk-proj-a8Fk2LmQ9zR4tY7wX1cV5bN3mJ6hG0dS2pK9qL4eT7uY1iO';", /OpenAI API key/],
    ["anthropic key", "src/lib/llm.ts", 'const k = "sk-ant-api03-a8Fk2LmQ9zR4tY7wX1cV5bN3mJ6hG0dS2pK9qL4eT7uY1iOa";', /Anthropic API key/],
    ["cors any origin with credentials", "src/server.ts", "app.use(cors({ origin: true, credentials: true }));", /CORS/],
    ["document.write", "src/legacy.js", "document.write(location.hash);", /document\.write|XSS/],
    ["actions script injection", ".github/workflows/t.yml", '      - run: echo "${{ github.event.issue.title }}"', /run: script/],
    ["curl piped to shell", "Dockerfile", "FROM node:22-alpine\nRUN curl -fsSL https://example.com/install.sh | sh\nUSER node", /piped/],
    ["public env secret", "src/lib/supabase.ts", "export const admin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);", /public env prefix/],
    ["fallback secret", "src/lib/jwt.ts", 'const secret = process.env.JWT_SECRET ?? "dev-secret-change-me";', /falls back/],
  ];

  it.each(cases)("%s", (_name, file, code, expected) => {
    const found = securityFindings(file, code);
    expect(found.some((f) => expected.test(f.description))).toBe(true);
    expect(found.every((f) => typeof f.line === "number")).toBe(true);
  });

  it("follows user input through variables into a sink (taint)", () => {
    const code = [
      "export async function POST(req: Request) {",
      "  const body = await req.json();",
      "  const target = body.url;",
      "  const res = await fetch(target);",
      "  return Response.json(await res.json());",
      "}",
    ].join("\n");
    const ssrf = securityFindings("src/app/api/proxy/route.ts", code).find((f) => /SSRF/.test(f.description));
    expect(ssrf?.line).toBe(4);
    expect(ssrf?.description).toContain("target");
  });

  it("flags mass assignment of a parsed request body", () => {
    const code = [
      "export async function PATCH(req: Request) {",
      "  const session = await getServerSession(authOptions);",
      "  const body = await req.json();",
      "  await prisma.user.update({ where: { id: session.user.id }, data: body });",
      "}",
    ].join("\n");
    expect(securityFindings("src/app/api/profile/route.ts", code).some((f) => /Mass assignment/.test(f.description))).toBe(true);
  });

  it("tracks Python taint into os.system through an f-string", () => {
    const code = "def run():\n    host = request.args.get('host')\n    cmd = f\"ping -c 1 {host}\"\n    os.system(cmd)";
    const hit = securityFindings("app/views.py", code).find((f) => /Command injection/.test(f.description));
    expect(hit?.severity).toBe("critical");
    expect(hit?.line).toBe(4);
  });

  it("flags mutating route handlers with no auth", () => {
    const code = "export async function DELETE(req: Request) {\n  const { id } = await req.json();\n  await prisma.item.delete({ where: { id } });\n}";
    expect(securityFindings("src/app/api/items/route.ts", code).some((f) => /authentication or authorization/.test(f.description))).toBe(true);
  });

  it("detects a pull_request_target workflow that checks out PR code", () => {
    const code = "on:\n  pull_request_target:\njobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}";
    const hit = securityFindings(".github/workflows/ci.yml", code).find((f) => /pull_request_target/.test(f.description));
    expect(hit?.severity).toBe("critical");
    expect(hit?.line).toBe(8);
  });

  it("never echoes the leaked credential back", () => {
    const secret = "sk-proj-a8Fk2LmQ9zR4tY7wX1cV5bN3mJ6hG0dS2pK9qL4eT7uY1iO";
    const result = review("src/lib/ai.ts", `const key = '${secret}';`);
    const serialized = JSON.stringify(result.findings) + result.securityIssues.join(" ");
    expect(serialized).not.toContain(secret);
  });
});

describe("PR analysis — precision", () => {
  const clean: Array<[string, string, string]> = [
    ["strong bcrypt", "src/a.ts", "await bcrypt.hash(pw, 12);"],
    ["parameterized SQL", "src/app/api/u/route.ts", 'export async function GET(req: Request) {\n  const session = await getServerSession(authOptions);\n  const id = new URL(req.url).searchParams.get("id");\n  return Response.json(await db.query("SELECT * FROM users WHERE id = $1", [id]));\n}'],
    ["fetch to a fixed host", "src/app/api/gh/route.ts", "export async function GET(req: Request, { params }: Ctx) {\n  const session = await getServerSession(authOptions);\n  const { owner } = await params;\n  const url = `https://api.github.com/users/${owner}`;\n  return fetch(url);\n}"],
    ["guarded redirect", "src/app/cb/route.ts", 'export async function GET(req: NextRequest) {\n  const next = req.nextUrl.searchParams.get("next") ?? "/";\n  const dest =\n    next.startsWith("/") && !next.startsWith("//")\n      ? next\n      : "/";\n  return NextResponse.redirect(new URL(dest, req.url));\n}'],
    ["messages that mention secrets", "src/app/api/x/route.ts", 'console.warn("Auth token missing for request", error);\nthrow new Error("password must be at least 12 characters");'],
    ["cosmetic Math.random", "src/components/bg.tsx", "const x = Math.random() * width;"],
    ["placeholder credentials", "src/config.ts", 'const config = { apiKey: "your-api-key-here", password: "changeme" };'],
    ["inline suppression", "src/legacy/eval.ts", "const r = eval(expr); // gitscope-ignore: eval-usage"],
    ["vulnerable code inside a prompt string", "src/lib/prompts.ts", "const prompt = `Look for createHash('md5') and rejectUnauthorized: false in the code`;"],
    ["regex Exec with request input", "src/lib/match.ts", "const m = pattern.exec(req.query.q);"],
    ["redirect to a search path", "src/features/search.tsx", '"use client";\nconst q = useSearchParams().get("q") ?? "";\nrouter.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search");'],
  ];

  it.each(clean)("%s produces no security findings", (_name, file, code) => {
    expect(securityFindings(file, code)).toEqual([]);
  });

  it("only reports lines the change added", () => {
    const patch = ["@@ -1,3 +1,4 @@", " const a = eval(userInput);", "+const b = 1;", " const c = 2;"].join("\n");
    const result = analyzeWithInternalAI({
      repo: "acme/app",
      analysisType: "commit",
      commitMeta: { commit: { message: "chore: tweak", author: { name: "dev" } } },
      files: [{ filename: "src/x.ts", status: "modified", additions: 1, deletions: 0, patch }],
    });
    expect(result.findings.filter((f) => f.category === "security")).toEqual([]);
  });

  it("uses full post-change contents for context and ignores stale contents", () => {
    const content = [
      "export async function POST(req: Request) {",
      "  const body = await req.json();",
      "  const target = body.url;",
      "  const res = await fetch(target);",
      "}",
    ].join("\n");
    const patch = "@@ -3,0 +4,1 @@\n+  const res = await fetch(target);";
    const withContext = analyzeWithInternalAI({
      repo: "acme/app",
      analysisType: "pr",
      files: [{ filename: "src/app/api/p/route.ts", status: "modified", additions: 1, deletions: 0, patch }],
      fileContents: { "src/app/api/p/route.ts": content },
    });
    expect(withContext.findings.find((f) => /SSRF/.test(f.description))?.line).toBe(4);

    const stale = analyzeWithInternalAI({
      repo: "acme/app",
      analysisType: "pr",
      files: [{ filename: "src/app/api/p/route.ts", status: "modified", additions: 1, deletions: 0, patch }],
      fileContents: { "src/app/api/p/route.ts": "const unrelated = true;" },
    });
    expect(stale.findings.some((f) => /SSRF/.test(f.description))).toBe(false);
  });

  it("approves a clean change and blocks a critical one", () => {
    expect(review("src/a.ts", "export const sum = (a: number, b: number) => a + b;").verdict).toBe("APPROVE");
    const blocked = review("src/a.ts", "const key = 'sk-proj-a8Fk2LmQ9zR4tY7wX1cV5bN3mJ6hG0dS2pK9qL4eT7uY1iO';");
    expect(blocked.verdict).toBe("REQUEST_CHANGES");
    expect(blocked.mergeRisk).toBe("critical");
  });

  it("detects removed exports as breaking changes", () => {
    const patch = "@@ -1,2 +1,1 @@\n-export function legacy() {}\n export function kept() {}";
    const result = analyzeWithInternalAI({
      repo: "acme/app",
      analysisType: "pr",
      files: [{ filename: "src/lib/util.ts", status: "modified", additions: 0, deletions: 1, patch }],
    });
    expect(result.breakingChanges.some((c) => c.includes("legacy"))).toBe(true);
  });
});

describe("cross-file analysis", () => {
  const base = { repo: "acme/app", recentCommits: [], contributors: 3, meta: {}, scanMode: "deep" };
  const scan = (files: Record<string, string>, extraTree: string[] = []) =>
    scanRepoWithInternalAI({ ...base, fileTree: [...Object.keys(files), ...extraTree], keyFileContents: files });
  const all = (r: ReturnType<typeof scan>) => [...r.security.issues, ...r.codeQuality.issues];

  it("follows user input from a route into a helper module's SQL sink", () => {
    const result = scan({
      "src/lib/db.ts": "export async function findUser(email: string) {\n  return pool.query(`SELECT * FROM users WHERE email = '${email}'`);\n}\n",
      "src/app/api/users/route.ts": "import { findUser } from \"@/lib/db\";\n\nexport async function GET(req: Request) {\n  const session = await getServerSession(authOptions);\n  const email = new URL(req.url).searchParams.get(\"email\");\n  return Response.json(await findUser(email));\n}\n",
    });
    const flow = all(result).find((f) => /across files/.test(f.description));
    expect(flow?.file).toBe("src/app/api/users/route.ts");
    expect(flow?.line).toBe(6);
    expect(flow?.description).toContain("findUser()");
    expect(flow?.description).toContain("lib/db.ts:2");
  });

  it("propagates through intermediate helpers", () => {
    const result = scan({
      "src/lib/shell.ts": "import { exec } from \"child_process\";\nexport function run(cmd: string) {\n  exec(cmd);\n}\n",
      "src/lib/git.ts": "import { run } from \"./shell\";\nexport function clone(url: string) {\n  run(`git clone ${url}`);\n}\n",
      "src/app/api/clone/route.ts": "import { clone } from \"@/lib/git\";\nexport async function POST(req: Request) {\n  const session = await getServerSession(authOptions);\n  const { url } = await req.json();\n  clone(url);\n}\n",
    });
    const flow = all(result).find((f) => /Command injection across files/.test(f.description));
    expect(flow?.line).toBe(5);
    expect(flow?.description).toContain("run()");
  });

  it("recognizes auth performed by an imported helper with any name", () => {
    const files = {
      "src/lib/guards.ts": "export async function loadViewer() {\n  const s = await getServerSession(authOptions);\n  if (!s) throw new Error(\"no\");\n  return s.user;\n}\n",
      "src/app/api/items/route.ts": "import { loadViewer } from \"@/lib/guards\";\nexport async function DELETE(req: Request) {\n  const me = await loadViewer();\n  const { id } = await req.json();\n  await prisma.item.delete({ where: { id, ownerId: me.id } });\n}\n",
    };
    expect(all(scan(files)).some((f) => /without any visible authentication/.test(f.description))).toBe(false);
  });

  it("escalates an unauthenticated route that calls a data-deleting helper", () => {
    const result = scan({
      "src/lib/repos.ts": "export async function removeRepo(id: string) {\n  await prisma.repo.delete({ where: { id } });\n}\n",
      "src/app/api/repos/route.ts": "import { removeRepo } from \"@/lib/repos\";\nexport async function DELETE(req: Request) {\n  const { id } = await req.json();\n  await removeRepo(id);\n}\n",
    });
    const finding = all(result).find((f) => /without any visible authentication/.test(f.description));
    expect(finding?.severity).toBe("high");
    expect(finding?.description).toContain("removeRepo()");
  });

  it("flags client components that pull server-only modules into the bundle", () => {
    const result = scan({
      "src/lib/db.ts": "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n",
      "src/lib/repos.ts": "import { prisma } from \"./db\";\nexport const listRepos = () => prisma.repo.findMany({ take: 10 });\n",
      "src/components/repo-list.tsx": "\"use client\";\nimport { listRepos } from \"@/lib/repos\";\nexport function RepoList() { return null; }\n",
    });
    const finding = all(result).find((f) => /imports server-only code/.test(f.description));
    expect(finding?.file).toBe("src/components/repo-list.tsx");
    expect(finding?.line).toBe(2);
    expect(finding?.description).toContain("Prisma");
  });

  it("finds circular imports, unresolved imports and missing exports", () => {
    const result = scan(
      {
        "src/lib/a.ts": "import { b } from \"./b\";\nexport const a = () => b();\n",
        "src/lib/b.ts": "import { a } from \"./a\";\nexport const b = () => a();\n",
        "src/lib/c.ts": "import { gone } from \"./deleted\";\nimport { nope } from \"./a\";\nexport const c = () => gone() + nope;\n",
      },
      [],
    );
    const findings = all(result);
    expect(findings.some((f) => /Circular import/.test(f.description))).toBe(true);
    expect(findings.some((f) => /doesn't resolve to any file/.test(f.description) && f.line === 1)).toBe(true);
    expect(findings.some((f) => /imports `nope`/.test(f.description) && f.line === 2)).toBe(true);
  });

  it("reports unused exports and layer violations when the whole repo was read", () => {
    const result = scan({
      "src/lib/format.ts": "export const used = () => 1;\nexport const unusedHelper = () => 2;\n",
      "src/lib/toast.ts": "import { Toast } from \"@/components/toast\";\nexport const notify = () => Toast;\n",
      "src/components/toast.tsx": "import { used } from \"@/lib/format\";\nexport const Toast = used;\n",
      "src/app/page.tsx": "import { notify } from \"@/lib/toast\";\nexport default function Page() { notify(); return null; }\n",
    });
    const findings = all(result);
    expect(findings.some((f) => /unusedHelper/.test(f.description))).toBe(true);
    expect(findings.some((f) => /lib module lib\/toast\.ts imports from the component module/.test(f.description))).toBe(true);
  });

  it("only reports cross-file flows on lines a PR added", () => {
    const helper = "export function lookup(q: string) {\n  return pool.query(`SELECT * FROM t WHERE name = '${q}'`);\n}\n";
    const route = "import { lookup } from \"@/lib/search\";\nexport async function GET(req: Request) {\n  const session = await getServerSession(authOptions);\n  const q = new URL(req.url).searchParams.get(\"q\");\n  return Response.json(await lookup(q));\n}\n";
    const result = analyzeWithInternalAI({
      repo: "acme/app",
      analysisType: "pr",
      files: [{ filename: "src/app/api/search/route.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -5,1 +5,1 @@\n-  return Response.json([]);\n+  return Response.json(await lookup(q));" }],
      fileContents: { "src/app/api/search/route.ts": route, "src/lib/search.ts": helper },
      repoFiles: ["src/app/api/search/route.ts", "src/lib/search.ts"],
    });
    const flow = result.findings.find((f) => /across files/.test(f.description));
    expect(flow?.line).toBe(5);
    expect(flow?.file).toBe("src/app/api/search/route.ts");
  });
});

describe("project profiling", () => {
  const base = { repo: "acme/app", recentCommits: [], contributors: 3, meta: {}, scanMode: "deep" };
  const scan = (files: Record<string, string>, extraTree: string[] = []) =>
    scanRepoWithInternalAI({ ...base, fileTree: [...Object.keys(files), ...extraTree], keyFileContents: files });
  const issues = (r: ReturnType<typeof scan>) => [...r.security.issues, ...r.codeQuality.issues, ...r.performance.issues];

  it("recognizes a Next.js AI app and inventories its endpoints", () => {
    const result = scan(
      {
        "package.json": JSON.stringify({ private: true, dependencies: { next: "16.0.0", react: "19.0.0", "@prisma/client": "5.0.0", "next-auth": "4.24.0", "@anthropic-ai/sdk": "0.80.0" } }),
        "prisma/schema.prisma": "datasource db {\n  provider = \"postgresql\"\n}\nmodel User {\n  id String @id\n  email String\n  accessToken String?\n}\n",
        "src/app/api/items/route.ts": "export async function DELETE(req: Request) {\n  const { id } = await req.json();\n  await prisma.item.delete({ where: { id } });\n}\n",
        "src/app/api/me/route.ts": "export async function POST(req: Request) {\n  const session = await getServerSession(authOptions);\n  const body = Schema.parse(await req.json());\n  await prisma.user.update({ where: { id: session.user.id }, data: body });\n}\n",
      },
      ["vercel.json"],
    );
    const profile = result.profile!;
    expect(profile.kind).toBe("nextjs-app");
    expect(profile.label).toMatch(/Next\.js 16/);
    expect(profile.label).toMatch(/Prisma \(PostgreSQL\)/);
    expect(profile.traits).toEqual(expect.arrayContaining(["ai-powered", "authentication", "personal-data", "stores-credentials"]));
    expect(profile.deployment).toContain("Vercel");
    const surface = profile.surface!;
    expect(surface.totalEndpoints).toBe(2);
    expect(surface.endpoints[0]).toMatchObject({ path: "/api/items", auth: "none", effects: ["db-write"] });
    expect(surface.endpoints.find((e) => e.path === "/api/me")).toMatchObject({ auth: "session", validated: true });
  });

  it("recognizes libraries and checks their packaging", () => {
    const result = scan({
      "package.json": JSON.stringify({ name: "tiny-lib", exports: "./dist/index.js", dependencies: { react: "^19.0.0" } }),
      "src/index.ts": "export const add = (a: number, b: number): number => a + b;\n",
    });
    expect(result.profile!.kind).toBe("node-library");
    const text = issues(result).map((f) => f.description).join("\n");
    expect(text).toMatch(/no "files" allowlist/);
    expect(text).toMatch(/without a "types" entry/);
    expect(text).toMatch(/react listed in "dependencies"/);
    expect(result.scoreBreakdown!.weightsRationale).toMatch(/Library weighting/);
  });

  it("treats CLI arguments as operator input", () => {
    const result = scan({
      "package.json": JSON.stringify({ name: "tool", bin: { tool: "./bin/tool.js" }, dependencies: { commander: "^12.0.0" } }),
      "src/run.js": "const { exec } = require(\"child_process\");\nconst target = process.argv[2];\nexec(`ls ${target}`);\n",
    });
    expect(result.profile!.kinds).toContain("cli-tool");
    const flow = result.security.issues.find((f) => /Command injection/.test(f.description));
    expect(flow?.severity).toBe("low");
    expect(flow?.description).toMatch(/operator running the tool/);
  });

  it("explains every score with factors that add up", () => {
    const result = scan({
      "package.json": JSON.stringify({ dependencies: { next: "16.0.0" } }),
      "src/lib/hash.ts": "import { createHash } from \"crypto\";\nexport const tokenHash = (token: string) => createHash(\"md5\").update(token).digest(\"hex\");\n",
    });
    const b = result.scoreBreakdown!;
    const sum = (xs: Array<{ points: number }>) => xs.reduce((n, x) => n + x.points, 0);
    expect(Math.abs(sum(b.security) - result.security.score)).toBeLessThanOrEqual(1);
    expect(Math.abs(sum(b.dependencies) - result.dependencies.score)).toBeLessThanOrEqual(1);
    expect(Math.abs(sum(b.health) - result.healthScore)).toBeLessThanOrEqual(1);
    expect(b.security.some((f) => /MD5/.test(f.label) && f.file === "src/lib/hash.ts" && f.points < 0)).toBe(true);
  });
});

describe("stack-specific rules", () => {
  const withProject = (filename: string, code: string, deps: Record<string, string>) =>
    analyzeWithInternalAI({
      repo: "acme/app",
      analysisType: "pr",
      files: [{ filename, status: "added", additions: 1, deletions: 0, patch: code.split("\n").map((l) => `+${l}`).join("\n") }],
      fileContents: { [filename]: code, "package.json": JSON.stringify({ dependencies: deps }) },
    }).findings;

  it("flags model output reaching HTML and eval", () => {
    const code = "export async function render(el: HTMLElement) {\n  const res = await client.chat.completions.create({ model: \"m\", messages, max_tokens: 200 });\n  const html = res.choices[0].message.content;\n  el.innerHTML = html;\n}\n";
    const findings = withProject("src/lib/render.ts", code, { openai: "^5.0.0" });
    expect(findings.some((f) => /Model output reaches/.test(f.description) && f.line === 4)).toBe(true);
  });

  it("flags untrusted text in the system prompt", () => {
    const code = "export async function POST(req: Request) {\n  const { persona } = await req.json();\n  return anthropic.messages.create({ model: \"m\", max_tokens: 100, system: `You are ${persona}`, messages });\n}\n";
    const findings = withProject("src/app/api/chat/route.ts", code, { "@anthropic-ai/sdk": "^0.80.0" });
    expect(findings.some((f) => /system prompt/.test(f.description))).toBe(true);
  });

  it("knows Next.js 16 made params and searchParams async", () => {
    const page = "export default function Page({ searchParams }: { searchParams: { token?: string } }) {\n  return searchParams.token;\n}\n";
    const helper = "function buildPrompt(params: {\n  repo: string;\n}) {\n  return params.repo;\n}\n";
    expect(withProject("src/app/invite/page.tsx", page, { next: "16.0.0" }).find((f) => /Promise/.test(f.description))?.severity).toBe("high");
    expect(withProject("src/app/invite/page.tsx", page, { next: "14.2.0" }).some((f) => /Promise/.test(f.description))).toBe(false);
    expect(withProject("src/app/api/x/route.ts", helper, { next: "16.0.0" }).some((f) => /Promise/.test(f.description))).toBe(false);
  });

  it("catches redirect() swallowed by try/catch", () => {
    const code = "import { redirect } from \"next/navigation\";\nexport async function go() {\n  try {\n    redirect(\"/home\");\n  } catch (err) {\n    console.error(err);\n  }\n}\n";
    expect(withProject("src/app/actions.ts", code, { next: "16.0.0" }).some((f) => /swallows it/.test(f.description) && f.line === 4)).toBe(true);
  });

  it("checks Electron hardening only in Electron projects", () => {
    const code = "new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: false } });\n";
    expect(withProject("src/main.ts", code, { electron: "^30.0.0" }).filter((f) => /Electron window/.test(f.description)).length).toBe(1);
    expect(withProject("src/main.ts", code, { react: "^19.0.0" }).some((f) => /Electron window/.test(f.description))).toBe(false);
  });

  it("counts destructured props as one parameter and ignores setter calls in onChange", () => {
    const code = "export function Dot({ a, b, c, d, e, f }: Props) {\n  return <input onChange={(e) => setSearch(e.target.value)} />;\n}\n";
    const findings = withProject("src/components/dot.tsx", code, { react: "^19.0.0" });
    expect(findings.some((f) => /6\+ parameters|every keystroke/.test(f.description))).toBe(false);
  });

  it("finds the async body after a return type containing braces", () => {
    const code = "export async function load(): Promise<Array<{ id: string }>> {\n  const res = await fetch(\"/api\");\n  return res.json();\n}\n";
    expect(withProject("src/lib/load.ts", code, {}).some((f) => /never awaits/.test(f.description))).toBe(false);
  });
});

describe("repo scan", () => {
  const base = {
    repo: "acme/app",
    recentCommits: [],
    contributors: 3,
    meta: {},
    scanMode: "quick",
  };

  it("reports line numbers and keeps a clean repository healthy", () => {
    const keyFileContents = {
      "package.json": JSON.stringify({ dependencies: { next: "16.0.0", semver: "^7.6.0" }, devDependencies: { typescript: "5.9.0", eslint: "9.0.0", vitest: "4.0.0", jsdom: "29.0.0" } }),
      "src/lib/math.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "src/lib/math.test.ts": "import { add } from './math';\nit('adds', () => { expect(add(1, 2)).toBe(3); });\n",
      "src/lib/hash.ts": "import { createHash } from 'crypto';\n\nexport const tokenDigest = (token: string) => createHash('md5').update(token).digest('hex');\n",
    };
    const result = scanRepoWithInternalAI({
      ...base,
      fileTree: [...Object.keys(keyFileContents), ".github/workflows/ci.yml", ".env.example", "eslint.config.mjs"],
      keyFileContents,
    });
    const md5 = result.security.issues.find((f) => /MD5/.test(f.description));
    expect(md5?.line).toBe(3);
    expect(result.dependencies.risks.some((r) => /semver|jsdom/.test(r))).toBe(false);
    expect(result.security.score).toBeGreaterThan(60);
  });

  it("flags committed env files and outdated vulnerable dependency ranges", () => {
    const result = scanRepoWithInternalAI({
      ...base,
      fileTree: ["package.json", ".env", "src/index.ts"],
      keyFileContents: {
        "package.json": JSON.stringify({ dependencies: { semver: "^7.0.0", moment: "^2.29.0" } }),
        "src/index.ts": "export {};\n",
      },
    });
    expect(result.security.issues[0].severity).toBe("critical");
    expect(result.security.issues[0].description).toMatch(/Environment file/);
    expect(result.dependencies.risks.some((r) => r.startsWith("semver@"))).toBe(true);
    expect(result.dependencies.risks.some((r) => r.startsWith("moment@"))).toBe(true);
  });

  it("does not apply JavaScript rules to other languages", () => {
    const result = scanRepoWithInternalAI({
      ...base,
      fileTree: ["app/main.py"],
      keyFileContents: { "app/main.py": "if a == b:\n    var = 1\n" },
    });
    expect(result.codeQuality.issues.some((f) => /loose equality|`var`/i.test(f.description))).toBe(false);
  });
});
