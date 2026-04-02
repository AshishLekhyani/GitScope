"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MaterialIcon } from "@/components/material-icon";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import Image from "next/image";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateProfile, setAvatarUrl } from "@/store/slices/userSlice";
import { useGitHubRateLimit } from "@/hooks/use-github-rate-limit";
import { useSession, signIn, signOut } from "next-auth/react";

type SettingsTab = "profile" | "account" | "appearance" | "workspace";
type ThemeOption = "light" | "dark" | "system";
type AiPlan = "free" | "professional" | "team" | "enterprise";

interface AiUsageSnapshot {
  total: number;
  byFeature: Record<string, number>;
  since: string;
}

interface AiJobSummary {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  plan: AiPlan;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "profile", label: "Profile", icon: "person" },
  { id: "account", label: "Account", icon: "manage_accounts" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "workspace", label: "Workspace", icon: "tune" },
];

export function SettingsPanel() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user);
  const { displayName, gitHandle, bio, avatarUrl } = user;

  const { data: session } = useSession();
  const { rateLimit, latency, loading: rateLimitLoading } = useGitHubRateLimit();

  // Profile state
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarUrlInput, setAvatarUrlInput] = useState(avatarUrl ?? "");
  // Track if user explicitly cleared the avatar (so we don't fall back to OAuth photo in preview)
  const [avatarCleared, setAvatarCleared] = useState(false);

  // Workspace state
  const [notifications, setNotifications] = useState(true);
  const [autoSync, setAutoSync] = useState(true);

  // Account / password state
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // GitHub API key state
  const [hasGithubApiKey, setHasGithubApiKey] = useState(false);
  const [githubApiKeyInput, setGithubApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyMsg, setApiKeyMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteEmailInput, setDeleteEmailInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  // AI plan + usage ops state
  const [tierInfo, setTierInfo] = useState<{
    resolvedPlan: AiPlan;
    storedPlan: AiPlan;
    aiTierUpdatedAt: string | null;
  } | null>(null);
  const [usageSnapshot, setUsageSnapshot] = useState<AiUsageSnapshot | null>(null);
  const [jobHistory, setJobHistory] = useState<AiJobSummary[]>([]);
  const [aiOpsLoading, setAiOpsLoading] = useState(false);
  const [aiOpsError, setAiOpsError] = useState<string | null>(null);
  const [tierTargetUserId, setTierTargetUserId] = useState("");
  const [tierTargetPlan, setTierTargetPlan] = useState<AiPlan>("professional");
  const [tierSaving, setTierSaving] = useState(false);
  const [tierMsg, setTierMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as SettingsTab | null;
    if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab);
  }, []);

  // Load profile from DB on mount
  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        dispatch(
          updateProfile({
            displayName: data.name ?? session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "",
            gitHandle: data.githubHandle ?? "",
            bio: data.bio ?? "",
          })
        );
        setHasPassword(data.hasPassword ?? false);
        setHasGithubApiKey(data.hasGithubApiKey ?? false);
      })
      .catch(() => {
        if (session?.user && !displayName) {
          dispatch(
            updateProfile({
              displayName: session.user.name ?? session.user.email?.split("@")[0] ?? "",
            })
          );
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Sync local avatar input when Redux value changes (e.g. "Use OAuth photo" button or default avatar click)
  useEffect(() => {
    setAvatarUrlInput(avatarUrl ?? "");
  }, [avatarUrl]);

  useEffect(() => {
    if (activeTab !== "workspace" || !session?.user?.id) return;

    let cancelled = false;
    const loadAiOps = async () => {
      setAiOpsLoading(true);
      setAiOpsError(null);
      try {
        const [tierRes, capsRes, jobsRes] = await Promise.all([
          fetch("/api/user/tier", { cache: "no-store" }),
          fetch("/api/user/ai-capabilities", { cache: "no-store" }),
          fetch("/api/user/ai-jobs", { cache: "no-store" }),
        ]);

        if (!cancelled && tierRes.ok) {
          const tierData = await tierRes.json();
          setTierInfo({
            resolvedPlan: (tierData.resolvedPlan ?? "free") as AiPlan,
            storedPlan: (tierData.storedPlan ?? "free") as AiPlan,
            aiTierUpdatedAt: tierData.aiTierUpdatedAt ?? null,
          });
        }

        if (!cancelled && capsRes.ok) {
          const capsData = await capsRes.json();
          setUsageSnapshot(capsData.usage ?? { total: 0, byFeature: {}, since: new Date().toISOString() });
        }

        if (!cancelled && jobsRes.ok) {
          const jobsData = await jobsRes.json();
          setJobHistory((jobsData.jobs ?? []) as AiJobSummary[]);
        }

        if (!tierRes.ok && !capsRes.ok && !jobsRes.ok && !cancelled) {
          setAiOpsError("Could not load AI settings right now.");
        }
      } catch {
        if (!cancelled) setAiOpsError("Could not load AI settings right now.");
      } finally {
        if (!cancelled) setAiOpsLoading(false);
      }
    };

    loadAiOps();
    return () => {
      cancelled = true;
    };
  }, [activeTab, session?.user?.id]);

  const handleDiscard = () => {
    fetch("/api/user/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        dispatch(updateProfile({ displayName: data.name ?? "", gitHandle: data.githubHandle ?? "", bio: data.bio ?? "" }));
        setDirty(false);
      })
      .catch(() => setDirty(false));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, bio, gitHandle, avatarUrl: avatarUrl || undefined }),
      });
      setDirty(false);
    } catch (e) {
      console.error("Failed to save profile", e);
    } finally {
      setSaving(false);
    }
  };

  const validatePasswordComplexity = (pass: string): string | null => {
    if (pass.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(pass)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(pass)) return "Password must contain at least one lowercase letter.";
    if (!/[0-9]/.test(pass)) return "Password must contain at least one number.";
    if (!/[^A-Za-z0-9]/.test(pass)) return "Password must contain at least one special character.";
    return null;
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match." });
      return;
    }
    const complexityError = validatePasswordComplexity(newPassword);
    if (complexityError) {
      setPasswordMsg({ type: "error", text: complexityError });
      return;
    }
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      const res = await fetch("/api/user/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, currentPassword: hasPassword ? currentPassword : undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg({ type: "success", text: "Password updated successfully." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setHasPassword(true);
      } else {
        setPasswordMsg({ type: "error", text: data.error ?? "Failed to update password." });
      }
    } catch {
      setPasswordMsg({ type: "error", text: "An error occurred. Please try again." });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSaveApiKey = async (remove = false) => {
    setApiKeySaving(true);
    setApiKeyMsg(null);
    try {
      const res = await fetch("/api/user/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubApiKey: remove ? null : githubApiKeyInput }),
      });
      const data = await res.json();
      if (res.ok) {
        setApiKeyMsg({ type: "success", text: remove ? "API key removed." : "API key saved." });
        setHasGithubApiKey(!remove);
        if (remove) setGithubApiKeyInput("");
      } else {
        setApiKeyMsg({ type: "error", text: data.error ?? "Failed to save API key." });
      }
    } catch {
      setApiKeyMsg({ type: "error", text: "An error occurred. Please try again." });
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleTierUpdate = async () => {
    setTierSaving(true);
    setTierMsg(null);
    try {
      const payload: { plan: AiPlan; userId?: string } = { plan: tierTargetPlan };
      if (tierTargetUserId.trim()) payload.userId = tierTargetUserId.trim();

      const res = await fetch("/api/user/tier", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setTierMsg({ type: "error", text: data.error ?? "Failed to update tier." });
        return;
      }

      setTierMsg({ type: "success", text: "Tier updated successfully." });

      const [tierRes, capsRes] = await Promise.all([
        fetch("/api/user/tier", { cache: "no-store" }),
        fetch("/api/user/ai-capabilities", { cache: "no-store" }),
      ]);
      if (tierRes.ok) {
        const tierData = await tierRes.json();
        setTierInfo({
          resolvedPlan: (tierData.resolvedPlan ?? "free") as AiPlan,
          storedPlan: (tierData.storedPlan ?? "free") as AiPlan,
          aiTierUpdatedAt: tierData.aiTierUpdatedAt ?? null,
        });
      }
      if (capsRes.ok) {
        const capsData = await capsRes.json();
        setUsageSnapshot(capsData.usage ?? { total: 0, byFeature: {}, since: new Date().toISOString() });
      }
    } catch {
      setTierMsg({ type: "error", text: "Failed to update tier." });
    } finally {
      setTierSaving(false);
    }
  };

  const currentTheme = (theme ?? "system") as ThemeOption;
  const ratePct = rateLimit ? Math.round((rateLimit.remaining / rateLimit.limit) * 100) : 100;
  const ratePctClass =
    ratePct > 50 ? "from-tertiary to-emerald-400" : ratePct > 20 ? "from-amber-400 to-yellow-400" : "from-destructive to-red-400";

  const rawProvider = session?.provider;
  // If provider isn't set but accessToken exists, this is a GitHub session (pre-provider-tracking JWT)
  const provider = rawProvider ?? (session?.accessToken && !rawProvider ? "github" : undefined);

  const themeOptions: { value: ThemeOption; label: string; bgClass: string }[] = [
    { value: "light", label: "Light", bgClass: "bg-slate-200" },
    { value: "dark", label: "Deep Ocean", bgClass: "bg-[#0b1326]" },
    { value: "system", label: "System", bgClass: "bg-linear-to-br from-slate-200 to-[#0b1326]" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative w-full pb-20">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Platform Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your profile, account security, appearance, and workspace preferences.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-8 flex gap-1 rounded-xl border border-outline-variant/15 bg-surface-container p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-all",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-container-high"
            )}
          >
            <MaterialIcon name={tab.icon} size={15} />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Profile Tab ── */}
      {activeTab === "profile" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-5">Public Profile</h3>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
              {/* avatar */}
              <div className="shrink-0 space-y-4 w-full sm:w-auto">
                {/* Preview */}
                <div className="flex items-center gap-4">
                  <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br from-primary/30 to-primary-container/30 text-3xl font-bold text-primary border border-outline-variant/15 shrink-0">
                    {(avatarUrl || (!avatarCleared && session?.user?.image)) ? (
                      <Image
                        src={avatarUrl || session!.user!.image!}
                        width={80}
                        height={80}
                        alt="Avatar"
                        className="size-full object-cover"
                        unoptimized
                      />
                    ) : (
                      displayName.charAt(0) || "?"
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="font-mono text-[9px] font-bold tracking-widest text-muted-foreground uppercase">Current Avatar</p>
                    {session?.user?.image && (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                        onClick={() => { dispatch(setAvatarUrl(session.user!.image!)); setAvatarCleared(false); setDirty(true); }}
                      >
                        <MaterialIcon name="sync" size={12} />
                        Use {session.provider === "github" ? "GitHub" : "OAuth"} photo
                      </button>
                    )}
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => { dispatch(setAvatarUrl("")); setAvatarUrlInput(""); setAvatarCleared(true); setDirty(true); }}
                    >
                      <MaterialIcon name="delete" size={12} />
                      Remove
                    </button>
                  </div>
                </div>

                {/* Default avatars grid */}
                <div>
                  <p className="mb-2 font-mono text-[9px] font-bold tracking-widest text-muted-foreground uppercase">Choose Default</p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {[
                      "https://api.dicebear.com/7.x/bottts/svg?seed=alpha&backgroundColor=6366f1",
                      "https://api.dicebear.com/7.x/bottts/svg?seed=beta&backgroundColor=8b5cf6",
                      "https://api.dicebear.com/7.x/bottts/svg?seed=gamma&backgroundColor=06b6d4",
                      "https://api.dicebear.com/7.x/bottts/svg?seed=delta&backgroundColor=10b981",
                      "https://api.dicebear.com/7.x/shapes/svg?seed=omega&backgroundColor=f59e0b",
                      "https://api.dicebear.com/7.x/shapes/svg?seed=sigma&backgroundColor=ef4444",
                      "https://api.dicebear.com/7.x/identicon/svg?seed=theta&backgroundColor=6366f1",
                      "https://api.dicebear.com/7.x/identicon/svg?seed=lambda&backgroundColor=8b5cf6",
                      "https://api.dicebear.com/7.x/thumbs/svg?seed=kappa&backgroundColor=06b6d4",
                      "https://api.dicebear.com/7.x/thumbs/svg?seed=zeta&backgroundColor=10b981",
                      "https://api.dicebear.com/7.x/pixel-art/svg?seed=gitscope&backgroundColor=f59e0b",
                      "https://api.dicebear.com/7.x/pixel-art/svg?seed=engineer&backgroundColor=ef4444",
                    ].map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => { dispatch(setAvatarUrl(src)); setAvatarUrlInput(src); setAvatarCleared(false); setDirty(true); }}
                        className={cn(
                          "size-9 rounded-lg overflow-hidden border-2 transition-all hover:scale-110",
                          (avatarUrl === src) ? "border-indigo-500 shadow-lg shadow-indigo-500/20" : "border-transparent hover:border-outline-variant/40"
                        )}
                        title="Select this avatar"
                      >
                        <Image src={src} width={36} height={36} alt="Avatar option" className="size-full" unoptimized />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom URL input */}
                <div>
                  <label htmlFor="avatar-url" className="mb-1.5 block font-mono text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                    Custom URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="avatar-url"
                      type="url"
                      placeholder="https://example.com/avatar.png"
                      value={avatarUrlInput}
                      onChange={(e) => setAvatarUrlInput(e.target.value)}
                      className="flex-1 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = avatarUrlInput.trim();
                        if (val && (val.startsWith("https://") || val.startsWith("http://"))) {
                          dispatch(setAvatarUrl(val));
                          setAvatarCleared(false);
                          setDirty(true);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold hover:bg-indigo-500/20 transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>

              {/* fields */}
              <div className="flex-1 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="display-name" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                      Display Name
                    </label>
                    <input
                      id="display-name"
                      value={displayName}
                      placeholder="Your Name"
                      onChange={(e) => { dispatch(updateProfile({ displayName: e.target.value })); setDirty(true); }}
                      className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="git-handle" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                      Git Handle
                    </label>
                    <input
                      id="git-handle"
                      value={gitHandle}
                      placeholder="@username"
                      onChange={(e) => { dispatch(updateProfile({ gitHandle: e.target.value })); setDirty(true); }}
                      className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="engineering-bio" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                    Engineering Bio
                  </label>
                  <textarea
                    id="engineering-bio"
                    value={bio}
                    placeholder="Tell us about your engineering background..."
                    onChange={(e) => { dispatch(updateProfile({ bio: e.target.value })); setDirty(true); }}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Account Tab ── */}
      {activeTab === "account" && (
        <div className="space-y-6">
          {/* Identity */}
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-5">Identity & Sign-In</h3>
            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                  Email Address
                </label>
                <input
                  id="account-email"
                  aria-label="Email address"
                  title="Your account email address"
                  value={session?.user?.email ?? ""}
                  readOnly
                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                />
                <p className="mt-1 font-mono text-[9px] text-muted-foreground">Your primary email cannot be changed here.</p>
              </div>

              <div>
                <label className="mb-2 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                  Connected Sign-In Methods
                </label>
                {/* Active connections */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {(provider === "credentials" || hasPassword) && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-1.5 text-xs font-bold text-foreground">
                      <MaterialIcon name="lock" size={14} /> Email & Password
                    </span>
                  )}
                  {provider === "github" && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      <MaterialIcon name="check_circle" size={14} /> GitHub Connected
                    </span>
                  )}
                  {provider === "google" && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400">
                      <MaterialIcon name="check_circle" size={14} /> Google Connected
                    </span>
                  )}
                  {!hasPassword && provider !== "credentials" && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-600">
                      <MaterialIcon name="info" size={14} /> No password set
                    </span>
                  )}
                </div>

                {/* GitHub connect card */}
                {provider !== "github" && (
                  <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 p-4 mb-3">
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <MaterialIcon name="hub" size={20} className="text-indigo-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground mb-0.5">Connect GitHub</p>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                          Unlock Intelligence Hub, Activity Feed, Organization Pulse, DORA metrics, and a personal 5,000 req/hr API rate limit.
                        </p>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {["Intelligence Hub", "Activity Feed", "Org Pulse", "DORA Metrics"].map(f => (
                            <span key={f} className="text-[10px] font-bold bg-indigo-500/10 text-indigo-500 px-2 py-0.5 rounded-full border border-indigo-500/20">{f}</span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            signIn("github", {
                              callbackUrl: "/settings?tab=account&connected=github",
                            })
                          }
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-600 active:scale-[0.98] transition-all"
                        >
                          <MaterialIcon name="hub" size={14} />
                          Connect GitHub Account
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Google connect card */}
                {provider !== "google" && (
                  <div className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <MaterialIcon name="person" size={20} className="text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground mb-0.5">Connect Google</p>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                          Add Google sign-in to your account. Use your Google profile photo and sign in faster across devices.
                        </p>
                        <a
                          href={`/api/auth/signin/google?callbackUrl=${encodeURIComponent("/settings?tab=account&connected=google")}`}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 text-white text-xs font-bold hover:bg-blue-600 active:scale-[0.98] transition-all"
                        >
                          <MaterialIcon name="person" size={14} />
                          Connect Google Account
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Password Management */}
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-1">
              {hasPassword ? "Change Password" : "Set a Password"}
            </h3>
            <p className="text-xs text-muted-foreground mb-5">
              {hasPassword
                ? "Update your password. You will remain signed in on this device."
                : "Add email & password login to your account alongside your current sign-in method."}
            </p>
            <div className="space-y-4 max-w-md">
              {hasPassword && (
                <div>
                  <label className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                />
              </div>
              {passwordMsg && (
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs font-medium border",
                    passwordMsg.type === "success"
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : "bg-destructive/10 text-destructive border-destructive/20"
                  )}
                >
                  {passwordMsg.text}
                </div>
              )}
              <Button
                type="button"
                onClick={handlePasswordChange}
                disabled={passwordSaving || !newPassword || !confirmPassword}
                className="btn-gitscope-primary font-mono text-[10px] tracking-widest uppercase"
              >
                {passwordSaving ? "Saving..." : hasPassword ? "Update Password" : "Set Password"}
              </Button>
            </div>
          </div>

          {/* Session & Danger Zone */}
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6">
            <h3 className="font-heading text-lg font-bold text-destructive mb-1">Danger Zone</h3>
            <p className="text-xs text-muted-foreground mb-5">These actions are permanent. Proceed with caution.</p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 font-mono text-[10px] tracking-widest uppercase"
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                <MaterialIcon name="logout" size={14} className="mr-2" />
                Sign Out
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive hover:text-white font-mono text-[10px] tracking-widest uppercase"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <MaterialIcon name="delete_forever" size={14} className="mr-2" />
                Delete Account
              </Button>
            </div>

            {showDeleteConfirm && (
              <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 space-y-3">
                <p className="text-xs font-bold text-destructive">
                  This will permanently delete your account, all search history, notifications, and profile data. This cannot be undone.
                </p>
                <p className="text-xs text-muted-foreground">
                  Type your email address <span className="font-mono font-bold">{session?.user?.email}</span> to confirm:
                </p>
                <input
                  type="email"
                  aria-label="Confirm email to delete account"
                  title="Type your email to confirm account deletion"
                  placeholder={session?.user?.email ?? "your@email.com"}
                  value={deleteEmailInput}
                  onChange={(e) => setDeleteEmailInput(e.target.value)}
                  className="w-full rounded-lg border border-destructive/30 bg-surface-container-lowest px-3 py-2 text-sm focus:border-destructive focus:outline-none"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteEmailInput(""); }}
                    className="font-mono text-[10px] tracking-widest uppercase"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={deleting || deleteEmailInput !== session?.user?.email}
                    className="bg-destructive text-white hover:bg-destructive/90 font-mono text-[10px] tracking-widest uppercase"
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        const res = await fetch("/api/user/account", { method: "DELETE" });
                        if (res.ok) {
                          await signOut({ callbackUrl: "/" });
                        }
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  >
                    {deleting ? "Deleting..." : "Permanently Delete"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Appearance Tab ── */}
      {activeTab === "appearance" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-5">Color Theme</h3>
            <div className="flex flex-wrap gap-4">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-label={`Set ${opt.label} theme`}
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all",
                    mounted && currentTheme === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-outline-variant/20 hover:border-outline-variant/40"
                  )}
                >
                  <div className={cn("flex size-16 items-center justify-center rounded-lg", opt.bgClass)}>
                    {mounted && currentTheme === opt.value && (
                      <span className="size-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <span className="font-mono text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
            {!mounted && (
              <p className="mt-3 font-mono text-[9px] text-muted-foreground/50">Loading theme preferences…</p>
            )}
          </div>

          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-2">Font & Density</h3>
            <p className="text-xs text-muted-foreground mb-5">
              GitScope uses a monospace + heading font combination. Compact mode reduces spacing for dense screens.
            </p>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="compact-appearance" className="text-sm font-semibold text-foreground">
                  Compact Layout
                </Label>
                <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  Maximize data density on high-resolution monitors
                </p>
              </div>
              <Switch id="compact-appearance" onCheckedChange={() => {}} />
            </div>
          </div>
        </div>
      )}

      {/* ── Workspace Tab ── */}
      {activeTab === "workspace" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-5">Notifications & Sync</h3>
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="notif-switch" className="text-sm font-semibold text-foreground">
                    Real-time Push Notifications
                  </Label>
                  <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                    Stream live commit events to OS desktop
                  </p>
                </div>
                <Switch
                  id="notif-switch"
                  checked={notifications}
                  onCheckedChange={(v) => { setNotifications(v); setDirty(true); }}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="autosync-switch" className="text-sm font-semibold text-foreground">
                    Auto-sync Repositories
                  </Label>
                  <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                    Background polling every 60 seconds
                  </p>
                </div>
                <Switch
                  id="autosync-switch"
                  checked={autoSync}
                  onCheckedChange={(v) => { setAutoSync(v); setDirty(true); }}
                />
              </div>
            </div>
          </div>

          {/* API Health */}
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-heading text-lg font-bold text-foreground">API Health</h3>
              <span className={cn("size-2.5 rounded-full", rateLimit ? "bg-tertiary" : "bg-amber-400 animate-pulse")} />
            </div>

            <div>
              <div className="flex items-center justify-between font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                <span>GitHub Rate Limit</span>
                <span>
                  {rateLimitLoading
                    ? "Loading..."
                    : rateLimit
                    ? `${rateLimit.remaining.toLocaleString()} / ${rateLimit.limit.toLocaleString()} req`
                    : "Unavailable"}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className={cn("h-full rounded-full bg-linear-to-r transition-all duration-1000", ratePctClass)}
                  style={{ width: `${ratePct}%` } /* dynamic value — cannot be a static class */}
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-surface-container-lowest p-4 space-y-3">
              <div className="flex items-center justify-between font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                <span>API Latency</span>
                <span className={cn(latency > 500 ? "text-amber-400" : "text-tertiary")}>
                  {rateLimitLoading ? "—" : `${latency}ms`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="cloud_done" size={16} className="text-tertiary" />
                <span className="font-mono text-xs">
                  {provider === "github"
                    ? "GitHub OAuth active — 5,000 req/hr"
                    : hasGithubApiKey
                      ? "Custom token active — 5,000 req/hr"
                      : "No GitHub token — 60 req/hr (unauthenticated)"}
                </span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[9px] font-black uppercase tracking-widest border",
                  provider === "github" || hasGithubApiKey
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                )}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {provider === "github"
                  ? "GitHub Tier — Full Access"
                  : hasGithubApiKey
                    ? "Custom Token — Full Access"
                    : "Limited — 60 req/hr"}
              </span>
              {provider !== "github" && (
                <p className="font-mono text-[9px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => signIn("github", { callbackUrl: "/settings?tab=account" })}
                    className="text-primary underline"
                  >
                    Connect GitHub
                  </button>{" "}
                  to unlock Organization Pulse, Intelligence, and live feeds.
                </p>
              )}
            </div>
	          </div>

	          {/* AI Plan & Usage */}
	          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6 space-y-4">
	            <div className="flex items-center justify-between gap-3">
	              <div>
	                <h3 className="font-heading text-lg font-bold text-foreground">AI Plan & Usage</h3>
	                <p className="text-xs text-muted-foreground">
	                  Manage plan tier and monitor AI consumption and job processing.
	                </p>
	              </div>
	              <Button
	                type="button"
	                variant="outline"
	                size="sm"
	                onClick={() => {
	                  if (session?.user?.id) {
	                    setAiOpsLoading(true);
	                    Promise.all([
	                      fetch("/api/user/tier", { cache: "no-store" }),
	                      fetch("/api/user/ai-capabilities", { cache: "no-store" }),
	                      fetch("/api/user/ai-jobs", { cache: "no-store" }),
	                    ])
	                      .then(async ([tierRes, capsRes, jobsRes]) => {
	                        if (tierRes.ok) {
	                          const tierData = await tierRes.json();
	                          setTierInfo({
	                            resolvedPlan: (tierData.resolvedPlan ?? "free") as AiPlan,
	                            storedPlan: (tierData.storedPlan ?? "free") as AiPlan,
	                            aiTierUpdatedAt: tierData.aiTierUpdatedAt ?? null,
	                          });
	                        }
	                        if (capsRes.ok) {
	                          const capsData = await capsRes.json();
	                          setUsageSnapshot(capsData.usage ?? { total: 0, byFeature: {}, since: new Date().toISOString() });
	                        }
	                        if (jobsRes.ok) {
	                          const jobsData = await jobsRes.json();
	                          setJobHistory((jobsData.jobs ?? []) as AiJobSummary[]);
	                        }
	                      })
	                      .catch(() => setAiOpsError("Could not refresh AI data."))
	                      .finally(() => setAiOpsLoading(false));
	                  }
	                }}
	                className="font-mono text-[10px] uppercase tracking-widest"
	              >
	                {aiOpsLoading ? "Refreshing..." : "Refresh"}
	              </Button>
	            </div>

	            {aiOpsError && (
	              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
	                {aiOpsError}
	              </div>
	            )}

	            <div className="grid gap-3 md:grid-cols-3">
	              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2">
	                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Resolved Plan</p>
	                <p className="text-sm font-semibold mt-1 capitalize">{tierInfo?.resolvedPlan ?? "free"}</p>
	              </div>
	              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2">
	                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Stored Plan</p>
	                <p className="text-sm font-semibold mt-1 capitalize">{tierInfo?.storedPlan ?? "free"}</p>
	              </div>
	              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2">
	                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Calls This Window</p>
	                <p className="text-sm font-semibold mt-1">{usageSnapshot?.total ?? 0}</p>
	              </div>
	            </div>

	            {tierInfo?.aiTierUpdatedAt && (
	              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
	                Plan updated: {new Date(tierInfo.aiTierUpdatedAt).toLocaleString()}
	              </p>
	            )}

	            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-2">
	              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Usage By Feature</p>
	              {usageSnapshot && Object.keys(usageSnapshot.byFeature).length > 0 ? (
	                <div className="grid gap-1 md:grid-cols-2">
	                  {Object.entries(usageSnapshot.byFeature)
	                    .sort((a, b) => b[1] - a[1])
	                    .map(([feature, count]) => (
	                      <div key={feature} className="flex items-center justify-between text-xs">
	                        <span className="capitalize text-muted-foreground">{feature.replace(/-/g, " ")}</span>
	                        <span className="font-semibold">{count}</span>
	                      </div>
	                    ))}
	                </div>
	              ) : (
	                <p className="text-xs text-muted-foreground">No AI usage recorded yet in the current window.</p>
	              )}
	            </div>

	            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-2">
	              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Recent AI Jobs</p>
	              {jobHistory.length === 0 ? (
	                <p className="text-xs text-muted-foreground">No jobs yet.</p>
	              ) : (
	                <div className="space-y-2">
	                  {jobHistory.slice(0, 6).map((job) => (
	                    <div key={job.id} className="flex items-center justify-between rounded-md border border-outline-variant/15 px-2 py-1.5 text-xs">
	                      <div className="min-w-0">
	                        <p className="font-mono truncate">{job.id}</p>
	                        <p className="text-muted-foreground capitalize">{job.type} · {job.plan}</p>
	                      </div>
	                      <span className={cn(
	                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
	                        job.status === "completed" && "bg-emerald-500/10 text-emerald-500",
	                        job.status === "failed" && "bg-destructive/10 text-destructive",
	                        (job.status === "queued" || job.status === "running") && "bg-amber-500/10 text-amber-500"
	                      )}>
	                        {job.status}
	                      </span>
	                    </div>
	                  ))}
	                </div>
	              )}
	            </div>

	            <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-3">
	              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-indigo-500">
	                Tier Override (Admin / Local)
	              </p>
	              <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
	                <input
	                  type="text"
	                  value={tierTargetUserId}
	                  onChange={(e) => setTierTargetUserId(e.target.value)}
	                  placeholder="Target user id (optional, blank = me)"
	                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-xs focus:border-primary/50 focus:outline-none"
	                />
	                <select
	                  value={tierTargetPlan}
	                  onChange={(e) => setTierTargetPlan(e.target.value as AiPlan)}
	                  className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-xs focus:border-primary/50 focus:outline-none"
	                >
	                  <option value="free">Free</option>
	                  <option value="professional">Professional</option>
	                  <option value="team">Team</option>
	                  <option value="enterprise">Enterprise</option>
	                </select>
	                <Button
	                  type="button"
	                  onClick={handleTierUpdate}
	                  disabled={tierSaving}
	                  className="btn-gitscope-primary font-mono text-[10px] uppercase tracking-widest"
	                >
	                  {tierSaving ? "Updating..." : "Update Tier"}
	                </Button>
	              </div>
	              {tierMsg && (
	                <p className={cn("text-xs", tierMsg.type === "success" ? "text-emerald-500" : "text-destructive")}>
	                  {tierMsg.text}
	                </p>
	              )}
	            </div>
	          </div>

	          {/* Personal GitHub API Key */}
	          {provider !== "github" && (
            <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
              <h3 className="font-heading text-lg font-bold text-foreground mb-1">Personal GitHub Token</h3>
	              <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
	                Add your own{" "}
	                <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-primary underline">
	                  GitHub Personal Access Token
	                </a>{" "}
	                to raise the API rate limit from 60 to 5,000 req/hr without connecting GitHub OAuth. Tokens are stored encrypted and never exposed.
	              </p>
	              <div className="mb-5 rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3">
	                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
	                  Quick Setup
	                </p>
	                <ol className="list-decimal pl-4 space-y-1 text-xs text-muted-foreground">
	                  <li>Open GitHub token settings and create a personal access token.</li>
	                  <li>Copy the token value once and paste it below.</li>
	                  <li>Click Save Token and verify status turns active.</li>
	                </ol>
	              </div>
	              {hasGithubApiKey ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                    <MaterialIcon name="check_circle" size={14} className="text-emerald-500 shrink-0" />
                    <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">Token active — rate limit boosted to 5,000 req/hr</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={apiKeySaving}
                    onClick={() => handleSaveApiKey(true)}
                    className="text-destructive border-destructive/30 hover:bg-destructive/10 font-mono text-[10px] uppercase tracking-widest"
                  >
                    {apiKeySaving ? "Removing..." : "Remove Token"}
                  </Button>
                  {apiKeyMsg && (
                    <p className={cn("font-mono text-xs", apiKeyMsg.type === "success" ? "text-tertiary" : "text-destructive")}>
                      {apiKeyMsg.text}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3 max-w-md">
                  <input
                    type="password"
                    value={githubApiKeyInput}
                    onChange={(e) => setGithubApiKeyInput(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={apiKeySaving || !githubApiKeyInput.trim()}
                    onClick={() => handleSaveApiKey(false)}
                    className="btn-gitscope-primary font-mono text-[10px] uppercase tracking-widest"
                  >
                    {apiKeySaving ? "Saving..." : "Save Token"}
                  </Button>
                  {apiKeyMsg && (
                    <p className={cn("font-mono text-xs", apiKeyMsg.type === "success" ? "text-tertiary" : "text-destructive")}>
                      {apiKeyMsg.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sticky save bar (Profile + Workspace tabs only) */}
      {dirty && activeTab !== "account" && activeTab !== "appearance" && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed right-0 bottom-0 left-0 z-50 border-t border-outline-variant/15 bg-surface-container-lowest/95 px-6 py-3 backdrop-blur-md lg:left-64"
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-destructive" />
              <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                Unsaved modifications detected
              </span>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" size="sm" onClick={handleDiscard} className="font-mono text-[10px] tracking-widest uppercase">
                Discard
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={saving} className="btn-gitscope-primary font-mono text-[10px] tracking-widest uppercase">
                {saving ? "Saving..." : "Commit Changes"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
