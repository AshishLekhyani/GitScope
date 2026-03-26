"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/providers/query-provider";
import { StoreProvider } from "@/store/StoreProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { Session } from "next-auth";

export function AppProviders({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <AuthProvider session={session}>
      <StoreProvider>
        <QueryProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryProvider>
      </StoreProvider>
    </AuthProvider>
  );
}
// AppProviders composed
