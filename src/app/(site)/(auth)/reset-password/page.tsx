"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import Link from "next/link";
import { cn } from "@/lib/utils";

function getPasswordStrength(pass: string) {
  let score = 0;
  if (pass.length >= 8) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[a-z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  if (score <= 2) return { label: "Weak", color: "bg-destructive", pct: "33%" };
  if (score <= 4) return { label: "Medium", color: "bg-amber-500", pct: "66%" };
  return { label: "Strong", color: "bg-emerald-500", pct: "100%" };
}

function ResetPasswordContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing reset token. Please use the link from your email.");
    }
  }, [token]);

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok || data.ok) {
        setDone(true);
        setTimeout(() => router.push("/login"), 3000);
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col items-center justify-center py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            Reset Password
          </h2>
          <p className="mt-3 text-sm text-muted-foreground font-medium">
            Choose a strong new password.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-8 shadow-2xl">
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-5 py-4 text-center"
              >
                <div className="size-16 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center">
                  <MaterialIcon name="lock_reset" size={36} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Password Updated</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    Redirecting you to sign in…
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onSubmit={handleSubmit}
                className="space-y-5"
              >
                <div className="space-y-2">
                  <label className="block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  {password.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-widest">
                        <span className="text-muted-foreground">Strength</span>
                        <span className={cn(
                          strength.color.replace("bg-", "text-"),
                          "transition-colors"
                        )}>
                          {strength.label}
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className={cn("h-full rounded-full", strength.color)}
                          animate={{ width: strength.pct }}
                          transition={{ duration: 0.4 }}
                        />
                      </div>
                      <p className="text-[9px] text-muted-foreground italic">
                        Include uppercase, lowercase, numbers, and symbols.
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </div>

                {error && (
                  <p className="text-destructive text-sm font-medium">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !token || !password || !confirm}
                  className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {loading ? "Updating…" : "Set New Password"}
                </button>

                <p className="text-center text-xs text-muted-foreground">
                  <Link href="/forgot-password" className="text-primary hover:underline">
                    Request a new link
                  </Link>
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  );
}
