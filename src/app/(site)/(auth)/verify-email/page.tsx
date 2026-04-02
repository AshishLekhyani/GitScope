"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { signIn } from "next-auth/react";
import { MaterialIcon } from "@/components/material-icon";

type State = "pending" | "signing-in" | "success" | "error" | "resending" | "resent";

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "The verification link is missing a token.",
  invalid_token: "This verification link is invalid or has already been used.",
  expired_token: "Your verification link has expired (30 min limit).",
  already_exists: "An account with this email already exists. Try signing in.",
};

function VerifyEmailContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<State>("pending");
  const [errorMsg, setErrorMsg] = useState("");
  const [email, setEmail] = useState("");
  const [resendError, setResendError] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const signInWithOneTimeToken = async (token: string): Promise<boolean> => {
    if (!token) return false;
    setState("signing-in");
    const res = await signIn("token", { token, redirect: false });
    return Boolean(res?.ok);
  };

  const fetchWaitToken = async (targetEmail: string): Promise<string | null> => {
    if (!targetEmail) return null;
    try {
      const res = await fetch(`/api/auth/check-verification?email=${encodeURIComponent(targetEmail)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data?.verified || !data?.at) return null;
      return data.at as string;
    } catch {
      return null;
    }
  };

  const tryWaitTokenAutologin = async (targetEmail: string): Promise<boolean> => {
    const waitToken = await fetchWaitToken(targetEmail);
    if (!waitToken) return false;
    return signInWithOneTimeToken(waitToken);
  };

  useEffect(() => {
    const success = params.get("success");
    const error = params.get("error");
    const clickTabToken = params.get("at");
    const emailParam = params.get("email") ?? "";

    setEmail(emailParam);

    if (success === "1" && clickTabToken) {
      // Link-click tab: use click-tab token, then fallback to waiting token.
      signInWithOneTimeToken(clickTabToken).then(async (ok) => {
        if (ok) {
          router.replace("/overview?welcome=true");
          return;
        }

        const recovered = await tryWaitTokenAutologin(emailParam);
        if (recovered) router.replace("/overview?welcome=true");
        else setState("success");
      });
    } else if (success === "1") {
      // Success state without click-tab token: try waiting token first.
      if (!emailParam) {
        setState("success");
      } else {
        setState("signing-in");
        tryWaitTokenAutologin(emailParam).then((ok) => {
          if (ok) router.replace("/overview?welcome=true");
          else setState("success");
        });
      }
    } else if (error) {
      setState("error");
      setErrorMsg(ERROR_MESSAGES[error] ?? "Something went wrong.");
    } else if (emailParam) {
      // Waiting tab: poll until email is verified, then auto sign-in.
      setState("pending");
      pollingRef.current = setInterval(async () => {
        try {
          const waitToken = await fetchWaitToken(emailParam);
          if (!waitToken) return;

          stopPolling();
          const ok = await signInWithOneTimeToken(waitToken);
          if (ok) router.replace("/overview?welcome=true");
          else setState("success");
        } catch {
          // Ignore transient polling issues.
        }
      }, 2000);
    }

    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResend = async () => {
    if (!email.trim() || state === "resending") return;
    setState("resending");
    setResendError("");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok || data.ok) {
        setState("resent");
      } else {
        setState("pending");
        setResendError(data.error ?? "Failed to resend. Please try again.");
      }
    } catch {
      setState("pending");
      setResendError("Failed to resend. Please try again.");
    }
  };

  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col items-center justify-center py-12">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="glass-panel rounded-2xl p-10 shadow-2xl text-center space-y-6">
          {state === "signing-in" && (
            <>
              <div className="size-16 mx-auto animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <div>
                <h2 className="text-xl font-bold text-foreground">Signing you in...</h2>
                <p className="text-muted-foreground text-sm mt-2">Your email is verified. One moment.</p>
              </div>
            </>
          )}

          {state === "success" && (
            <>
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="size-16 mx-auto rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center"
              >
                <MaterialIcon name="check_circle" size={36} />
              </motion.div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Email Verified</h2>
                <p className="text-muted-foreground text-sm mt-2">Your account is active. Click below to sign in.</p>
              </div>
              <Link
                href={`/login?verified=1${email ? `&email=${encodeURIComponent(email)}` : ""}`}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                Sign In
                <MaterialIcon name="arrow_forward" size={16} />
              </Link>
            </>
          )}

          {state === "resent" && (
            <>
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="size-16 mx-auto rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center"
              >
                <MaterialIcon name="mark_email_read" size={36} />
              </motion.div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Email Sent</h2>
                <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
                  A new link has been sent to <span className="text-foreground font-medium">{email}</span>. It expires in 30 minutes.
                </p>
              </div>
              <button type="button" onClick={() => setState("pending")} className="text-xs text-primary hover:underline">
                Did not receive it? Try again
              </button>
              <Link href="/login" className="block text-xs text-muted-foreground hover:text-primary transition-colors">
                Back to sign in
              </Link>
            </>
          )}

          {(state === "pending" || state === "resending" || state === "error") && (
            <>
              <div
                className={`size-16 mx-auto rounded-full flex items-center justify-center ${
                  state === "error" ? "bg-amber-500/20 text-amber-500" : "bg-primary/10 text-primary"
                }`}
              >
                <MaterialIcon name="forward_to_inbox" size={36} />
              </div>

              <div>
                <h2 className="text-xl font-bold text-foreground">Check Your Inbox</h2>
                <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
                  {state === "error"
                    ? errorMsg
                    : email
                      ? <><span>We sent a link to </span><span className="text-foreground font-medium">{email}</span><span>. It expires in 30 minutes. This page will redirect automatically once verified.</span></>
                      : "We sent a verification link to your email. It expires in 30 minutes."}
                </p>
              </div>

              {state === "pending" && email && (
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                  <span className="font-mono text-[10px] tracking-widest uppercase">Waiting for verification...</span>
                </div>
              )}

              <div className="space-y-3 text-left">
                <label className="block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                  {email ? "Resend to" : "Enter your email to resend"}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                />
                {resendError && <p className="text-destructive text-xs">{resendError}</p>}
                <button
                  type="button"
                  disabled={state === "resending" || !email.trim()}
                  onClick={handleResend}
                  className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {state === "resending" ? "Sending..." : "Resend Verification Email"}
                </button>
              </div>

              <Link href="/login" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
