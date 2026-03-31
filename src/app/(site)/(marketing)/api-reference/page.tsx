import { Code2, Server, Globe } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";

export default function APIPage() {
  return (
    <div className="mx-auto max-w-5xl px-6">
      <div className="mb-16">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">API Reference</h1>
        <p className="mt-4 text-xl text-muted-foreground">Automate your engineering intelligence with the GitScope REST API.</p>
      </div>

      <div className="grid gap-12 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-12">
          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Authentication</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              Authenticate your requests using a Bearer token. All API requests must be made over HTTPS. 
              Tokens can be generated in your <span className="text-primary hover:underline cursor-pointer">Workspace Settings</span>.
            </p>
            <div className="rounded-xl border border-white/5 bg-[#0b1326] p-4 font-mono text-xs text-indigo-300">
              curl -H &quot;Authorization: Bearer YOUR_TOKEN&quot; \
              https://api.gitscope.ai/v1/repos/:owner/:repo
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Endpoints</h2>
            <div className="space-y-6">
              <div className="rounded-xl border border-white/5 bg-surface-container p-6">
                <div className="mb-2 flex items-center gap-3">
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">GET</span>
                  <code className="text-sm font-bold">/v1/repos/:owner/:repo</code>
                </div>
                <p className="text-xs text-muted-foreground">Retrieve full telemetry for a synchronized repository.</p>
              </div>

              <div className="rounded-xl border border-white/5 bg-surface-container p-6">
                <div className="mb-2 flex items-center gap-3">
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">GET</span>
                  <code className="text-sm font-bold">/v1/benchmarks/:a/:b</code>
                </div>
                <p className="text-xs text-muted-foreground">Retrieve cross-stack benchmarking metadata between two repositories.</p>
              </div>

              <div className="rounded-xl border border-white/5 bg-surface-container p-6">
                <div className="mb-2 flex items-center gap-3">
                  <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-400">POST</span>
                  <code className="text-sm font-bold">/v1/forecast</code>
                </div>
                <p className="text-xs text-muted-foreground">Trigger a new AI velocity forecast for the current workspace cluster.</p>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/5 bg-[#171f33]/80 p-6 shadow-2xl backdrop-blur-xl">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">API Limits</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Rate Limit (Standard)</span>
                <span className="font-bold text-foreground">1k req/hr</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Rate Limit (Enterprise)</span>
                <span className="font-bold text-emerald-400">Unlimited</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Concurrency</span>
                <span className="font-bold text-foreground">10 workers</span>
              </div>
            </div>
            <div className="mt-6">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Status: Operational</span>
            </div>
          </div>

          <div className="rounded-2xl border border-indigo-500/10 bg-indigo-500/5 p-6 backdrop-blur-sm">
            <Codescripts />
          </div>
        </div>
      </div>
    </div>
  );
}

function Codescripts() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-indigo-300">SDK Libraries</h3>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
          <Code2 className="size-4" />
          <span>gitscope-js (npm)</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
          <Server className="size-4" />
          <span>gitscope-go (module)</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
          <Globe className="size-4" />
          <span>gitscope-python (pip)</span>
        </div>
      </div>
      <div className="pt-2">
        <Link href={ROUTES.docs} className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline">View SDK Documentation</Link>
      </div>
    </div>
  );
}
