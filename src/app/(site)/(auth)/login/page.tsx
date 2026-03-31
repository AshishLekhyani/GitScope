"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User, ArrowRight, Github as GithubIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/constants/routes";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { signIn } from "next-auth/react";

import { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function AuthForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<"idle" | "success" | "error">("idle");

  const router = useRouter();
  const searchParams = useSearchParams();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Sync mode from query param
  useEffect(() => {
    if (!isMounted) return;
    const m = searchParams.get("mode");
    if (m === "signup") setMode("signup");
    if (m === "login") setMode("login");
  }, [searchParams, isMounted]);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const getPasswordStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[a-z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    
    if (score <= 2) return { label: "Weak", color: "bg-destructive", width: "w-1/3" };
    if (score <= 4) return { label: "Medium", color: "bg-amber-500", width: "w-2/3" };
    return { label: "Strong", color: "bg-emerald-500", width: "w-full" };
  };

  const validatePasswordComplexity = (pass: string) => {
    const minLength = pass.length >= 8;
    const hasUpper = /[A-Z]/.test(pass);
    const hasLower = /[a-z]/.test(pass);
    const hasNumber = /[0-9]/.test(pass);
    const hasSpecial = /[^A-Za-z0-9]/.test(pass);

    if (!minLength) return "Password must be at least 8 characters.";
    if (!hasUpper) return "Password must contain at least one uppercase letter.";
    if (!hasLower) return "Password must contain at least one lowercase letter.";
    if (!hasNumber) return "Password must contain at least one number.";
    if (!hasSpecial) return "Password must contain at least one special character.";
    
    return null;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Client-side validations
    if (!validateEmail(email)) {
      setLoading(true); // briefly show loading to trigger feedback flow
      setAuthStatus("error");
      setError("Please enter a valid email address.");
      setTimeout(() => { setLoading(false); setAuthStatus("idle"); }, 2500);
      return;
    }

    if (mode === "signup") {
      const complexityError = validatePasswordComplexity(password);
      if (complexityError) {
        setLoading(true);
        setAuthStatus("error");
        setError(complexityError);
        setTimeout(() => { setLoading(false); setAuthStatus("idle"); }, 2500);
        return;
      }
      if (password !== confirmPassword) {
        setLoading(true);
        setAuthStatus("error");
        setError("Passwords do not match.");
        setTimeout(() => { setLoading(false); setAuthStatus("idle"); }, 2500);
        return;
      }
    }

    setLoading(true);
    setAuthStatus("idle");
    setError(null);

    const startTime = Date.now();
    const minLoadingTime = 1500; // at least 1.5s of loading

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });

        if (!res.ok) {
          throw new Error(await res.text() || "Registration failed");
        }

        // Use standard signIn after registration
        const loginRes = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (loginRes?.ok) {
          const elapsedTime = Date.now() - startTime;
          const remainingTime = Math.max(0, minLoadingTime - elapsedTime);
          await new Promise(resolve => setTimeout(resolve, remainingTime));

          setAuthStatus("success");
          setTimeout(() => {
            router.replace(`${ROUTES.overview}?welcome=true`);
            router.refresh();
          }, 1500);
        } else {
          throw new Error(loginRes?.error || "Login failed after registration");
        }
      } else {
        const loginRes = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (loginRes?.error) {
          // Add artificial delay before showing error
          const elapsedTime = Date.now() - startTime;
          const remainingTime = Math.max(0, minLoadingTime - elapsedTime);
          await new Promise(resolve => setTimeout(resolve, remainingTime));
          throw new Error(loginRes.error);
        }

        if (loginRes?.ok) {
          const elapsedTime = Date.now() - startTime;
          const remainingTime = Math.max(0, minLoadingTime - elapsedTime);
          await new Promise(resolve => setTimeout(resolve, remainingTime));

          setAuthStatus("success");
          setTimeout(() => {
            router.replace(`${ROUTES.overview}?welcome=true`);
            router.refresh();
          }, 1500);
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Authentication failed";
      setAuthStatus("error");
      setError(message === "CredentialsSignin" ? "Invalid email or password." : message);
      setTimeout(() => {
        setLoading(false);
        setAuthStatus("idle");
      }, 2500);
    }
  };

  const handleOAuth = async (provider: string) => {
    setLoading(true);
    setAuthStatus("idle");
    
    // 1. Initial "Authenticating..." state (1.5s total)
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // 2. Show "Access Granted" or "Redirecing..." state briefly (800ms)
    setAuthStatus("success");
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // 3. Final redirect to external provider
    signIn(provider, { callbackUrl: `${ROUTES.overview}?welcome=true` });
  };

  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col items-center justify-center py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(67,97,238,0.05),transparent_60%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(192,193,255,0.08),transparent_50%)]" />
      
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            {mode === "login" ? "Welcome Back" : "Initialize Account"}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground font-medium tracking-wide">
            {mode === "login" ? "Access your engineering dashboard." : "Join the global engineering community."}
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-8 shadow-2xl relative overflow-hidden min-h-[400px]">
          <AnimatePresence>
            {!loading && authStatus === "idle" ? (
              <motion.div
                key="form-view"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-8 flex gap-1 rounded-lg bg-muted/50 p-1 ring-1 ring-border/50">
                  {(["login", "signup"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMode(m); setError(null); }}
                      className={cn(
                        "flex-1 rounded-md py-2 text-xs font-bold uppercase tracking-widest transition-all",
                        mode === m 
                          ? "bg-primary text-white shadow-lg" 
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {m === "login" ? "Log In" : "Sign Up"}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                  <AnimatePresence mode="wait">
                    {mode === "signup" && (
                      <motion.div
                        key="signup-fields"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-4"
                      >
                        <div className="space-y-2">
                          <Label htmlFor="name" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Full Name</Label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="name"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              placeholder="Alex Rivera"
                              className="bg-background border-border pl-10 focus:ring-primary/50"
                              required={mode === "signup"}
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="bg-background border-border pl-10 focus:ring-primary/50"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <Label htmlFor="pass" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Password</Label>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="pass"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-background border-border pl-10 focus:ring-primary/50"
                        required
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    {mode === "signup" && password.length > 0 && (
                      <motion.div
                        key="password-strength"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-1.5 px-1"
                      >
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                          <span className="text-muted-foreground">Strength</span>
                          <span className={cn("transition-colors", getPasswordStrength(password).color.replace("bg-", "text-"))}>
                            {getPasswordStrength(password).label}
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                          <motion.div 
                            className={cn("h-full transition-all duration-500", getPasswordStrength(password).color)}
                            initial={{ width: 0 }}
                            animate={{ width: getPasswordStrength(password).width.replace("w-", "") }}
                            style={{ width: getPasswordStrength(password).width.replace("w-1/3", "33.33%").replace("w-2/3", "66.66%").replace("w-full", "100%") }}
                          />
                        </div>
                        <p className="text-[9px] text-muted-foreground leading-tight italic">
                          Include uppercase, lowercase, numbers, and symbols.
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence mode="wait">
                    {mode === "signup" && (
                      <motion.div
                        key="confirm-password-field"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2"
                      >
                        <Label htmlFor="confirm-pass" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Confirm Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="confirm-pass"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="bg-background border-border pl-10 focus:ring-primary/50"
                            required={mode === "signup"}
                            placeholder="••••••••"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {error && (
                    <p className="text-destructive text-sm font-medium">{error}</p>
                  )}

                  <Button type="submit" className="w-full btn-gitscope-primary rounded-xl font-bold uppercase tracking-widest py-6 mt-2">
                    {mode === "login" ? "Log In" : "Create Account"}
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                </form>

                <div className="relative my-8">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-[10px] font-bold uppercase tracking-widest">
                    <span className="bg-card px-2 text-muted-foreground">Secure OAuth Relay</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    variant="outline" 
                    type="button" 
                    onClick={() => handleOAuth("github")}
                    className="rounded-xl border-border bg-secondary/50 hover:bg-secondary text-xs font-bold font-mono tracking-wider transition-colors"
                  >
                    <GithubIcon className="mr-2 size-4" />
                    GitHub
                  </Button>
                  <Button 
                    variant="outline" 
                    type="button" 
                    onClick={() => handleOAuth("google")}
                    className="rounded-xl border-border bg-secondary/50 hover:bg-secondary text-xs font-bold font-mono tracking-wider transition-colors"
                  >
                    <Mail className="mr-2 size-4" />
                    Google
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="loading-view"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-card/50 backdrop-blur-sm z-50 rounded-2xl p-8 text-center"
              >
                {authStatus === "idle" && (
                  <>
                    <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent mb-6 shadow-[0_0_15px_rgba(67,97,238,0.5)]" />
                    <h3 className="text-lg font-bold tracking-tight">Authenticating...</h3>
                    <p className="text-sm text-muted-foreground mt-2">Connecting to GitScope secure systems.</p>
                  </>
                )}
                
                {authStatus === "success" && (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center"
                  >
                    <div className="size-16 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center mb-6">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold tracking-tight text-emerald-500">Access Granted</h3>
                    <p className="text-sm text-muted-foreground mt-2">Initializing your dashboard...</p>
                  </motion.div>
                )}

                {authStatus === "error" && (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center"
                  >
                    <div className="size-16 rounded-full bg-destructive/20 text-destructive flex items-center justify-center mb-6">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold tracking-tight text-destructive">Log In Failed</h3>
                    <p className="text-sm text-muted-foreground mt-2">{error || "Invalid credentials."}</p>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground font-medium">
          By engaging, you agree to our{" "}
          <Link href={ROUTES.docs} className="text-primary hover:underline">Tactical Protocols</Link> and{" "}
          <Link href={ROUTES.docs} className="text-primary hover:underline">Data Secrecy</Link>.
        </p>
      </motion.div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    }>
      <AuthForm />
    </Suspense>
  );
}
