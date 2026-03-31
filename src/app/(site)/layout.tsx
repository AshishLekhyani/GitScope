import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { MarketingHeader } from "@/components/layout/marketing-header";
import { MarketingFooter } from "@/components/layout/marketing-footer";

export default async function SiteLayout({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  const session = await getServerSession(authOptions);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased selection:bg-primary/20">
      <div className="flex min-h-screen flex-col">
        <MarketingHeader session={session} />
        <main className="flex-1 pt-24 pb-20">
          {children}
        </main>
        <MarketingFooter />
      </div>
    </div>
  );
}
