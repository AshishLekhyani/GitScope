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
import { useSession, signOut } from "next-auth/react";

type SettingsTab = "profile" | "account" | "appearance" | "workspace";
type ThemeOption = "light" | "dark" | "system";

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

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteEmailInput, setDeleteEmailInput] = useState("");
  const [deleting, setDeleting] = useState(false);

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

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      dispatch(setAvatarUrl(url));
      setDirty(true);
    }
  };

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
        body: JSON.stringify({ displayName, bio, gitHandle }),
      });
      setDirty(false);
    } catch (e) {
      console.error("Failed to save profile", e);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ type: "error", text: "Password must be at least 8 characters." });
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

  const currentTheme = (theme ?? "system") as ThemeOption;
  const ratePct = rateLimit ? Math.round((rateLimit.remaining / rateLimit.limit) * 100) : 100;
  const ratePctClass =
    ratePct > 50 ? "from-tertiary to-emerald-400" : ratePct > 20 ? "from-amber-400 to-yellow-400" : "from-destructive to-red-400";

  const provider = (session as { provider?: string })?.provider;

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
            <div className="flex flex-col gap-6 sm:flex-row">
              {/* avatar */}
              <div className="relative shrink-0">
                <div className="flex size-28 items-center justify-center overflow-hidden rounded-xl bg-linear-to-br from-primary/30 to-primary-container/30 text-4xl font-bold text-primary">
                  {avatarUrl ? (
                    <Image src={avatarUrl} width={112} height={112} alt="Avatar" className="size-full object-cover" />
                  ) : session?.user?.image ? (
                    <Image src={session.user.image} width={112} height={112} alt="Avatar" className="size-full object-cover" />
                  ) : (
                    displayName.charAt(0) || "?"
                  )}
                </div>
                <label
                  htmlFor="avatar-upload"
                  className="absolute -right-1 -bottom-1 flex size-7 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
                  aria-label="Upload avatar"
                >
                  <MaterialIcon name="edit" size={14} />
                  <input id="avatar-upload" type="file" className="sr-only" accept="image/*" onChange={handleAvatarChange} />
                </label>
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
                <div className="flex flex-wrap gap-2">
                  {provider === "github" && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600">
                      <MaterialIcon name="check_circle" size={14} /> GitHub OAuth
                    </span>
                  )}
                  {provider === "google" && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs font-bold text-blue-600">
                      <MaterialIcon name="check_circle" size={14} /> Google OAuth
                    </span>
                  )}
                  {(provider === "credentials" || hasPassword) && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-1.5 text-xs font-bold text-foreground">
                      <MaterialIcon name="lock" size={14} /> Email & Password
                    </span>
                  )}
                  {!hasPassword && provider !== "credentials" && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-600">
                      <MaterialIcon name="info" size={14} /> No password set
                    </span>
                  )}
                </div>
                {provider !== "github" && (
                  <div className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-bold text-indigo-500">Upgrade to GitHub OAuth</span> to unlock Organization Pulse, Recursive Intelligence, real-time activity feeds, and DORA metrics.{" "}
                      <a href="/api/auth/signin/github" className="underline text-indigo-500 hover:text-indigo-400 font-bold">
                        Connect GitHub →
                      </a>
                    </p>
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
                  {session?.accessToken ? "GitHub OAuth active — using your token" : "Credentials auth — public API only"}
                </span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[9px] font-black uppercase tracking-widest border",
                  provider === "github"
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                )}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {provider === "github" ? "GitHub Tier — Full Access" : "Credentials Tier — Limited"}
              </span>
              {provider !== "github" && (
                <p className="font-mono text-[9px] text-muted-foreground">
                  <a href="/api/auth/signin/github" className="text-primary underline">
                    Connect GitHub
                  </a>{" "}
                  to unlock Organization Pulse, Intelligence, and live feeds.
                </p>
              )}
            </div>
          </div>
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
