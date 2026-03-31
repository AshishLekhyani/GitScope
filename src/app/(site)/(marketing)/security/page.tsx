import { ShieldCheck, Lock, Eye, Zap } from "lucide-react";

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-4xl px-6">
      <div className="mb-12 text-center">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Security Protocol</h1>
        <p className="mt-4 text-muted-foreground">Premium data protection for modern engineering units.</p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="rounded-2xl border border-white/5 bg-surface-container p-8">
          <ShieldCheck className="mb-4 size-8 text-primary" />
          <h3 className="mb-2 text-lg font-bold text-foreground">SOC2 Type II</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Our systems are architected with enterprise-grade compliance at the core. 
            We maintain strict adherence to SOC2 standards for data availability, 
            processing integrity, and confidentiality.
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-surface-container p-8">
          <Lock className="mb-4 size-8 text-tertiary" />
          <h3 className="mb-2 text-lg font-bold text-foreground">Military-Grade Encryption</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            All telemetry data is encrypted using AES-256 at rest and TLS 1.3 in transit. 
            We employ perfect forward secrecy to ensure your metadata remains isolated.
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-surface-container p-8">
          <Eye className="mb-4 size-8 text-emerald-400" />
          <h3 className="mb-2 text-lg font-bold text-foreground">Zero-Source Access</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            GitScope never stores your underlying source code. We process 
            ephemeral syntax trees and architectural metadata, ensuring 
            your proprietary logic stays within your infrastructure.
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-surface-container p-8">
          <Zap className="mb-4 size-8 text-indigo-400" />
          <h3 className="mb-2 text-lg font-bold text-foreground">Identity & Isolation</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Each enterprise unit operates within a logically isolated environment. 
            Multiple layers of identification and role-based access control 
            ensure total data sovereignty.
          </p>
        </div>
      </div>
    </div>
  );
}
