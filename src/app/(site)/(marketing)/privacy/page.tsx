export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6">
      <h1 className="mb-8 font-heading text-4xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
      <div className="prose prose-invert max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground">
        <p className="text-lg font-medium text-indigo-100/80 italic">Last updated: March 28, 2026</p>
        
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">1. Data Collection Protocols</h2>
          <p>
            GitScope collects metadata from synchronized GitHub repositories to provide engineering intelligence. 
            This includes commit frequency, contribution patterns, and architectural complexity scores. 
            We do not store your source code on our permanent telemetry nodes.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">2. Information Security</h2>
          <p>
            All data in transit is encrypted using enterprise-grade TLS 1.3. 
            Data at rest is protected by AES-256 encryption. 
            Access to telemetry data is restricted via SOC2-compliant identity management.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">3. Enterprise Compliance</h2>
          <p>
            GitScope is committed to maintaining the highest standards of data governance. 
            We comply with GDPR, CCPA, and are actively pursuing SOC2 Type II certification.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">4. Contact Intelligence</h2>
          <p>
            For privacy-related inquiries or data deletion requests, 
            contact our security unit at <span className="text-primary hover:underline cursor-pointer font-bold">privacy@gitscope.ai</span>.
          </p>
        </section>
      </div>
    </div>
  );
}
