export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6">
      <h1 className="mb-8 font-heading text-4xl font-bold tracking-tight text-foreground">Terms of Service</h1>
      <div className="prose prose-invert max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground">
        <p className="text-lg font-medium text-indigo-100/80 italic">Last updated: March 28, 2026</p>
        
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">1. Acceptance of Terms</h2>
          <p>
            By accessing or using GitScope, you agree to be bound by these Terms of Service. 
            If you represent a company, you affirm you have the authority to bind that entity to these terms.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">2. License to Telemetry</h2>
          <p>
            You grant GitScope a limited license to process metadata from your synchronized GitHub repositories 
            solely for the purpose of providing analytics and intelligence dashboards. 
            You retain all ownership rights to your underlying source code.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">3. Prohibited Engineering Practices</h2>
          <p>
            You agree not to use GitScope for unauthorized architectural interference, 
            reverse engineering of the GitScope core model, or any activity that compromises 
            the stability of the global GitHub API network.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">4. Service Availability</h2>
          <p>
            We strive for 99.9% uptime. Service levels for Enterprise units are governed 
            by separate Service Level Agreements (SLA).
          </p>
        </section>
      </div>
    </div>
  );
}
