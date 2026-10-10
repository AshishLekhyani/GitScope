import { EMPTY_PROJECT, maskSource, type EngineFinding, type FileCtx, type ProjectCtx } from "@/lib/internal-ai-engine";
import type { GraphResult } from "@/lib/internal-ai-graph";
import {
  AUTH_INDICATOR,
  CRON_AUTH,
  PUBLIC_ROUTE,
  RATE_LIMIT_INDICATOR,
  WEBHOOK_VERIFY,
  findHandlers,
} from "@/lib/internal-ai-rules";

export type ProjectKind =
  | "nextjs-app"
  | "remix-app"
  | "nuxt-app"
  | "sveltekit-app"
  | "astro-site"
  | "react-spa"
  | "vue-spa"
  | "angular-app"
  | "static-site"
  | "node-api"
  | "serverless-functions"
  | "node-library"
  | "cli-tool"
  | "vscode-extension"
  | "browser-extension"
  | "electron-app"
  | "tauri-app"
  | "react-native-app"
  | "python-web"
  | "python-library"
  | "python-data"
  | "go-service"
  | "go-cli"
  | "rust-service"
  | "rust-crate"
  | "java-service"
  | "rails-app"
  | "laravel-app"
  | "github-action"
  | "infrastructure"
  | "docs"
  | "unknown";

const KIND_LABEL: Record<ProjectKind, string> = {
  "nextjs-app": "full-stack web app",
  "remix-app": "full-stack web app",
  "nuxt-app": "full-stack web app",
  "sveltekit-app": "full-stack web app",
  "astro-site": "content site",
  "react-spa": "single-page app",
  "vue-spa": "single-page app",
  "angular-app": "single-page app",
  "static-site": "static site",
  "node-api": "API server",
  "serverless-functions": "serverless functions",
  "node-library": "npm library",
  "cli-tool": "command-line tool",
  "vscode-extension": "VS Code extension",
  "browser-extension": "browser extension",
  "electron-app": "desktop app",
  "tauri-app": "desktop app",
  "react-native-app": "mobile app",
  "python-web": "web service",
  "python-library": "Python package",
  "python-data": "data / ML project",
  "go-service": "Go service",
  "go-cli": "Go command-line tool",
  "rust-service": "Rust service",
  "rust-crate": "Rust crate",
  "java-service": "JVM service",
  "rails-app": "web app",
  "laravel-app": "web app",
  "github-action": "GitHub Action",
  "infrastructure": "infrastructure-as-code repository",
  "docs": "documentation repository",
  "unknown": "project",
};

export interface EndpointInfo {
  path: string;
  methods: string[];
  file: string;
  line: number;
  auth: "session" | "helper" | "proxy" | "signature" | "secret" | "public" | "none";
  rateLimited: boolean;
  validated: boolean;
  inputs: string[];
  effects: string[];
}

export interface AttackSurface {
  endpoints: EndpointInfo[];
  totalEndpoints: number;
  mutating: number;
  authenticated: number;
  rateLimited: number;
  validated: number;
  serverActions: number;
  webhooks: number;
  cronJobs: number;
  pages: number;
  clientComponents: number;
  serverComponents: number;
  llmCallSites: number;
  uploadHandlers: number;
}

export interface ProjectProfile {
  kind: ProjectKind;
  kinds: ProjectKind[];
  label: string;
  languages: Array<{ name: string; files: number; share: number }>;
  frameworks: string[];
  runtimes: string[];
  deployment: string[];
  dataStores: string[];
  auth: string[];
  integrations: string[];
  traits: string[];
  focus: string[];
  surface?: AttackSurface;
  majors: Record<string, number>;
}

export interface ScoreFactor {
  label: string;
  points: number;
  file?: string;
  line?: number;
  severity?: string;
}

export interface ScoreBreakdown {
  security: ScoreFactor[];
  quality: ScoreFactor[];
  performance: ScoreFactor[];
  testability: ScoreFactor[];
  dependencies: ScoreFactor[];
  health: ScoreFactor[];
  weightsRationale: string;
}

export interface ProfileInput {
  fileTree: string[];
  contents: Record<string, string>;
  prodDeps: Record<string, string>;
  devDeps: Record<string, string>;
  pkg: Record<string, unknown>;
}

const LANG_EXT: Array<[RegExp, string]> = [
  [/\.(?:ts|tsx|mts|cts)$/, "TypeScript"],
  [/\.(?:js|jsx|mjs|cjs)$/, "JavaScript"],
  [/\.py$/, "Python"],
  [/\.go$/, "Go"],
  [/\.rs$/, "Rust"],
  [/\.(?:java|kt|kts|scala)$/, "JVM"],
  [/\.rb$/, "Ruby"],
  [/\.php$/, "PHP"],
  [/\.cs$/, "C#"],
  [/\.swift$/, "Swift"],
  [/\.dart$/, "Dart"],
  [/\.(?:c|cc|cpp|h|hpp)$/, "C/C++"],
  [/\.(?:vue|svelte|astro)$/, "Components"],
  [/\.tf$/, "Terraform"],
  [/\.ipynb$/, "Notebooks"],
];

function firstMajor(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const m = /(\d+)(?:\.\d+)?/.exec(range);
  return m ? Number(m[1]) : undefined;
}

function find(contents: Record<string, string>, re: RegExp): string {
  for (const [file, content] of Object.entries(contents)) if (re.test(file)) return content;
  return "";
}

function pythonDeps(contents: Record<string, string>): Set<string> {
  const out = new Set<string>();
  const req = Object.entries(contents).filter(([f]) => /(?:^|\/)requirements[\w.-]*\.txt$/.test(f)).map(([, c]) => c).join("\n");
  for (const m of req.matchAll(/^\s*([A-Za-z0-9_.-]+)/gm)) out.add(m[1].toLowerCase());
  const pyproject = find(contents, /(?:^|\/)pyproject\.toml$/);
  for (const m of pyproject.matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:[<>=!~\[;]|["'])/g)) out.add(m[1].toLowerCase());
  for (const m of pyproject.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:["'{])/gm)) out.add(m[1].toLowerCase());
  const pipfile = find(contents, /(?:^|\/)Pipfile$/);
  for (const m of pipfile.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)) out.add(m[1].toLowerCase());
  return out;
}

function goDeps(contents: Record<string, string>): string {
  return find(contents, /(?:^|\/)go\.mod$/);
}

export function detectProfile(input: ProfileInput): ProjectProfile {
  const { fileTree, contents, pkg } = input;
  const deps: Record<string, string> = { ...input.devDeps, ...input.prodDeps };
  const has = (name: string) => name in deps;
  const hasAny = (...names: string[]) => names.some(has);
  const tree = (re: RegExp) => fileTree.some((f) => re.test(f));
  const py = pythonDeps(contents);
  const pyHas = (...names: string[]) => names.some((n) => py.has(n));
  const gomod = goDeps(contents);
  const cargo = find(contents, /(?:^|\/)Cargo\.toml$/);
  const gemfile = find(contents, /(?:^|\/)Gemfile$/);
  const composer = find(contents, /(?:^|\/)composer\.json$/);
  const jvm = find(contents, /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?)$/);
  const manifest = find(contents, /(?:^|\/)manifest\.json$/);

  const langCounts = new Map<string, number>();
  for (const f of fileTree) {
    if (/(?:^|\/)(?:node_modules|vendor|dist|build)\//.test(f)) continue;
    const lang = LANG_EXT.find(([re]) => re.test(f))?.[1];
    if (lang) langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  const codeTotal = [...langCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const languages = [...langCounts.entries()]
    .map(([name, files]) => ({ name, files, share: Math.round((files / codeTotal) * 100) }))
    .sort((a, b) => b.files - a.files);

  const majors: Record<string, number> = {};
  for (const name of ["next", "react", "vue", "svelte", "@angular/core", "express", "fastify", "nuxt", "astro", "electron", "expo", "react-native", "@sveltejs/kit", "@remix-run/react", "typescript", "prisma", "@prisma/client", "next-auth"]) {
    const major = firstMajor(deps[name]);
    if (major !== undefined) majors[name] = major;
  }

  const kinds: ProjectKind[] = [];
  const add = (k: ProjectKind) => { if (!kinds.includes(k)) kinds.push(k); };

  if (tree(/^action\.ya?ml$/)) add("github-action");
  if (/"manifest_version"\s*:/.test(manifest)) add("browser-extension");
  if (has("electron")) add("electron-app");
  if (has("@tauri-apps/api") || tree(/^src-tauri\//)) add("tauri-app");
  if (hasAny("react-native", "expo")) add("react-native-app");
  if (pkg.engines && typeof pkg.engines === "object" && "vscode" in (pkg.engines as Record<string, unknown>)) add("vscode-extension");
  if (has("next")) add("nextjs-app");
  if (hasAny("@remix-run/react", "@remix-run/node", "react-router") && !has("next") && tree(/(?:^|\/)app\/routes\//)) add("remix-app");
  if (has("nuxt")) add("nuxt-app");
  if (has("@sveltejs/kit")) add("sveltekit-app");
  if (has("astro")) add("astro-site");
  if (has("@angular/core")) add("angular-app");
  if (hasAny("@docusaurus/core", "vitepress", "@11ty/eleventy", "gatsby", "hexo") || tree(/^_config\.yml$/) || (tree(/^config\.toml$/) && tree(/^content\//))) add("static-site");
  if (has("react") && !kinds.some((k) => /nextjs|remix|astro|react-native|electron/.test(k)) && hasAny("vite", "react-scripts", "parcel", "@vitejs/plugin-react", "webpack")) add("react-spa");
  if (has("vue") && !has("nuxt")) add("vue-spa");
  if (hasAny("express", "fastify", "koa", "@hapi/hapi", "@nestjs/core", "hono", "elysia", "restify")) add("node-api");
  if (tree(/^serverless\.ya?ml$/) || tree(/^netlify\/functions\//) || (tree(/^api\/[^/]+\.[jt]s$/) && !has("next"))) add("serverless-functions");
  if (pkg.bin || hasAny("commander", "yargs", "@oclif/core", "cac", "clipanion", "meow", "citty")) add("cli-tool");
  const isPrivate = pkg.private === true;
  if (!isPrivate && (pkg.exports || pkg.main || pkg.module || pkg.types) && !kinds.some((k) => /app|site|api|extension|functions/.test(k))) add("node-library");
  if (pyHas("django", "flask", "fastapi", "starlette", "sanic", "tornado", "aiohttp", "litestar")) add("python-web");
  if (pyHas("pandas", "numpy", "scikit-learn", "sklearn", "torch", "tensorflow", "jupyter", "polars", "xgboost", "transformers") || tree(/\.ipynb$/)) add("python-data");
  if ((tree(/(?:^|\/)setup\.py$/) || /\[project\]|\[tool\.poetry\]/.test(find(contents, /(?:^|\/)pyproject\.toml$/))) && !kinds.includes("python-web")) add("python-library");
  if (gomod) {
    if (/spf13\/cobra|urfave\/cli|alecthomas\/kong/.test(gomod)) add("go-cli");
    if (/gin-gonic|labstack\/echo|gofiber|go-chi|gorilla\/mux|grpc/.test(gomod) || tree(/(?:^|\/)cmd\/[^/]*server/)) add("go-service");
    if (!kinds.some((k) => k.startsWith("go-"))) add(tree(/(?:^|\/)main\.go$/) ? "go-service" : "go-cli");
  }
  if (cargo) add(/actix|axum|rocket|warp|tonic/.test(cargo) ? "rust-service" : "rust-crate");
  if (/spring-boot|quarkus|micronaut|ktor/.test(jvm)) add("java-service");
  if (/^\s*gem\s+["']rails["']/m.test(gemfile)) add("rails-app");
  if (/laravel\/framework/.test(composer)) add("laravel-app");
  const tfFiles = fileTree.filter((f) => /\.tf$/.test(f)).length;
  if (tfFiles > 0 && tfFiles >= codeTotal * 0.5) add("infrastructure");
  const mdFiles = fileTree.filter((f) => /\.mdx?$/.test(f)).length;
  if (kinds.length === 0 && mdFiles > codeTotal) add("docs");
  if (kinds.length === 0) add("unknown");

  const frameworks: string[] = [];
  const fw = (cond: boolean, name: string) => { if (cond && !frameworks.includes(name)) frameworks.push(name); };
  fw(has("next"), `Next.js${majors.next ? ` ${majors.next}` : ""}${tree(/(?:^|\/)app\/.*page\.[jt]sx?$/) ? " (App Router)" : tree(/(?:^|\/)pages\//) ? " (Pages Router)" : ""}`);
  fw(has("react") && !has("next"), `React${majors.react ? ` ${majors.react}` : ""}`);
  fw(has("vue"), "Vue");
  fw(has("svelte"), "Svelte");
  fw(has("@angular/core"), "Angular");
  fw(has("astro"), "Astro");
  fw(has("express"), "Express");
  fw(has("fastify"), "Fastify");
  fw(has("@nestjs/core"), "NestJS");
  fw(has("hono"), "Hono");
  fw(has("electron"), "Electron");
  fw(hasAny("react-native", "expo"), has("expo") ? "Expo" : "React Native");
  fw(pyHas("django"), "Django");
  fw(pyHas("flask"), "Flask");
  fw(pyHas("fastapi"), "FastAPI");
  fw(/gin-gonic/.test(gomod), "Gin");
  fw(/labstack\/echo/.test(gomod), "Echo");
  fw(/gofiber/.test(gomod), "Fiber");
  fw(/axum/.test(cargo), "Axum");
  fw(/actix/.test(cargo), "Actix");
  fw(/spring-boot/.test(jvm), "Spring Boot");
  fw(/rails/.test(gemfile), "Rails");
  fw(/laravel\/framework/.test(composer), "Laravel");
  fw(hasAny("@reduxjs/toolkit", "redux"), "Redux");
  fw(hasAny("@tanstack/react-query"), "TanStack Query");
  fw(hasAny("tailwindcss"), "Tailwind CSS");

  const schema = find(contents, /(?:^|\/)schema\.prisma$/);
  const prismaProvider = /provider\s*=\s*"(postgresql|mysql|sqlite|mongodb|sqlserver|cockroachdb)"/.exec(schema)?.[1];
  const dataStores: string[] = [];
  const ds = (cond: boolean, name: string) => { if (cond && !dataStores.includes(name)) dataStores.push(name); };
  ds(hasAny("prisma", "@prisma/client"), `Prisma${prismaProvider ? ` (${prismaProvider === "postgresql" ? "PostgreSQL" : prismaProvider})` : ""}`);
  ds(has("drizzle-orm"), "Drizzle ORM");
  ds(hasAny("mongoose", "mongodb"), "MongoDB");
  ds(hasAny("ioredis", "redis", "@upstash/redis"), "Redis");
  ds(hasAny("@supabase/supabase-js"), "Supabase");
  ds(hasAny("firebase", "firebase-admin"), "Firebase");
  ds(hasAny("pg", "postgres", "@neondatabase/serverless", "@vercel/postgres"), "PostgreSQL");
  ds(hasAny("mysql", "mysql2", "@planetscale/database"), "MySQL");
  ds(hasAny("better-sqlite3", "sqlite3", "@libsql/client"), "SQLite");
  ds(pyHas("sqlalchemy"), "SQLAlchemy");
  ds(pyHas("psycopg2", "psycopg2-binary", "psycopg", "asyncpg"), "PostgreSQL");
  ds(pyHas("pymongo", "motor"), "MongoDB");

  const auth: string[] = [];
  const au = (cond: boolean, name: string) => { if (cond && !auth.includes(name)) auth.push(name); };
  au(hasAny("next-auth", "@auth/core", "@auth/nextjs"), "NextAuth / Auth.js");
  au(hasAny("@clerk/nextjs", "@clerk/clerk-react", "@clerk/express"), "Clerk");
  au(hasAny("lucia", "better-auth"), has("lucia") ? "Lucia" : "Better Auth");
  au(hasAny("passport"), "Passport");
  au(hasAny("@supabase/auth-helpers-nextjs", "@supabase/ssr"), "Supabase Auth");
  au(hasAny("firebase") && fileTree.some((f) => /auth/i.test(f)), "Firebase Auth");
  au(hasAny("jose", "jsonwebtoken"), "JWT");
  au(hasAny("@auth0/nextjs-auth0", "auth0"), "Auth0");
  au(pyHas("django"), "Django auth");
  au(pyHas("flask-login", "flask_login"), "Flask-Login");

  const integrations: string[] = [];
  const ig = (cond: boolean, name: string) => { if (cond && !integrations.includes(name)) integrations.push(name); };
  ig(hasAny("@anthropic-ai/sdk") || pyHas("anthropic"), "Anthropic");
  ig(hasAny("openai") || pyHas("openai"), "OpenAI");
  ig(hasAny("@google/generative-ai", "@google/genai") || pyHas("google-generativeai", "google-genai"), "Gemini");
  ig(hasAny("ai", "@ai-sdk/openai", "@ai-sdk/anthropic"), "Vercel AI SDK");
  ig(hasAny("langchain", "@langchain/core") || pyHas("langchain"), "LangChain");
  ig(hasAny("groq-sdk") || pyHas("groq"), "Groq");
  ig(hasAny("stripe") || pyHas("stripe"), "Stripe");
  ig(hasAny("@lemonsqueezy/lemonsqueezy.js", "@paddle/paddle-node-sdk", "razorpay"), "Payments");
  ig(hasAny("resend", "nodemailer", "@sendgrid/mail", "postmark"), "Email");
  ig(hasAny("@octokit/rest", "@octokit/app", "octokit") || fileTree.some((f) => /github-app|octokit/i.test(f)), "GitHub API");
  ig(hasAny("@upstash/ratelimit"), "Upstash Ratelimit");
  ig(hasAny("@sentry/nextjs", "@sentry/node", "@sentry/react") || pyHas("sentry-sdk"), "Sentry");
  ig(hasAny("bullmq", "bull", "inngest", "@trigger.dev/sdk"), "Background jobs");
  ig(hasAny("socket.io", "ws", "pusher", "ably"), "Realtime");
  ig(hasAny("@aws-sdk/client-s3", "@vercel/blob", "uploadthing", "cloudinary"), "File storage");

  const deployment: string[] = [];
  const dp = (cond: boolean, name: string) => { if (cond && !deployment.includes(name)) deployment.push(name); };
  dp(tree(/^vercel\.json$|^\.vercel\//), "Vercel");
  dp(tree(/^netlify\.toml$/), "Netlify");
  dp(tree(/(?:^|\/)Dockerfile$/), "Docker");
  dp(tree(/(?:^|\/)(?:k8s|kubernetes|helm)\//), "Kubernetes");
  dp(tree(/^fly\.toml$/), "Fly.io");
  dp(tree(/^railway\.(?:json|toml)$/), "Railway");
  dp(tree(/^render\.yaml$/), "Render");
  dp(tree(/^Procfile$/), "Heroku");
  dp(tree(/^serverless\.ya?ml$/), "Serverless Framework");
  dp(tree(/^wrangler\.toml$/), "Cloudflare Workers");

  const runtimes: string[] = [];
  const rt = (cond: boolean, name: string) => { if (cond && !runtimes.includes(name)) runtimes.push(name); };
  const engines = (pkg.engines ?? {}) as Record<string, string>;
  rt(Object.keys(deps).length > 0 || Boolean(engines.node), `Node.js${engines.node ? ` ${engines.node}` : ""}`);
  rt(tree(/^bun\.lockb?$/), "Bun");
  rt(tree(/^deno\.jsonc?$/), "Deno");
  rt(Object.values(contents).some((c) => /export\s+const\s+runtime\s*=\s*["']edge["']/.test(c)), "Edge runtime");
  rt(py.size > 0 || langCounts.has("Python"), "Python");
  rt(Boolean(gomod), `Go${/^go\s+(\d+\.\d+)/m.exec(gomod)?.[1] ? ` ${/^go\s+(\d+\.\d+)/m.exec(gomod)![1]}` : ""}`);

  const allCode = Object.entries(contents).filter(([f]) => /\.(?:[cm]?[jt]sx?|py|go|rb|php)$/.test(f)).map(([, c]) => c);
  const anyCode = (re: RegExp) => allCode.some((c) => re.test(c));
  const traits: string[] = [];
  const tr = (cond: boolean, name: string) => { if (cond && !traits.includes(name)) traits.push(name); };
  tr(integrations.some((i) => /Anthropic|OpenAI|Gemini|AI SDK|LangChain|Groq/.test(i)), "ai-powered");
  tr(integrations.includes("Stripe") || integrations.includes("Payments"), "payments");
  tr(auth.length > 0, "authentication");
  tr(/\b(?:orgId|organizationId|tenantId|workspaceId|teamId)\b|model\s+(?:Organization|Org|Tenant|Workspace|Team)\b/.test(schema) || anyCode(/\b(?:orgId|tenantId|workspaceId)\b/), "multi-tenant");
  tr(/\b(?:email|phone|address|dateOfBirth|dob|ssn|ipAddress)\b/i.test(schema), "personal-data");
  tr(/\b(?:accessToken|refreshToken|access_token|refresh_token|apiKey|encryptedKey)\b/.test(schema), "stores-credentials");
  tr(integrations.includes("File storage") || hasAny("multer", "formidable", "busboy") || anyCode(/formData\s*\(\s*\)[\s\S]{0,200}instanceof\s+File/), "file-uploads");
  tr(integrations.includes("Background jobs") || /"crons"\s*:/.test(find(contents, /^vercel\.json$/)) || tree(/\/cron\//), "background-jobs");
  tr(hasAny("react-markdown", "marked", "markdown-it", "@tiptap/react", "quill", "slate", "lexical", "remark"), "renders-user-content");
  tr(integrations.includes("Email"), "sends-email");
  tr(fileTree.some((f) => /webhook/i.test(f)), "receives-webhooks");
  tr(integrations.includes("Realtime"), "realtime");
  tr(kinds.includes("cli-tool"), "cli");

  const primary = kinds[0];
  const lead = frameworks[0] ?? languages[0]?.name ?? "";
  const facets: string[] = [];
  if (dataStores.length) facets.push(dataStores.slice(0, 2).join(" + "));
  if (auth.length) facets.push(auth[0]);
  const ai = integrations.filter((i) => /Anthropic|OpenAI|Gemini|Groq|LangChain|AI SDK/.test(i));
  if (ai.length) facets.push(`AI-powered (${ai.join(", ")})`);
  if (integrations.includes("Stripe")) facets.push("Stripe payments");
  if (deployment.length) facets.push(`deployed on ${deployment.join(" / ")}`);
  const label = `${lead ? `${lead} ` : ""}${KIND_LABEL[primary]}${facets.length ? ` · ${facets.join(" · ")}` : ""}`;

  const focus: string[] = [];
  const fc = (cond: boolean, text: string) => { if (cond) focus.push(text); };
  fc(kinds.some((k) => /nextjs|remix|nuxt|sveltekit|node-api|python-web|rails|laravel|java-service|go-service|rust-service|serverless/.test(k)), "Authorization, rate limiting and input validation on every route handler and server action");
  fc(traits.includes("ai-powered"), "LLM security: prompt injection, model output reaching HTML/SQL/shell, provider keys in the browser, unbounded token spend");
  fc(kinds.includes("nextjs-app"), `Next.js${majors.next ? ` ${majors.next}` : ""}-specific pitfalls: async request APIs, server/client bundle boundaries, NEXT_PUBLIC_ exposure, cached personalized data`);
  fc(traits.includes("payments"), "Payment integrity: webhook signature verification and server-side price/amount checks");
  fc(traits.includes("multi-tenant"), "Tenant isolation: every query on tenant data must be scoped to the caller's organization");
  fc(traits.includes("stores-credentials"), "Third-party tokens at rest: encryption and least-privilege scopes");
  fc(traits.includes("file-uploads"), "Upload handling: type/size validation and storage path control");
  fc(kinds.includes("node-library") || kinds.includes("python-library") || kinds.includes("rust-crate"), "Public API quality, packaging metadata and test coverage — consumers depend on both");
  fc(kinds.includes("cli-tool") || kinds.includes("go-cli"), "Shell and filesystem handling of untrusted files and environment (operator arguments are trusted)");
  fc(kinds.includes("electron-app"), "Electron hardening: contextIsolation, nodeIntegration, sandbox and openExternal");
  fc(kinds.includes("browser-extension"), "Extension permissions, content-script messaging and CSP");
  fc(kinds.includes("react-native-app"), "Mobile storage of tokens, cleartext traffic and WebView exposure");
  fc(kinds.includes("github-action"), "Action runtime support and script injection through inputs");
  fc(kinds.includes("infrastructure"), "Public network exposure, encryption at rest and IAM wildcards");
  fc(focus.length === 0, "General code health, secrets and dependency risk");

  return {
    kind: primary,
    kinds,
    label,
    languages: languages.slice(0, 6),
    frameworks,
    runtimes,
    deployment,
    dataStores,
    auth,
    integrations,
    traits,
    focus,
    majors,
  };
}

export function projectCtxFrom(profile: ProjectProfile, deps: Record<string, string>, contents: Record<string, string>): ProjectCtx {
  const proxy = find(contents, /(?:^|\/)(?:src\/)?(?:middleware|proxy)\.[jt]s$/);
  const nextConfig = find(contents, /(?:^|\/)next\.config\.[cm]?[jt]s$/);
  return {
    ...EMPTY_PROJECT,
    globalAuth: /\bgetToken\s*\(|\bwithAuth\b|\bauth\s*\(|clerkMiddleware|authMiddleware|NextAuth|getSession\s*\(|updateSession\s*\(|supabase\s*\.\s*auth/.test(proxy),
    globalRateLimit: /rate.?limit|ratelimit|limiter/i.test(proxy),
    reactCompiler: "babel-plugin-react-compiler" in deps || /reactCompiler\s*:\s*true/.test(nextConfig),
    deps,
    kinds: profile.kinds,
    traits: profile.traits,
    majors: profile.majors,
  };
}

const VALIDATION = /\.(?:parse|safeParse|parseAsync|safeParseAsync)\s*\(|\bz\s*\.\s*\w+\(|\bvalidate\w*\s*\(|\bJoi\s*\.|\byup\s*\.|\bv\s*\.\s*parse\s*\(|class-validator|\bBaseModel\b/;
const DB_WRITE_EFFECT = /\b(?:prisma|db|tx|knex|supabase)\s*\.\s*\w+\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\.\s*(?:insertOne|insertMany|updateOne|deleteOne|deleteMany|save|destroy)\s*\(|\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
const LLM_CALL = /\.\s*messages\s*\.\s*(?:create|stream)\s*\(|\.\s*chat\s*\.\s*completions\s*\.\s*create\s*\(|\.\s*responses\s*\.\s*create\s*\(|\b(?:generateText|streamText|generateObject|streamObject)\s*\(|\.\s*generateContent(?:Stream)?\s*\(|\bcallAI\w*\s*\(|\.\s*invoke\s*\(/;

function effectsOf(body: string): string[] {
  const out: string[] = [];
  if (DB_WRITE_EFFECT.test(body)) out.push("db-write");
  else if (/\b(?:prisma|db|tx)\s*\.\s*\w+\s*\.\s*(?:find\w*|count|aggregate|groupBy)\s*\(/.test(body)) out.push("db-read");
  if (/sendMail|sendEmail|send\w*Email|resend\s*\.\s*emails|transporter\s*\.\s*sendMail/i.test(body)) out.push("email");
  if (LLM_CALL.test(body)) out.push("ai");
  if (/\bstripe\s*\.|checkout\s*\.\s*sessions|paymentIntents/.test(body)) out.push("payment");
  if (/(?<![.\w$])fetch\s*\(\s*(?!["'`]\/)/.test(body)) out.push("outbound-http");
  if (/\b(?:readFile|writeFile|createReadStream|unlink|mkdir)\w*\s*\(/.test(body)) out.push("filesystem");
  if (/\b(?:exec|execSync|spawn|execFile)\s*\(/.test(body)) out.push("shell");
  return out;
}

function inputsOf(body: string): string[] {
  const out: string[] = [];
  if (/\b(?:req|request)\s*\.\s*(?:json|formData|text|body)\b/.test(body)) out.push("body");
  if (/\bsearchParams\b|\breq\s*\.\s*query\b/.test(body)) out.push("query");
  if (/\bparams\b/.test(body)) out.push("path");
  if (/\b(?:req|request)\s*\.\s*headers\b|\bheaders\s*\(\s*\)/.test(body)) out.push("headers");
  if (/\bcookies\b/.test(body)) out.push("cookies");
  return out;
}

export function buildSurface(contexts: FileCtx[], graph: GraphResult | null, project: ProjectCtx): AttackSurface {
  const endpoints: EndpointInfo[] = [];
  let serverActions = 0;
  let pages = 0;
  let clientComponents = 0;
  let serverComponents = 0;
  let llmCallSites = 0;
  let uploadHandlers = 0;

  for (const ctx of contexts) {
    if (ctx.role !== "source") continue;
    const text = ctx.text;
    llmCallSites += (text.match(new RegExp(LLM_CALL.source, "g")) ?? []).length;
    if (ctx.lang === "js") {
      if (/(?:^|\/)app\/.*page\.[jt]sx?$/.test(ctx.filename)) pages++;
      if (/\.(?:tsx|jsx)$/.test(ctx.filename)) {
        if (ctx.isClient) clientComponents++;
        else if (/(?:^|\/)app\//.test(ctx.filename)) serverComponents++;
      }
      if (/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(ctx.raw)) {
        serverActions += (ctx.code.match(/export\s+(?:default\s+)?async\s+function\s+\w+/g) ?? []).length;
      }
    }

    const handlers: Array<{ method: string; offset: number; bodyText: string; path: string }> = [];
    if (ctx.lang === "js") handlers.push(...findHandlers(ctx));
    if (ctx.lang === "py") {
      for (const m of ctx.text.matchAll(/@\w+\s*\.\s*(get|post|put|patch|delete|route|api_route)\s*\(\s*["']([^"']+)["']([^\n]*)\)\s*\n((?:\s*@[^\n]*\n)*)\s*(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/g)) {
        const method = m[1] === "route" || m[1] === "api_route" ? (/methods\s*=\s*\[([^\]]*)\]/.exec(m[3])?.[1].replace(/["'\s]/g, "").toUpperCase() || "GET") : m[1].toUpperCase();
        const bodyEnd = ctx.text.indexOf("\n@", m.index + m[0].length);
        const body = ctx.text.slice(m.index, bodyEnd < 0 ? ctx.text.length : bodyEnd);
        for (const meth of method.split(",")) handlers.push({ method: meth, offset: m.index, bodyText: body, path: m[2] });
      }
    }
    if (handlers.length === 0) continue;

    const fileAuth = AUTH_INDICATOR.test(text) || /Depends\s*\(|login_required|@requires_auth|IsAuthenticated/.test(text);
    const fileLimited = RATE_LIMIT_INDICATOR.test(text) || Boolean(graph?.rateLimitedFiles.has(ctx.filename)) || project.globalRateLimit;
    const fileValidated = VALIDATION.test(text);
    const byPath = new Map<string, EndpointInfo>();
    for (const h of handlers) {
      let auth: EndpointInfo["auth"];
      if (/getServerSession|getSession\s*\(|\bauth\s*\(\s*\)|currentUser|getToken|jwtVerify|verifyToken|Depends\s*\(|login_required/.test(h.bodyText)) auth = "session";
      else if (AUTH_INDICATOR.test(h.bodyText) || graph?.authenticatedFiles.has(ctx.filename)) auth = "helper";
      else if (/webhook/i.test(ctx.filename) && WEBHOOK_VERIFY.test(text)) auth = "signature";
      else if (/cron/i.test(ctx.filename) && CRON_AUTH.test(text)) auth = "secret";
      else if (fileAuth) auth = "session";
      else if (PUBLIC_ROUTE.test(h.path) || PUBLIC_ROUTE.test(ctx.filename)) auth = "public";
      else if (project.globalAuth) auth = "proxy";
      else auth = "none";
      const key = `${h.path}`;
      const prev = byPath.get(key);
      if (prev) {
        if (!prev.methods.includes(h.method)) prev.methods.push(h.method);
        if (auth === "none") prev.auth = "none";
        prev.effects = [...new Set([...prev.effects, ...effectsOf(h.bodyText)])];
        prev.inputs = [...new Set([...prev.inputs, ...inputsOf(h.bodyText)])];
        continue;
      }
      const effects = effectsOf(h.bodyText);
      if (/formData\s*\(\s*\)[\s\S]{0,400}(?:File|Blob|arrayBuffer)/.test(h.bodyText) || /\bUploadFile\b/.test(h.bodyText)) {
        effects.push("upload");
        uploadHandlers++;
      }
      byPath.set(key, {
        path: h.path.length > 80 ? `${h.path.slice(0, 77)}…` : h.path,
        methods: [h.method],
        file: ctx.filename,
        line: ctx.lines.lineOf(h.offset),
        auth,
        rateLimited: fileLimited,
        validated: VALIDATION.test(h.bodyText) || fileValidated,
        inputs: inputsOf(h.bodyText),
        effects,
      });
    }
    endpoints.push(...byPath.values());
  }

  const isMutating = (e: EndpointInfo) => e.methods.some((m) => /POST|PUT|PATCH|DELETE|\*/.test(m));
  const mutating = endpoints.filter(isMutating);
  const risk = (e: EndpointInfo) =>
    (isMutating(e) ? 4 : 0) +
    (e.auth === "none" ? 6 : e.auth === "public" ? 2 : 0) +
    (e.rateLimited ? 0 : 1) +
    (e.validated ? 0 : 1) +
    (e.effects.includes("db-write") ? 2 : 0) +
    (e.effects.some((x) => /payment|shell|filesystem|ai|email/.test(x)) ? 2 : 0);
  const sorted = [...endpoints].sort((a, b) => risk(b) - risk(a) || a.path.localeCompare(b.path));

  return {
    endpoints: sorted.slice(0, 80),
    totalEndpoints: endpoints.length,
    mutating: mutating.length,
    authenticated: mutating.filter((e) => e.auth !== "none" && e.auth !== "public").length,
    rateLimited: mutating.filter((e) => e.rateLimited).length,
    validated: mutating.filter((e) => e.validated).length,
    serverActions,
    webhooks: endpoints.filter((e) => /webhook/i.test(e.path) || /webhook/i.test(e.file)).length,
    cronJobs: endpoints.filter((e) => /cron/i.test(e.path) || /cron/i.test(e.file)).length,
    pages,
    clientComponents,
    serverComponents,
    llmCallSites,
    uploadHandlers,
  };
}

export interface ProfileIssue {
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "quality" | "config";
  file?: string;
  description: string;
  suggestion: string;
}

export function profileIssues(profile: ProjectProfile, input: ProfileInput): ProfileIssue[] {
  const out: ProfileIssue[] = [];
  const { pkg, fileTree, contents } = input;
  const tree = (re: RegExp) => fileTree.some((f) => re.test(f));

  if (profile.kinds.includes("node-library")) {
    const hasTsSources = tree(/^src\/.*\.tsx?$/);
    if (!pkg.files && !tree(/^\.npmignore$/)) {
      out.push({ severity: "medium", category: "quality", file: "package.json", description: "Library has no \"files\" allowlist or .npmignore — `npm publish` ships everything in the repo (tests, fixtures, configs, potentially .env files).", suggestion: "Add \"files\": [\"dist\"] (or your build output) to package.json and check the tarball with `npm pack --dry-run`." });
    }
    if (hasTsSources && !pkg.types && !pkg.typings && !(typeof pkg.exports === "object" && JSON.stringify(pkg.exports).includes("types"))) {
      out.push({ severity: "medium", category: "quality", file: "package.json", description: "TypeScript library without a \"types\" entry — consumers get `any` for your whole API.", suggestion: "Emit declarations (declaration: true) and point \"types\" (or exports[\".\"].types) at them." });
    }
    const prod = (pkg.dependencies ?? {}) as Record<string, string>;
    const misplaced = ["react", "react-dom", "vue", "svelte", "@angular/core"].filter((d) => d in prod);
    if (misplaced.length > 0) {
      out.push({ severity: "medium", category: "quality", file: "package.json", description: `${misplaced.join(", ")} listed in "dependencies" of a library — consumers end up with two copies (broken hooks/context, larger bundles).`, suggestion: "Move framework packages to \"peerDependencies\" (and devDependencies for local development)." });
    }
    if (!pkg.license) out.push({ severity: "low", category: "quality", file: "package.json", description: "Library has no \"license\" field — many companies can't legally depend on unlicensed packages.", suggestion: "Add a license (MIT, Apache-2.0, …) to package.json and a LICENSE file." });
    if (!pkg.engines) out.push({ severity: "low", category: "quality", file: "package.json", description: "No \"engines\" field — consumers on unsupported Node versions get confusing runtime errors instead of an install-time warning.", suggestion: "Declare the supported range, e.g. \"engines\": { \"node\": \">=20\" }." });
  }

  if (profile.kinds.includes("cli-tool") && typeof pkg.bin === "object") {
    for (const binPath of Object.values(pkg.bin as Record<string, string>)) {
      const normalized = binPath.replace(/^\.\//, "");
      const content = contents[normalized];
      if (content !== undefined && !content.startsWith("#!")) {
        out.push({ severity: "high", category: "quality", file: normalized, description: `CLI entry ${normalized} has no shebang line — the installed command fails to run on macOS/Linux.`, suggestion: "Start the file with `#!/usr/bin/env node` (and keep the build from stripping it)." });
      }
    }
  }

  if (profile.kinds.includes("github-action")) {
    const action = Object.entries(contents).find(([f]) => /^action\.ya?ml$/.test(f))?.[1] ?? "";
    const runtime = /using\s*:\s*["']?(node1[0-9]|node12|node16)["']?/.exec(action)?.[1];
    if (runtime) out.push({ severity: "high", category: "quality", file: "action.yml", description: `Action runs on deprecated ${runtime} — GitHub forces newer runtimes and warns every workflow that uses it.`, suggestion: "Switch to `using: node20` (or node24) and rebuild the bundled dist." });
  }

  return out;
}

export interface HealthWeights {
  security: number;
  quality: number;
  testability: number;
  dependencies: number;
  performance: number;
  rationale: string;
}

export function healthWeights(profile: ProjectProfile): HealthWeights {
  const k = profile.kinds;
  if (k.includes("node-library") || k.includes("python-library") || k.includes("rust-crate")) {
    return { security: 0.15, quality: 0.3, testability: 0.3, dependencies: 0.2, performance: 0.05, rationale: "Library weighting: consumers depend on API quality, tests and a clean dependency tree more than on route security." };
  }
  if (k.includes("cli-tool") || k.includes("go-cli")) {
    return { security: 0.2, quality: 0.28, testability: 0.27, dependencies: 0.2, performance: 0.05, rationale: "CLI weighting: correctness and tests dominate; operators control the arguments." };
  }
  if (k.includes("static-site") || k.includes("docs") || k.includes("astro-site")) {
    return { security: 0.15, quality: 0.3, testability: 0.15, dependencies: 0.25, performance: 0.15, rationale: "Static-site weighting: dependency health and performance matter more than server security." };
  }
  if (profile.traits.some((t) => /payments|personal-data|stores-credentials|ai-powered/.test(t))) {
    return { security: 0.32, quality: 0.2, testability: 0.2, dependencies: 0.18, performance: 0.1, rationale: `Security weighted up: the app handles ${profile.traits.filter((t) => /payments|personal-data|stores-credentials|ai-powered/.test(t)).map((t) => t.replace(/-/g, " ")).join(", ")}.` };
  }
  return { security: 0.28, quality: 0.22, testability: 0.22, dependencies: 0.18, performance: 0.1, rationale: "Standard application weighting." };
}

const CLI_ARGV = /process\.argv|sys\.argv|os\.Args/;

export function calibrateFindings(findings: EngineFinding[], profile: ProjectProfile): EngineFinding[] {
  const k = profile.kinds;
  const isCli = k.includes("cli-tool") || k.includes("go-cli");
  const isLibraryLike = k.some((x) => /library|crate|static-site|docs|github-action|vscode-extension/.test(x));
  const isServer = k.some((x) => /nextjs|remix|nuxt|sveltekit|node-api|python-web|rails|laravel|java-service|go-service|rust-service|serverless/.test(x));
  return findings.flatMap((f): EngineFinding[] => {
    if (isCli && /^(?:taint|xfile|interproc)-/.test(f.ruleId) && CLI_ARGV.test(f.description)) {
      return [{ ...f, severity: "low", confidence: 0.5, description: `${f.description} (CLI argument: the operator running the tool controls this value, so this is only a risk if the tool is invoked with untrusted input.)` }];
    }
    if ((isCli || isLibraryLike) && /^(?:console-log-debug|missing-rate-limit|fetch-no-timeout)$/.test(f.ruleId)) return [];
    if (isCli && f.ruleId === "sync-file-io") return [];
    if (!isServer && f.ruleId === "missing-pagination") return [{ ...f, severity: "low" }];
    if (profile.traits.includes("multi-tenant") && f.ruleId === "idor-risk") return [{ ...f, severity: "high", confidence: Math.max(f.confidence, 0.7), description: `${f.description} This is a multi-tenant app, so a missing ownership check exposes other organizations' data.` }];
    if (profile.traits.includes("payments") && f.ruleId === "webhook-no-signature") return [{ ...f, severity: "critical" }];
    return [f];
  });
}

export function parsePackageJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(maskSource(raw, "json").text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
