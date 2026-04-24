"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok || data.ok) {
        setSent(true);
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
            Forgot Password
          </h2>
          <p className="mt-3 text-sm text-muted-foreground font-medium">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>

        <div className="glass-panel rounded-none p-8 shadow-2xl">
          <AnimatePresence mode="wait">
            {sent ? (
              <motion.div
                key="sent"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-5 py-4 text-center"
              >
                <div className="size-16 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center">
                  <MaterialIcon name="mark_email_read" size={36} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Check your inbox</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    If <span className="text-foreground font-medium">{email}</span> has an account,
                    a password reset link has been sent. It expires in 1 hour.
                  </p>
                </div>
                <Link href="/login" className="text-xs text-primary hover:underline">
                  Back to sign in
                </Link>
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
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </div>

                {error && (
                  <p className="text-destructive text-sm font-medium">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full rounded-none bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {loading ? "Sending…" : "Send Reset Link"}
                </button>

                <p className="text-center text-xs text-muted-foreground">
                  Remember your password?{" "}
                  <Link href="/login" className="text-primary hover:underline">Sign in</Link>
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
