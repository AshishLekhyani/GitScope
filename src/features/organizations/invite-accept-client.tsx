"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { Loader2, Check, X } from "lucide-react";

export function InviteAcceptClient({ token }: { token: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [msg, setMsg]     = useState("");
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    if (!token) { setState("error"); setMsg("Invalid invite link — no token found."); return; }
    if (status === "loading") return;
    if (status === "unauthenticated") {
      signIn(undefined, { callbackUrl: `/invite/accept?token=${token}` });
      return;
    }

    void (async () => {
      try {
        const res = await fetch("/api/orgs/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json() as { error?: string; orgName?: string; orgId?: string };
        if (!res.ok) { setState("error"); setMsg(data.error ?? "Failed to accept invite."); return; }
        setOrgName(data.orgName ?? "the workspace");
        setState("success");
        setTimeout(() => router.push("/organizations"), 2500);
      } catch { setState("error"); setMsg("Network error. Please try again."); }
    })();
  }, [status, token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full rounded-2xl border border-border bg-card p-8 text-center space-y-4 shadow-xl">
        {state === "loading" && (
          <>
            <Loader2 className="size-10 animate-spin text-indigo-500 mx-auto" />
            <p className="text-sm font-semibold">Accepting invite…</p>
          </>
        )}
        {state === "success" && (
          <>
            <div className="size-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
              <Check className="size-6 text-emerald-500" />
            </div>
            <p className="text-sm font-bold">You&apos;ve joined <span className="text-indigo-500">{orgName}</span>!</p>
            <p className="text-xs text-muted-foreground">Redirecting to Organizations…</p>
          </>
        )}
        {state === "error" && (
          <>
            <div className="size-12 rounded-full bg-destructive/15 flex items-center justify-center mx-auto">
              <X className="size-6 text-destructive" />
            </div>
            <p className="text-sm font-bold text-destructive">{msg}</p>
            <button
              type="button"
              onClick={() => router.push("/organizations")}
              className="text-xs text-indigo-500 hover:underline"
            >
              Go to Organizations
            </button>
          </>
        )}
      </div>
    </div>
  );
}
