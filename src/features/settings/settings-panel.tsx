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
import { useSession, signIn } from "next-auth/react";
import { performLogout } from "@/lib/client-auth";

type SettingsTab = "profile" | "account" | "appearance" | "workspace" | "integrations" | "automation" | "api-keys";
type ThemeOption = "light" | "dark" | "system";
type AiPlan = "free" | "developer";

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
  { id: "profile",      label: "Profile",      icon: "person" },
  { id: "account",      label: "Account",      icon: "manage_accounts" },
  { id: "appearance",   label: "Appearance",   icon: "palette" },
  { id: "workspace",    label: "Workspace",    icon: "tune" },
  { id: "integrations", label: "Integrations", icon: "extension" },
  { id: "automation",   label: "Automation",   icon: "bolt" },
  { id: "api-keys",     label: "API Keys",     icon: "vpn_key" },
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

  // BYOK (Bring Your Own Key) state — core providers
  const [byokSaved, setByokSaved] = useState({
    anthropic: false, openai: false, gemini: false,
    groq: false, deepseek: false, mistral: false, moonshot: false, cerebras: false, ollama: false,
  });
  const [byokAnthropicInput, setByokAnthropicInput] = useState("");
  const [byokOpenAIInput, setByokOpenAIInput]       = useState("");
  const [byokGeminiInput, setByokGeminiInput]       = useState("");
  const [byokGroqInput, setByokGroqInput]           = useState("");
  const [byokDeepSeekInput, setByokDeepSeekInput]   = useState("");
  const [byokMistralInput, setByokMistralInput]     = useState("");
  const [byokMoonshotInput, setByokMoonshotInput]   = useState("");
  const [byokCerebrasInput, setByokCerebrasInput]   = useState("");
  const [byokOllamaInput, setByokOllamaInput]       = useState("");
  const [byokPreferPlatform, setByokPreferPlatform] = useState(false);
  const [byokSaving, setByokSaving]                 = useState(false);
  const [byokMsg, setByokMsg]                       = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Profile meta (extra fields)
  const [location, setLocation]     = useState("");
  const [website, setWebsite]       = useState("");
  const [role, setRole]             = useState("");
  const [company, setCompany]       = useState("");
  const [timezone, setTimezone]     = useState("");
  const [primaryStack, setPrimaryStack] = useState("");

  // Automation rules state
  const [autoRules, setAutoRules] = useState<{
    id: string; name: string; enabled: boolean;
    triggerMetric: string; triggerOp: string; triggerThreshold: number;
    actionType: string; actionUrl: string | null; repoFilter: string | null;
    lastTriggeredAt: string | null; triggerCount: number;
  }[]>([]);
  const [autoLoading,   setAutoLoading]   = useState(false);
  const [showRuleForm,  setShowRuleForm]  = useState(false);
  const [ruleFormState, setRuleFormState] = useState({
    name: "", triggerMetric: "healthScore", triggerOp: "lt",
    triggerThreshold: "60", actionType: "slack", actionUrl: "", repoFilter: "",
  });
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleMsg,    setRuleMsg]    = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Public API Keys (REST API key management) state
  const [pubApiKeys, setPubApiKeys] = useState<{
    id: string; name: string; prefix: string; scopes: string[];
    lastUsedAt: string | null; expiresAt: string | null; createdAt: string;
  }[]>([]);
  const [pubApiKeysLoading, setPubApiKeysLoading] = useState(false);
  const [pubApiKeyMaxKeys, setPubApiKeyMaxKeys] = useState(0);
  const [newPubKeyName, setNewPubKeyName] = useState("");
  const [newPubKeyScopes, setNewPubKeyScopes] = useState<string[]>(["repos:read", "scans:read"]);
  const [newPubKeyExpiry, setNewPubKeyExpiry] = useState("90");
  const [pubApiKeyCreating, setPubApiKeyCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [pubApiKeyMsg, setPubApiKeyMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteEmailInput, setDeleteEmailInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  // AI plan + usage ops state
  const [tierInfo, setTierInfo] = useState<{
    resolvedPlan: AiPlan;
    storedPlan: AiPlan;
    aiTierUpdatedAt: string | null;
    canManage: boolean;
  } | null>(null);
  const [usageSnapshot, setUsageSnapshot] = useState<AiUsageSnapshot | null>(null);
  const [jobHistory, setJobHistory] = useState<AiJobSummary[]>([]);
  const [aiOpsLoading, setAiOpsLoading] = useState(false);
  const [aiOpsError, setAiOpsError] = useState<string | null>(null);
  const [tierTargetUserId, setTierTargetUserId] = useState("");
  const [tierTargetPlan, setTierTargetPlan] = useState<AiPlan>("developer");
  const [tierSaving, setTierSaving] = useState(false);
  const [tierMsg, setTierMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Connected OAuth providers from database (not just current session)
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // ── Integrations state ─────────────────────────────────────────────────────
  const [slackWebhook, setSlackWebhook]           = useState("");
  const [slackSaved, setSlackSaved]               = useState(false);  // true = has saved webhook
  const [slackSaving, setSlackSaving]             = useState(false);
  const [slackMsg, setSlackMsg]                   = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [slackTestSending, setSlackTestSending]   = useState(false);

  const [discordWebhook, setDiscordWebhook]         = useState("");
  const [discordSaved, setDiscordSaved]             = useState(false);
  const [discordSaving, setDiscordSaving]           = useState(false);
  const [discordMsg, setDiscordMsg]                 = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [discordTestSending, setDiscordTestSending] = useState(false);

  const [weeklyDigest, setWeeklyDigest]           = useState(false);
  const [digestLastSent, setDigestLastSent]        = useState<string | null>(null);
  const [digestSending, setDigestSending]         = useState(false);
  const [digestMsg, setDigestMsg]                 = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [ghAppInstalled, setGhAppInstalled]       = useState(false);
  const [ghAppInstallUrl, setGhAppInstallUrl]     = useState<string | null>(null);
  const [ghAppConfigured, setGhAppConfigured]     = useState(false);
  const [ghInstallIdInput, setGhInstallIdInput]   = useState("");
  const [ghAppSaving, setGhAppSaving]             = useState(false);
  const [ghAppMsg, setGhAppMsg]                   = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load all settings data in a single fetch
  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as SettingsTab | null;
    if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab);

    // Load all settings data from consolidated endpoint
    setSettingsLoading(true);
    fetch("/api/user/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        
        // Profile data
        if (data.profile) {
          dispatch(
            updateProfile({
              displayName: data.profile.name ?? session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "",
              gitHandle: data.profile.githubHandle ?? "",
              bio: data.profile.bio ?? "",
            })
          );
          setHasPassword(data.profile.hasPassword ?? false);
          setHasGithubApiKey(data.profile.hasGithubApiKey ?? false);
        }
        // BYOK key presence
        if (data.byok) {
          setByokSaved({
            anthropic: data.byok.anthropic  ?? data.byok.hasAnthropic ?? false,
            openai:    data.byok.openai     ?? data.byok.hasOpenAI    ?? false,
            gemini:    data.byok.gemini     ?? data.byok.hasGemini    ?? false,
            groq:      data.byok.groq       ?? false,
            deepseek:  data.byok.deepseek   ?? false,
            mistral:   data.byok.mistral    ?? false,
            moonshot:  data.byok.moonshot   ?? false,
            cerebras:  data.byok.cerebras   ?? false,
            ollama:    data.byok.ollama     ?? false,
          });
          setByokPreferPlatform(data.byok.preferPlatform ?? false);
        }
        // Profile meta (extra fields)
        if (data.profileMeta) {
          setLocation(data.profileMeta.location ?? "");
          setWebsite(data.profileMeta.website ?? "");
          setRole(data.profileMeta.role ?? "");
          setCompany(data.profileMeta.company ?? "");
          setTimezone(data.profileMeta.timezone ?? "");
          setPrimaryStack(data.profileMeta.primaryStack ?? "");
        }
        
        // Connected providers
        if (data.connectedProviders) {
          setConnectedProviders(data.connectedProviders);
        }
        
        // AI tier info
        if (data.aiTier) {
          setTierInfo({
            resolvedPlan: data.aiTier.resolvedPlan,
            storedPlan: data.aiTier.storedPlan,
            aiTierUpdatedAt: data.aiTier.aiTierUpdatedAt,
            canManage: data.aiTier.canManage,
          });
        }
        
        // AI jobs
        if (data.recentJobs) {
          setJobHistory(data.recentJobs as AiJobSummary[]);
        }
        
        // AI usage
        if (data.aiUsage) {
          setUsageSnapshot({
            total: data.aiUsage.totalEvents,
            byFeature: {}, // Can be extended if needed
            since: new Date().toISOString(),
          });
        }
      })
      .then(() => {
        // Load integrations in parallel
        Promise.all([
          fetch("/api/user/digest").then(r => r.ok ? r.json() : null),
          fetch("/api/github-app/status").then(r => r.ok ? r.json() : null),
          fetch("/api/user/discord").then(r => r.ok ? r.json() : null),
        ]).then(([digestData, ghData, discordData]) => {
          if (digestData) {
            setWeeklyDigest(digestData.weeklyDigestEnabled ?? false);
            setDigestLastSent(digestData.weeklyDigestLastSent ?? null);
            setSlackSaved(digestData.hasSlack ?? false);
          }
          if (ghData) {
            setGhAppInstalled(ghData.installed ?? false);
            setGhAppInstallUrl(ghData.installUrl ?? null);
            setGhAppConfigured(ghData.appConfigured ?? false);
          }
          if (discordData) {
            setDiscordSaved(discordData.saved ?? false);
          }
        }).catch(() => { /* non-fatal */ });
      })
      .catch(() => {
        // Fallback: at least set display name from session
        if (session?.user && !displayName) {
          dispatch(
            updateProfile({
              displayName: session.user.name ?? session.user.email?.split("@")[0] ?? "",
            })
          );
        }
      })
      .finally(() => setSettingsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Sync local avatar input when Redux value changes (e.g. "Use OAuth photo" button or default avatar click)
  useEffect(() => {
    setAvatarUrlInput(avatarUrl ?? "");
  }, [avatarUrl]);

  useEffect(() => {
    if (activeTab !== "workspace" || !session?.user?.id || jobHistory.length > 0) return;

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
            canManage: Boolean(tierData.canManage),
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

  // Load automation rules when the automation tab is activated
  useEffect(() => {
    if (activeTab !== "automation") return;
    void (async () => {
      setAutoLoading(true);
      try {
        const res = await fetch("/api/webhook-rules");
        if (res.ok) { const d = await res.json(); setAutoRules(d.rules ?? []); }
      } catch { /* ignore */ }
      finally { setAutoLoading(false); }
    })();
  }, [activeTab]);

  // Load public API keys when the api-keys tab is activated
  useEffect(() => {
    if (activeTab !== "api-keys") return;
    void (async () => {
      setPubApiKeysLoading(true);
      try {
        const res = await fetch("/api/user/api-keys");
        if (res.ok) {
          const d = await res.json() as { keys: typeof pubApiKeys; maxKeys: number };
          setPubApiKeys(d.keys ?? []);
          setPubApiKeyMaxKeys(d.maxKeys ?? 0);
        }
      } catch { /* ignore */ }
      finally { setPubApiKeysLoading(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName, bio, gitHandle, avatarUrl: avatarUrl || undefined,
          profileMeta: { location, website, role, company, timezone, primaryStack },
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setDirty(false);
    } catch (e) {
      // dirty flag intentionally kept so user knows save failed
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
                            canManage: Boolean(tierData.canManage),
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

  // ── Integration handlers ───────────────────────────────────────────────────
  const handleSaveSlack = async (remove = false) => {
    setSlackSaving(true);
    setSlackMsg(null);
    try {
      const res = await fetch("/api/user/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackWebhookUrl: remove ? null : slackWebhook.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setSlackMsg({ type: "success", text: remove ? "Slack disconnected." : "Slack webhook saved." });
        setSlackSaved(!remove);
        if (remove) setSlackWebhook("");
      } else {
        setSlackMsg({ type: "error", text: data.error ?? "Failed to save Slack webhook." });
      }
    } catch {
      setSlackMsg({ type: "error", text: "An error occurred." });
    } finally {
      setSlackSaving(false);
    }
  };

  const handleTestSlack = async () => {
    setSlackTestSending(true);
    setSlackMsg(null);
    try {
      const res = await fetch("/api/user/digest?send=1", { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } });
      if (res.ok) {
        setSlackMsg({ type: "success", text: "Test digest sent to Slack!" });
      } else {
        const d = await res.json();
        setSlackMsg({ type: "error", text: d.error ?? "Failed to send test." });
      }
    } catch {
      setSlackMsg({ type: "error", text: "An error occurred." });
    } finally {
      setSlackTestSending(false);
    }
  };

  const handleSaveDiscord = async (remove = false) => {
    setDiscordSaving(true);
    setDiscordMsg(null);
    try {
      const res = await fetch("/api/user/discord", {
        method: remove ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: remove ? undefined : JSON.stringify({ webhookUrl: discordWebhook.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        if (remove) {
          setDiscordSaved(false);
          setDiscordWebhook("");
          setDiscordMsg({ type: "success", text: "Discord webhook removed." });
        } else {
          setDiscordSaved(true);
          setDiscordWebhook("");
          setDiscordMsg({ type: "success", text: "Discord webhook connected." });
        }
      } else {
        setDiscordMsg({ type: "error", text: d.error ?? "Failed to save." });
      }
    } catch {
      setDiscordMsg({ type: "error", text: "An error occurred." });
    } finally {
      setDiscordSaving(false);
    }
  };

  const handleTestDiscord = async () => {
    setDiscordTestSending(true);
    setDiscordMsg(null);
    try {
      const res = await fetch("/api/user/discord", { method: "PATCH" });
      if (res.ok) {
        setDiscordMsg({ type: "success", text: "Test message sent to Discord!" });
      } else {
        const d = await res.json();
        setDiscordMsg({ type: "error", text: d.error ?? "Failed to send test." });
      }
    } catch {
      setDiscordMsg({ type: "error", text: "An error occurred." });
    } finally {
      setDiscordTestSending(false);
    }
  };

  const handleToggleDigest = async (enabled: boolean) => {
    setWeeklyDigest(enabled);
    setDigestMsg(null);
    try {
      const res = await fetch("/api/user/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyDigestEnabled: enabled }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.upgradeRequired) {
          setDigestMsg({ type: "error", text: "Weekly digest requires Developer plan." });
          setWeeklyDigest(false);
        }
      }
    } catch {
      setDigestMsg({ type: "error", text: "An error occurred." });
    }
  };

  const handleSendDigestNow = async () => {
    setDigestSending(true);
    setDigestMsg(null);
    try {
      const res = await fetch("/api/user/digest?send=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setDigestMsg({ type: "success", text: `Digest sent! ${data.repoCount} repos, avg score ${data.avgScore}.` });
        setDigestLastSent(new Date().toISOString());
      } else {
        setDigestMsg({ type: "error", text: data.error ?? "Failed to send digest." });
      }
    } catch {
      setDigestMsg({ type: "error", text: "An error occurred." });
    } finally {
      setDigestSending(false);
    }
  };

  const handleSaveGhApp = async (clear = false) => {
    setGhAppSaving(true);
    setGhAppMsg(null);
    try {
      const res = await fetch("/api/github-app/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: clear ? null : ghInstallIdInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setGhAppMsg({ type: "success", text: clear ? "GitHub App disconnected." : "Installation ID saved." });
        setGhAppInstalled(!clear);
        if (clear) setGhInstallIdInput("");
      } else {
        setGhAppMsg({ type: "error", text: data.error ?? "Failed to save." });
      }
    } catch {
      setGhAppMsg({ type: "error", text: "An error occurred." });
    } finally {
      setGhAppSaving(false);
    }
  };

  const currentTheme = (theme ?? "system") as ThemeOption;
  const ratePct = rateLimit ? Math.round((rateLimit.remaining / rateLimit.limit) * 100) : 100;
  const ratePctClass =
    ratePct > 50 ? "from-tertiary to-emerald-400" : ratePct > 20 ? "from-amber-400 to-yellow-400" : "from-destructive to-red-400";

  // Check if provider is connected using database-stored providers, not just current session
  const isProviderConnected = (providerName: string) => connectedProviders.includes(providerName);
  const hasGithub = isProviderConnected("github");
  const hasCredentials = isProviderConnected("credentials") || hasPassword;

  const themeOptions: { value: ThemeOption; label: string; bgClass: string }[] = [
    { value: "light", label: "Light", bgClass: "bg-stone-200" },
    { value: "dark", label: "Dark", bgClass: "bg-[#100f0d]" },
    { value: "system", label: "System", bgClass: "bg-linear-to-br from-stone-200 to-[#100f0d]" },
  ];

  // ── BYOK handlers ────────────────────────────────────────────────────────────
  type ByokProvider = "anthropic" | "openai" | "gemini" | "groq" | "deepseek" | "mistral" | "moonshot" | "cerebras" | "ollama";

  const PROVIDER_LABELS: Record<ByokProvider, string> = {
    anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini",
    groq: "Groq", deepseek: "DeepSeek", mistral: "Mistral",
    moonshot: "Kimi (Moonshot)", cerebras: "Cerebras", ollama: "Ollama",
  };

  const clearInput = (provider: ByokProvider) => {
    if (provider === "anthropic") setByokAnthropicInput("");
    if (provider === "openai")    setByokOpenAIInput("");
    if (provider === "gemini")    setByokGeminiInput("");
    if (provider === "groq")      setByokGroqInput("");
    if (provider === "deepseek")  setByokDeepSeekInput("");
    if (provider === "mistral")   setByokMistralInput("");
    if (provider === "moonshot")  setByokMoonshotInput("");
    if (provider === "cerebras")  setByokCerebrasInput("");
    if (provider === "ollama")    setByokOllamaInput("");
  };

  const handleSaveByok = async (provider: ByokProvider, key: string) => {
    setByokSaving(true);
    setByokMsg(null);
    try {
      const res = await fetch("/api/user/byok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setByokSaved((prev) => ({ ...prev, [provider]: true }));
      clearInput(provider);
      setByokMsg({ type: "success", text: `${PROVIDER_LABELS[provider]} key saved and encrypted.` });
    } catch (e) {
      setByokMsg({ type: "error", text: e instanceof Error ? e.message : "Failed to save key." });
    } finally {
      setByokSaving(false);
    }
  };

  const handleDeleteByok = async (provider: ByokProvider) => {
    setByokSaving(true);
    setByokMsg(null);
    try {
      const res = await fetch("/api/user/byok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: null }),
      });
      if (!res.ok) throw new Error("Remove failed");
      setByokSaved((prev) => ({ ...prev, [provider]: false }));
      setByokMsg({ type: "success", text: `${PROVIDER_LABELS[provider]} key removed.` });
    } catch {
      setByokMsg({ type: "error", text: "Failed to remove key." });
    } finally {
      setByokSaving(false);
    }
  };

  const handleByokPreferPlatformToggle = async (val: boolean) => {
    setByokPreferPlatform(val);
    await fetch("/api/user/byok-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferPlatform: val }),
    }).catch(() => {/* non-critical */});
  };

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
      <div className="mb-8 flex gap-1 rounded-none border border-outline-variant/15 bg-surface-container p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-none py-2.5 text-xs font-bold transition-all",
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
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-5">Public Profile</h3>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
              {/* avatar */}
              <div className="shrink-0 space-y-4 w-full sm:w-auto">
                {/* Preview */}
                <div className="flex items-center gap-4">
                  <div className="flex size-20 items-center justify-center overflow-hidden rounded-none bg-linear-to-br from-primary/30 to-primary-container/30 text-3xl font-bold text-primary border border-outline-variant/15 shrink-0">
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
                        className="flex items-center gap-1.5 text-[10px] font-bold text-amber-400 hover:text-amber-300 transition-colors"
                        onClick={() => { dispatch(setAvatarUrl(session.user!.image!)); setAvatarCleared(false); setDirty(true); }}
                      >
                        <MaterialIcon name="sync" size={12} />
                        Use {hasGithub ? "GitHub" : "OAuth"} photo
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

                {/* Default avatars grid — 54 options across 9 styles */}
                <div>
                  <p className="mb-2 font-mono text-[9px] font-bold tracking-widest text-muted-foreground uppercase">Choose Avatar</p>
                  <div className="max-h-48 overflow-y-auto pr-1">
                    <div className="grid grid-cols-6 gap-1.5">
                      {[
                        // Bottts (robot avatars)
                        "https://api.dicebear.com/7.x/bottts/svg?seed=alpha&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/bottts/svg?seed=beta&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/bottts/svg?seed=gamma&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/bottts/svg?seed=delta&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/bottts/svg?seed=epsilon&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/bottts/svg?seed=zeta&backgroundColor=ef4444",
                        // Pixel Art
                        "https://api.dicebear.com/7.x/pixel-art/svg?seed=gitscope&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/pixel-art/svg?seed=engineer&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/pixel-art/svg?seed=hacker&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/pixel-art/svg?seed=coder&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/pixel-art/svg?seed=dev&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/pixel-art/svg?seed=builder&backgroundColor=ef4444",
                        // Lorelei (illustrated faces)
                        "https://api.dicebear.com/7.x/lorelei/svg?seed=alex&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/lorelei/svg?seed=morgan&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/lorelei/svg?seed=riley&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/lorelei/svg?seed=taylor&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/lorelei/svg?seed=jordan&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/lorelei/svg?seed=sam&backgroundColor=ef4444",
                        // Fun Emoji
                        "https://api.dicebear.com/7.x/fun-emoji/svg?seed=omega&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/fun-emoji/svg?seed=sigma&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/fun-emoji/svg?seed=theta&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/fun-emoji/svg?seed=kappa&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/fun-emoji/svg?seed=lambda&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/fun-emoji/svg?seed=mu&backgroundColor=ef4444",
                        // Micah (portrait style)
                        "https://api.dicebear.com/7.x/micah/svg?seed=px1&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/micah/svg?seed=px2&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/micah/svg?seed=px3&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/micah/svg?seed=px4&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/micah/svg?seed=px5&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/micah/svg?seed=px6&backgroundColor=ef4444",
                        // Shapes (abstract)
                        "https://api.dicebear.com/7.x/shapes/svg?seed=s1&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/shapes/svg?seed=s2&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/shapes/svg?seed=s3&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/shapes/svg?seed=s4&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/shapes/svg?seed=s5&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/shapes/svg?seed=s6&backgroundColor=ef4444",
                        // Identicon
                        "https://api.dicebear.com/7.x/identicon/svg?seed=i1&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/identicon/svg?seed=i2&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/identicon/svg?seed=i3&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/identicon/svg?seed=i4&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/identicon/svg?seed=i5&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/identicon/svg?seed=i6&backgroundColor=ef4444",
                        // Thumbs
                        "https://api.dicebear.com/7.x/thumbs/svg?seed=t1&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/thumbs/svg?seed=t2&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/thumbs/svg?seed=t3&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/thumbs/svg?seed=t4&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/thumbs/svg?seed=t5&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/thumbs/svg?seed=t6&backgroundColor=ef4444",
                        // Open Peeps (illustrated people)
                        "https://api.dicebear.com/7.x/open-peeps/svg?seed=op1&backgroundColor=6366f1",
                        "https://api.dicebear.com/7.x/open-peeps/svg?seed=op2&backgroundColor=8b5cf6",
                        "https://api.dicebear.com/7.x/open-peeps/svg?seed=op3&backgroundColor=06b6d4",
                        "https://api.dicebear.com/7.x/open-peeps/svg?seed=op4&backgroundColor=10b981",
                        "https://api.dicebear.com/7.x/open-peeps/svg?seed=op5&backgroundColor=f59e0b",
                        "https://api.dicebear.com/7.x/open-peeps/svg?seed=op6&backgroundColor=ef4444",
                      ].map((src) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => { dispatch(setAvatarUrl(src)); setAvatarUrlInput(src); setAvatarCleared(false); setDirty(true); }}
                          className={cn(
                            "size-9 rounded-none overflow-hidden border-2 transition-all hover:scale-110",
                            (avatarUrl === src) ? "border-amber-500 shadow-lg shadow-amber-500/20" : "border-transparent hover:border-outline-variant/40"
                          )}
                          title="Select this avatar"
                        >
                          <Image src={src} width={36} height={36} alt="Avatar option" className="size-full" unoptimized />
                        </button>
                      ))}
                    </div>
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
                      className="flex-1 rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
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
                      className="px-3 py-1.5 rounded-none bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-colors"
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
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
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
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
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
                    className="w-full resize-none rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="role" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                      Role / Title
                    </label>
                    <input
                      id="role"
                      value={role}
                      placeholder="e.g. Senior Engineer, Tech Lead"
                      onChange={(e) => { setRole(e.target.value); setDirty(true); }}
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="company" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                      Company / Org
                    </label>
                    <input
                      id="company"
                      value={company}
                      placeholder="e.g. Acme Corp"
                      onChange={(e) => { setCompany(e.target.value); setDirty(true); }}
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="location" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                      Location
                    </label>
                    <input
                      id="location"
                      value={location}
                      placeholder="e.g. San Francisco, CA"
                      onChange={(e) => { setLocation(e.target.value); setDirty(true); }}
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="website" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                      Website / Portfolio
                    </label>
                    <input
                      id="website"
                      type="url"
                      value={website}
                      placeholder="https://yoursite.com"
                      onChange={(e) => { setWebsite(e.target.value); setDirty(true); }}
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="primary-stack" className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                    Primary Stack
                  </label>
                  <input
                    id="primary-stack"
                    value={primaryStack}
                    placeholder="e.g. TypeScript, Next.js, PostgreSQL, Docker"
                    onChange={(e) => { setPrimaryStack(e.target.value); setDirty(true); }}
                    className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">Comma-separated list of languages, frameworks, and tools</p>
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
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
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
                  className="w-full rounded-none border border-outline-variant/20 bg-surface-container-highest px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                />
                <p className="mt-1 font-mono text-[9px] text-muted-foreground">Your primary email cannot be changed here.</p>
              </div>

              <div>
                <label className="mb-2 block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
                  Connected Sign-In Methods
                </label>
                {/* Active connections */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {(hasCredentials) && (
                    <span className="inline-flex items-center gap-2 rounded-none border border-outline-variant/20 bg-surface-container-highest px-3 py-1.5 text-xs font-bold text-foreground">
                      <MaterialIcon name="lock" size={14} /> Email & Password
                    </span>
                  )}
                  {hasGithub && (
                    <span className="inline-flex items-center gap-2 rounded-none border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      <MaterialIcon name="check_circle" size={14} /> GitHub Connected
                    </span>
                  )}
                  {!hasCredentials && (
                    <span className="inline-flex items-center gap-2 rounded-none border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-600">
                      <MaterialIcon name="info" size={14} /> No password set
                    </span>
                  )}
                </div>

                {/* GitHub connect card */}
                {!hasGithub && (
                  <div className="rounded-none border border-amber-500/20 bg-linear-to-br from-amber-500/5 to-amber-500/5 p-4 mb-3">
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-none bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <MaterialIcon name="hub" size={20} className="text-amber-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground mb-0.5">Connect GitHub</p>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                          Unlock Intelligence Hub, Activity Feed, Organization Pulse, DORA metrics, and a personal 5,000 req/hr API rate limit.
                        </p>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {["Intelligence Hub", "Activity Feed", "Org Pulse", "DORA Metrics"].map(f => (
                            <span key={f} className="text-[10px] font-bold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full border border-amber-500/20">{f}</span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            signIn("github", {
                              callbackUrl: "/settings?tab=account&connected=github",
                            })
                          }
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-none bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 active:scale-[0.98] transition-all"
                        >
                          <MaterialIcon name="hub" size={14} />
                          Connect GitHub Account
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* Password Management */}
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
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
                    className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
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
                  className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
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
                  className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                />
              </div>
              {passwordMsg && (
                <div
                  className={cn(
                    "rounded-none px-3 py-2 text-xs font-medium border",
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
          <div className="rounded-none border border-destructive/20 bg-destructive/5 p-6">
            <h3 className="font-heading text-lg font-bold text-destructive mb-1">Danger Zone</h3>
            <p className="text-xs text-muted-foreground mb-5">These actions are permanent. Proceed with caution.</p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 font-mono text-[10px] tracking-widest uppercase"
                onClick={() => void performLogout()}
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
              <div className="mt-5 rounded-none border border-destructive/30 bg-destructive/10 p-4 space-y-3">
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
                  className="w-full rounded-none border border-destructive/30 bg-surface-container-lowest px-3 py-2 text-sm focus:border-destructive focus:outline-none"
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
                          await performLogout();
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
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-5">Color Theme</h3>
            <div className="flex flex-wrap gap-4">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-label={`Set ${opt.label} theme`}
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-none border-2 p-3 transition-all",
                    mounted && currentTheme === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-outline-variant/20 hover:border-outline-variant/40"
                  )}
                >
                  <div className={cn("flex size-16 items-center justify-center rounded-none", opt.bgClass)}>
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

          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
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
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
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
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
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

            <div className="mt-4 rounded-none bg-surface-container-lowest p-4 space-y-3">
              <div className="flex items-center justify-between font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                <span>API Latency</span>
                <span className={cn(latency > 500 ? "text-amber-400" : "text-tertiary")}>
                  {rateLimitLoading ? "—" : `${latency}ms`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="cloud_done" size={16} className="text-tertiary" />
                <span className="font-mono text-xs">
                  {hasGithub
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
                  hasGithub || hasGithubApiKey
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                )}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {hasGithub
                  ? "GitHub Tier — Full Access"
                  : hasGithubApiKey
                    ? "Custom Token — Full Access"
                    : "Limited — 60 req/hr"}
              </span>
              {!hasGithub && (
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
	          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 space-y-4">
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
          canManage: Boolean(tierData.canManage),
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
	              <div className="rounded-none border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
	                {aiOpsError}
	              </div>
	            )}

	            <div className="grid gap-3 md:grid-cols-3">
	              <div className="rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2">
	                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Resolved Plan</p>
	                <p className="text-sm font-semibold mt-1 capitalize">{tierInfo?.resolvedPlan ?? "free"}</p>
	              </div>
	              <div className="rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2">
	                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Stored Plan</p>
	                <p className="text-sm font-semibold mt-1 capitalize">{tierInfo?.storedPlan ?? "free"}</p>
	              </div>
	              <div className="rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2">
	                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Calls This Window</p>
	                <p className="text-sm font-semibold mt-1">{usageSnapshot?.total ?? 0}</p>
	              </div>
	            </div>

	            {tierInfo?.aiTierUpdatedAt && (
	              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
	                Plan updated: {new Date(tierInfo.aiTierUpdatedAt).toLocaleString()}
	              </p>
	            )}

	            <div className="rounded-none border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-2">
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

	            <div className="rounded-none border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-2">
	              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Recent AI Jobs</p>
	              {jobHistory.length === 0 ? (
	                <p className="text-xs text-muted-foreground">No jobs yet.</p>
	              ) : (
	                <div className="space-y-2">
	                  {jobHistory.slice(0, 6).map((job) => (
	                    <div key={job.id} className="flex items-center justify-between rounded-none border border-outline-variant/15 px-2 py-1.5 text-xs">
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

              {tierInfo?.canManage && (
                <div className="rounded-none border border-amber-500/20 bg-amber-500/5 p-3 space-y-3">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-amber-500">
                    Tier Override (Admin)
                  </p>
                  <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
                    <input
                      type="text"
                      value={tierTargetUserId}
                      onChange={(e) => setTierTargetUserId(e.target.value)}
                      placeholder="Target user id (optional, blank = me)"
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-xs focus:border-primary/50 focus:outline-none"
                    />
                    <select
                      aria-label="Target plan"
                      value={tierTargetPlan}
                      onChange={(e) => setTierTargetPlan(e.target.value as AiPlan)}
                      className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-xs focus:border-primary/50 focus:outline-none"
                    >
                      <option value="free">Free</option>
                      <option value="developer">Developer</option>
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
              )}
	          </div>

	          {/* Personal GitHub API Key */}
          {!hasGithub && (
            <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6">
              <h3 className="font-heading text-lg font-bold text-foreground mb-1">Personal GitHub Token</h3>
	              <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
	                Add your own{" "}
	                <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-primary underline">
	                  GitHub Personal Access Token
	                </a>{" "}
	                to raise the API rate limit from 60 to 5,000 req/hr without connecting GitHub OAuth. Tokens are stored encrypted and never exposed.
	              </p>
	              <div className="mb-5 rounded-none border border-outline-variant/20 bg-surface-container-lowest p-3">
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
                  <div className="flex items-center gap-2 rounded-none border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
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
                    className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-foreground focus:border-primary/50 focus:outline-none"
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

      {/* ── Integrations Tab ── */}
      {activeTab === "integrations" && (
        <div className="space-y-6">

          {/* Slack — Professional+ */}
          {tierInfo?.resolvedPlan === "free" ? (
            <div className="rounded-none border border-outline-variant/15 bg-surface-container/50 p-6 flex items-center gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-none bg-[#4A154B]/10 border border-[#4A154B]/20">
                <svg viewBox="0 0 54 54" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.712 34.138a3.853 3.853 0 0 1-3.853 3.853 3.853 3.853 0 0 1-3.854-3.853 3.853 3.853 0 0 1 3.854-3.854h3.853v3.854z" fill="#E01E5A"/>
                  <path d="M21.587 34.138a3.853 3.853 0 0 1 3.853-3.854 3.853 3.853 0 0 1 3.854 3.854v9.634a3.853 3.853 0 0 1-3.854 3.853 3.853 3.853 0 0 1-3.853-3.853v-9.634z" fill="#E01E5A"/>
                  <path d="M25.44 19.712a3.853 3.853 0 0 1-3.853-3.853 3.853 3.853 0 0 1 3.853-3.854 3.853 3.853 0 0 1 3.854 3.854v3.853H25.44z" fill="#36C5F0"/>
                  <path d="M25.44 21.587a3.853 3.853 0 0 1 3.854 3.853 3.853 3.853 0 0 1-3.854 3.854h-9.634a3.853 3.853 0 0 1-3.853-3.854 3.853 3.853 0 0 1 3.853-3.853h9.634z" fill="#36C5F0"/>
                  <path d="M40.166 25.44a3.853 3.853 0 0 1 3.853 3.853 3.853 3.853 0 0 1-3.853 3.854 3.853 3.853 0 0 1-3.854-3.854V25.44h3.854z" fill="#2EB67D"/>
                  <path d="M38.291 25.44a3.853 3.853 0 0 1-3.853-3.853 3.853 3.853 0 0 1 3.853-3.854h9.634a3.853 3.853 0 0 1 3.854 3.854 3.853 3.853 0 0 1-3.854 3.853h-9.634z" fill="#2EB67D"/>
                  <path d="M34.438 40.166a3.853 3.853 0 0 1-3.854 3.853 3.853 3.853 0 0 1-3.853-3.853 3.853 3.853 0 0 1 3.853-3.854h3.854v3.854z" fill="#ECB22E"/>
                  <path d="M34.438 38.291a3.853 3.853 0 0 1 3.854-3.853 3.853 3.853 0 0 1 3.853 3.853v9.634a3.853 3.853 0 0 1-3.853 3.854 3.853 3.853 0 0 1-3.854-3.854v-9.634z" fill="#ECB22E"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-foreground">Slack Notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">Get scan alerts and PR reviews posted directly to Slack. Available on Professional plan and above.</p>
              </div>
              <a href="/pricing-settings" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-none bg-amber-500 text-white text-[11px] font-black hover:bg-amber-600 transition-colors">
                <MaterialIcon name="upgrade" size={13} className="text-white" /> Upgrade
              </a>
            </div>
          ) : (
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 space-y-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex size-9 items-center justify-center rounded-none bg-[#4A154B]/20 border border-[#4A154B]/30">
                <svg viewBox="0 0 54 54" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.712 34.138a3.853 3.853 0 0 1-3.853 3.853 3.853 3.853 0 0 1-3.854-3.853 3.853 3.853 0 0 1 3.854-3.854h3.853v3.854z" fill="#E01E5A"/>
                  <path d="M21.587 34.138a3.853 3.853 0 0 1 3.853-3.854 3.853 3.853 0 0 1 3.854 3.854v9.634a3.853 3.853 0 0 1-3.854 3.853 3.853 3.853 0 0 1-3.853-3.853v-9.634z" fill="#E01E5A"/>
                  <path d="M25.44 19.712a3.853 3.853 0 0 1-3.853-3.853 3.853 3.853 0 0 1 3.853-3.854 3.853 3.853 0 0 1 3.854 3.854v3.853H25.44z" fill="#36C5F0"/>
                  <path d="M25.44 21.587a3.853 3.853 0 0 1 3.854 3.853 3.853 3.853 0 0 1-3.854 3.854h-9.634a3.853 3.853 0 0 1-3.853-3.854 3.853 3.853 0 0 1 3.853-3.853h9.634z" fill="#36C5F0"/>
                  <path d="M40.166 25.44a3.853 3.853 0 0 1 3.853 3.853 3.853 3.853 0 0 1-3.853 3.854 3.853 3.853 0 0 1-3.854-3.854V25.44h3.854z" fill="#2EB67D"/>
                  <path d="M38.291 25.44a3.853 3.853 0 0 1-3.853-3.853 3.853 3.853 0 0 1 3.853-3.854h9.634a3.853 3.853 0 0 1 3.854 3.854 3.853 3.853 0 0 1-3.854 3.853h-9.634z" fill="#2EB67D"/>
                  <path d="M34.438 40.166a3.853 3.853 0 0 1-3.854 3.853 3.853 3.853 0 0 1-3.853-3.853 3.853 3.853 0 0 1 3.853-3.854h3.854v3.854z" fill="#ECB22E"/>
                  <path d="M34.438 38.291a3.853 3.853 0 0 1 3.854-3.853 3.853 3.853 0 0 1 3.853 3.853v9.634a3.853 3.853 0 0 1-3.853 3.854 3.853 3.853 0 0 1-3.854-3.854v-9.634z" fill="#ECB22E"/>
                </svg>
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground">Slack Notifications</h3>
                <p className="text-xs text-muted-foreground">Get scan alerts, PR reviews, and weekly digests in Slack.</p>
              </div>
              {slackSaved && (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-widest text-emerald-500">
                  <span className="size-1.5 rounded-full bg-current" /> Connected
                </span>
              )}
            </div>

            <div className="rounded-none border border-outline-variant/15 bg-surface-container-lowest p-4 space-y-2">
              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Setup Guide</p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                <li>In Slack: <strong className="text-foreground">Apps</strong> → search <em>Incoming Webhooks</em> → Add to Slack</li>
                <li>Choose a channel and click <strong className="text-foreground">Add Incoming Webhooks Integration</strong></li>
                <li>Copy the Webhook URL and paste it below</li>
              </ol>
            </div>

            {slackSaved ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-none border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <MaterialIcon name="check_circle" size={14} className="text-emerald-500 shrink-0" />
                  <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">Webhook active — alerts will post to your Slack channel</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={slackTestSending} onClick={handleTestSlack} className="font-mono text-[10px] uppercase tracking-widest">
                    {slackTestSending ? "Sending..." : "Send Test Message"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={slackSaving} onClick={() => handleSaveSlack(true)} className="text-destructive border-destructive/30 hover:bg-destructive/10 font-mono text-[10px] uppercase tracking-widest">
                    {slackSaving ? "Removing..." : "Disconnect"}
                  </Button>
                </div>
                {slackMsg && <p className={cn("font-mono text-xs", slackMsg.type === "success" ? "text-tertiary" : "text-destructive")}>{slackMsg.text}</p>}
              </div>
            ) : (
              <div className="space-y-3 max-w-lg">
                <input
                  type="url"
                  value={slackWebhook}
                  onChange={(e) => setSlackWebhook(e.target.value)}
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                  className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <Button type="button" size="sm" disabled={slackSaving || !slackWebhook.trim().startsWith("https://hooks.slack.com")} onClick={() => handleSaveSlack(false)} className="btn-gitscope-primary font-mono text-[10px] uppercase tracking-widest">
                  {slackSaving ? "Saving..." : "Connect Slack"}
                </Button>
                {slackMsg && <p className={cn("font-mono text-xs", slackMsg.type === "success" ? "text-tertiary" : "text-destructive")}>{slackMsg.text}</p>}
              </div>
            )}
          </div>
          )} {/* end Slack gate */}

          {/* Discord — Professional+ */}
          {tierInfo?.resolvedPlan === "free" ? (
            <div className="rounded-none border border-outline-variant/15 bg-surface-container/50 p-6 flex items-center gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-none bg-[#5865F2]/10 border border-[#5865F2]/20">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="#5865F2" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-foreground">Discord Notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">Get scan alerts posted directly to your Discord server. Available on Professional plan and above.</p>
              </div>
              <a href="/pricing-settings" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-none bg-amber-500 text-white text-[11px] font-black hover:bg-amber-600 transition-colors">
                <MaterialIcon name="upgrade" size={13} className="text-white" /> Upgrade
              </a>
            </div>
          ) : (
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 space-y-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex size-9 items-center justify-center rounded-none bg-[#5865F2]/20 border border-[#5865F2]/30">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#5865F2" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground">Discord Notifications</h3>
                <p className="text-xs text-muted-foreground">Get scan alerts and digests posted to your Discord server via webhook.</p>
              </div>
              {discordSaved && (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-widest text-emerald-500">
                  <span className="size-1.5 rounded-full bg-current" /> Connected
                </span>
              )}
            </div>

            <div className="rounded-none border border-outline-variant/15 bg-surface-container-lowest p-4 space-y-2">
              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Setup Guide</p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                <li>In Discord: open your server settings → <strong className="text-foreground">Integrations</strong> → <strong className="text-foreground">Webhooks</strong></li>
                <li>Click <strong className="text-foreground">New Webhook</strong>, choose a channel, and copy the URL</li>
                <li>Paste the Webhook URL below and click Connect</li>
              </ol>
            </div>

            {discordSaved ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-none border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <MaterialIcon name="check_circle" size={14} className="text-emerald-500 shrink-0" />
                  <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">Webhook active — scan alerts will post to your Discord channel</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={discordTestSending} onClick={handleTestDiscord} className="font-mono text-[10px] uppercase tracking-widest">
                    {discordTestSending ? "Sending..." : "Send Test Message"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={discordSaving} onClick={() => handleSaveDiscord(true)} className="text-destructive border-destructive/30 hover:bg-destructive/10 font-mono text-[10px] uppercase tracking-widest">
                    {discordSaving ? "Removing..." : "Disconnect"}
                  </Button>
                </div>
                {discordMsg && <p className={cn("font-mono text-xs", discordMsg.type === "success" ? "text-tertiary" : "text-destructive")}>{discordMsg.text}</p>}
              </div>
            ) : (
              <div className="space-y-3 max-w-lg">
                <input
                  type="url"
                  value={discordWebhook}
                  onChange={(e) => setDiscordWebhook(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="w-full rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-xs text-foreground focus:border-primary/50 focus:outline-none"
                />
                <Button type="button" size="sm" disabled={discordSaving || !discordWebhook.trim().startsWith("https://discord.com/api/webhooks/")} onClick={() => handleSaveDiscord(false)} className="btn-gitscope-primary font-mono text-[10px] uppercase tracking-widest">
                  {discordSaving ? "Saving..." : "Connect Discord"}
                </Button>
                {discordMsg && <p className={cn("font-mono text-xs", discordMsg.type === "success" ? "text-tertiary" : "text-destructive")}>{discordMsg.text}</p>}
              </div>
            )}
          </div>
          )} {/* end Discord gate */}

          {/* Weekly Digest — Professional+ */}
          {tierInfo?.resolvedPlan === "free" ? (
            <div className="rounded-none border border-outline-variant/15 bg-surface-container/50 p-6 flex items-center gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-none bg-amber-500/10 border border-amber-500/20">
                <MaterialIcon name="mail" size={18} className="text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-foreground">Weekly Digest Email</p>
                <p className="text-xs text-muted-foreground mt-0.5">Fleet health summary every Monday morning. Available on Professional plan and above.</p>
              </div>
              <a href="/pricing-settings" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-none bg-amber-500 text-white text-[11px] font-black hover:bg-amber-600 transition-colors">
                <MaterialIcon name="upgrade" size={13} className="text-white" /> Upgrade
              </a>
            </div>
          ) : (
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-none bg-amber-500/10 border border-amber-500/20">
                <MaterialIcon name="mail" size={18} className="text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-heading text-lg font-bold text-foreground">Weekly Digest Email</h3>
                <p className="text-xs text-muted-foreground">A fleet health summary sent every Monday morning.</p>
              </div>
              <Switch
                id="digest-switch"
                checked={weeklyDigest}
                onCheckedChange={handleToggleDigest}
              />
            </div>

            {weeklyDigest && (
              <div className="space-y-3 pl-12">
                <div className="rounded-none border border-amber-500/20 bg-amber-500/5 px-4 py-3 space-y-1">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-amber-400">What&apos;s Included</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                    <li>Average fleet health score and week-over-week delta</li>
                    <li>Top performing repos and at-risk repos</li>
                    <li>Total scans run in the past week</li>
                    <li>Link to open the full dashboard</li>
                  </ul>
                </div>
                {digestLastSent && (
                  <p className="font-mono text-[9px] text-muted-foreground">
                    Last sent: {new Date(digestLastSent).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                )}
                <Button type="button" variant="outline" size="sm" disabled={digestSending} onClick={handleSendDigestNow} className="font-mono text-[10px] uppercase tracking-widest">
                  {digestSending ? "Sending..." : "Send Digest Now"}
                </Button>
                {digestMsg && <p className={cn("font-mono text-xs mt-1", digestMsg.type === "success" ? "text-tertiary" : "text-destructive")}>{digestMsg.text}</p>}
              </div>
            )}

            {!weeklyDigest && (
              <p className="font-mono text-[9px] text-muted-foreground pl-12">
                Toggle on to receive a weekly fleet health summary every Monday morning.
              </p>
            )}
            {digestMsg && !weeklyDigest && (
              <p className={cn("font-mono text-xs pl-12", digestMsg.type === "error" ? "text-destructive" : "text-tertiary")}>{digestMsg.text}</p>
            )}
          </div>
          )} {/* end Weekly Digest gate */}

          {/* GitHub App — Team+ */}
          {false ? (
            <div className="rounded-none border border-outline-variant/15 bg-surface-container/50 p-6 flex items-center gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-none bg-foreground/5 border border-outline-variant/20">
                <MaterialIcon name="integration_instructions" size={18} className="text-foreground/50" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-foreground">GitHub App</p>
                <p className="text-xs text-muted-foreground mt-0.5">Auto-review PRs and post AI analysis as GitHub review comments.</p>
              </div>
              <a href="/pricing-settings" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-none bg-amber-500 text-white text-[11px] font-black hover:bg-amber-600 transition-colors">
                <MaterialIcon name="upgrade" size={13} className="text-white" /> Upgrade
              </a>
            </div>
          ) : (
          <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 space-y-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex size-9 items-center justify-center rounded-none bg-foreground/5 border border-outline-variant/20">
                <MaterialIcon name="integration_instructions" size={18} className="text-foreground/70" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground">GitHub App</h3>
                <p className="text-xs text-muted-foreground">Auto-review PRs and post AI analysis as GitHub review comments.</p>
              </div>
              {ghAppInstalled && (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-widest text-emerald-500">
                  <span className="size-1.5 rounded-full bg-current" /> Installed
                </span>
              )}
            </div>

            {!ghAppConfigured ? (
              <div className="rounded-none border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-amber-400 mb-2">Server Setup Required</p>
                <p className="text-xs text-muted-foreground">
                  The GitScope GitHub App needs to be registered. Ask your admin to set{" "}
                  <code className="font-mono text-[10px] text-foreground bg-surface-container-highest px-1 py-0.5 rounded">GITHUB_APP_ID</code>,{" "}
                  <code className="font-mono text-[10px] text-foreground bg-surface-container-highest px-1 py-0.5 rounded">GITHUB_APP_PRIVATE_KEY</code>, and{" "}
                  <code className="font-mono text-[10px] text-foreground bg-surface-container-highest px-1 py-0.5 rounded">GITHUB_WEBHOOK_SECRET</code> env vars.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-none border border-outline-variant/15 bg-surface-container-lowest p-4 space-y-2">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">What you get</p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                    <li>AI review posted automatically on every PR open/update</li>
                    <li>Verdict (Approve / Request Changes / Comment) as GitHub review</li>
                    <li>Slack notification with PR review summary (if Slack connected)</li>
                  </ul>
                </div>

                {ghAppInstalled ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 rounded-none border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                      <MaterialIcon name="check_circle" size={14} className="text-emerald-500 shrink-0" />
                      <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">GitHub App installed — PR reviews are active</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" disabled={ghAppSaving} onClick={() => handleSaveGhApp(true)} className="text-destructive border-destructive/30 hover:bg-destructive/10 font-mono text-[10px] uppercase tracking-widest">
                      {ghAppSaving ? "Removing..." : "Disconnect App"}
                    </Button>
                    {ghAppMsg && <p className={cn("font-mono text-xs", ghAppMsg.type === "success" ? "text-tertiary" : "text-destructive")}>{ghAppMsg.text}</p>}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {ghAppInstallUrl && (
                      <a
                        href={ghAppInstallUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-none bg-foreground text-background text-sm font-bold hover:bg-foreground/90 transition-colors"
                      >
                        <MaterialIcon name="add" size={16} />
                        Install GitHub App
                      </a>
                    )}
                    <div className="space-y-2">
                      <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        Or enter Installation ID manually
                      </p>
                      <p className="text-xs text-muted-foreground">
                        After installing, find the ID in your GitHub App installation URL:{" "}
                        <code className="font-mono text-[10px]">github.com/settings/installations/{'<ID>'}</code>
                      </p>
                      <div className="flex gap-2 max-w-xs">
                        <input
                          type="text"
                          value={ghInstallIdInput}
                          onChange={(e) => setGhInstallIdInput(e.target.value.replace(/\D/g, ""))}
                          placeholder="12345678"
                          className="flex-1 rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-foreground focus:border-primary/50 focus:outline-none"
                        />
                        <Button type="button" size="sm" disabled={ghAppSaving || !ghInstallIdInput.trim()} onClick={() => handleSaveGhApp(false)} className="btn-gitscope-primary font-mono text-[10px] uppercase tracking-widest">
                          {ghAppSaving ? "Saving..." : "Save"}
                        </Button>
                      </div>
                      {ghAppMsg && <p className={cn("font-mono text-xs", ghAppMsg.type === "success" ? "text-tertiary" : "text-destructive")}>{ghAppMsg.text}</p>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          )} {/* end GitHub App gate */}

          {/* ── AI Provider Keys (BYOK) ── */}
          {(() => {
            const ByokRow = ({
              provKey, label, dot, placeholder, inputValue, setInputValue, inputType = "password",
            }: {
              provKey: ByokProvider; label: string; dot: string; placeholder: string;
              inputValue: string; setInputValue: (v: string) => void; inputType?: string;
            }) => (
              <div className="space-y-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <span className={cn("inline-block size-2 rounded-full", dot)} />
                  {label}
                  {byokSaved[provKey] && <span className="text-emerald-500 normal-case font-normal">✓ saved</span>}
                </p>
                <div className="flex gap-2">
                  <input
                    type={inputType}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={byokSaved[provKey] ? "••••••••••••••••••••" : placeholder}
                    className="flex-1 rounded-none border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-foreground focus:border-primary/50 focus:outline-none min-w-0"
                  />
                  <button type="button" disabled={byokSaving || !inputValue.trim()} onClick={() => handleSaveByok(provKey, inputValue)}
                    className="shrink-0 rounded-none bg-primary px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40">Save</button>
                  {byokSaved[provKey] && (
                    <button type="button" disabled={byokSaving} onClick={() => handleDeleteByok(provKey)}
                      className="shrink-0 rounded-none border border-destructive/30 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10 disabled:opacity-40">Remove</button>
                  )}
                </div>
              </div>
            );

            return (
              <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-none bg-amber-500/10 border border-amber-500/20 shrink-0">
                    <MaterialIcon name="vpn_key" size={18} className="text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-heading text-lg font-bold text-foreground">AI Provider Keys (BYOK)</h3>
                    <p className="text-xs text-muted-foreground">All keys encrypted at rest with AES-256-GCM.</p>
                  </div>
                  {Object.values(byokSaved).some(Boolean) && (
                    <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-widest text-emerald-500">
                      {Object.values(byokSaved).filter(Boolean).length} key{Object.values(byokSaved).filter(Boolean).length !== 1 ? "s" : ""} saved
                    </span>
                  )}
                </div>

                {/* ── Free-tier providers — available to ALL users ── */}
                <div className="space-y-4 rounded-none border border-emerald-500/15 bg-emerald-500/5 p-4">
                  <div className="flex items-start gap-3">
                    <MaterialIcon name="card_giftcard" size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-400">Free AI Boost — Available on all plans</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        These providers have generous <span className="font-bold text-foreground/70">free tiers</span> — no credit card needed.
                        Adding your own key removes platform rate limits and routes your AI calls through your free quota.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[10px]">
                    {[
                      { name: "Groq", desc: "Free-tier Llama access", url: "console.groq.com/keys", color: "text-[#f55036]" },
                      { name: "Gemini", desc: "1,500 req/day (Flash)", url: "aistudio.google.com/apikey", color: "text-[#4285f4]" },
                      { name: "Cerebras", desc: "Fast free inference", url: "cloud.cerebras.ai", color: "text-violet-400" },
                    ].map((p) => (
                      <div key={p.name} className="rounded-none border border-outline-variant/10 bg-surface-container/50 px-3 py-2 space-y-0.5">
                        <p className={cn("font-black uppercase tracking-wider", p.color)}>{p.name}</p>
                        <p className="text-muted-foreground/60">{p.desc}</p>
                        <p className="text-muted-foreground/40 truncate">{p.url}</p>
                      </div>
                    ))}
                  </div>

                  <ByokRow provKey="groq"     label="Groq (Llama — free tier)"                 dot="bg-[#f55036]"  placeholder="gsk_..."    inputValue={byokGroqInput}     setInputValue={setByokGroqInput} />
                  <ByokRow provKey="gemini"   label="Google Gemini (1,500 req/day free)"       dot="bg-[#4285f4]"  placeholder="AIzaSy..."  inputValue={byokGeminiInput}   setInputValue={setByokGeminiInput} />
                  <ByokRow provKey="cerebras" label="Cerebras (Llama 3.1 8B — free tier)"      dot="bg-violet-700" placeholder="csk-..."    inputValue={byokCerebrasInput} setInputValue={setByokCerebrasInput} />
                </div>

                {/* ── Prefer GitScope managed keys toggle ── */}
                {true && (
                  <div className="flex items-center gap-3 rounded-none border border-outline-variant/15 bg-surface-container-high p-3">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-foreground">Use GitScope managed keys instead</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        When enabled, your BYOK keys are ignored and GitScope uses its own shared AI budget (subject to your plan limits).
                      </p>
                    </div>
                    <Switch checked={byokPreferPlatform} onCheckedChange={handleByokPreferPlatformToggle} />
                  </div>
                )}

                {/* ── All providers — available to ALL users ── */}
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-outline-variant/15" />
                      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">All Providers</span>
                      <div className="h-px flex-1 bg-outline-variant/15" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Pay-per-token providers. Adding your key routes all your AI calls through your own account — no platform rate limits.
                      Priority order: Anthropic → OpenAI → Gemini → Groq → Cerebras → DeepSeek → Mistral → Ollama.
                    </p>
                    <ByokRow provKey="anthropic" label="Anthropic (Claude Sonnet)" dot="bg-[#cc785c]" placeholder="sk-ant-api03-..." inputValue={byokAnthropicInput} setInputValue={setByokAnthropicInput} />
                    <ByokRow provKey="openai"    label="OpenAI (GPT-4o)"           dot="bg-[#10a37f]" placeholder="sk-proj-..."     inputValue={byokOpenAIInput}    setInputValue={setByokOpenAIInput} />
                    <ByokRow provKey="deepseek"  label="DeepSeek (very cheap)"     dot="bg-[#0ea5e9]" placeholder="sk-..."          inputValue={byokDeepSeekInput}  setInputValue={setByokDeepSeekInput} />
                    <ByokRow provKey="mistral"   label="Mistral AI"                dot="bg-[#ff7000]" placeholder="xxxxxxxx..."     inputValue={byokMistralInput}   setInputValue={setByokMistralInput} />
                    <ByokRow provKey="moonshot"  label="Kimi / Moonshot"           dot="bg-indigo-500" placeholder="sk-..."         inputValue={byokMoonshotInput}  setInputValue={setByokMoonshotInput} />
                    <ByokRow provKey="ollama"    label="Ollama (local / self-hosted)" dot="bg-slate-500" placeholder="http://localhost:11434" inputValue={byokOllamaInput} setInputValue={setByokOllamaInput} inputType="url" />
                  </div>

                {byokMsg && (
                  <p className={cn("text-xs font-medium", byokMsg.type === "success" ? "text-emerald-500" : "text-destructive")}>
                    {byokMsg.text}
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Automation Rules Tab ─────────────────────────────────────────────── */}
      {activeTab === "automation" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                <MaterialIcon name="bolt" size={20} className="text-amber-500" />
                Automation Rules
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Trigger Slack, Discord, GitHub Issues, or webhooks when scan metrics cross a threshold. Developer plan required.</p>
            </div>
            {tierInfo?.resolvedPlan === "developer" && (
              <button
                type="button"
                onClick={() => { setShowRuleForm((v) => !v); setRuleMsg(null); }}
                className="inline-flex items-center gap-1.5 rounded-none bg-amber-500 hover:bg-amber-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-colors"
              >
                <MaterialIcon name="add" size={14} /> New Rule
              </button>
            )}
          </div>

          {/* Create rule form */}
          {showRuleForm && (
            <div className="rounded-none border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-amber-500">New Automation Rule</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Rule Name</label>
                  <input
                    type="text" placeholder="e.g. Alert if health drops below 60"
                    value={ruleFormState.name}
                    onChange={(e) => setRuleFormState((s) => ({ ...s, name: e.target.value }))}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Metric</label>
                  <select
                    title="Trigger metric"
                    value={ruleFormState.triggerMetric}
                    onChange={(e) => setRuleFormState((s) => ({ ...s, triggerMetric: e.target.value }))}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="healthScore">Health Score</option>
                    <option value="securityScore">Security Score</option>
                    <option value="qualityScore">Quality Score</option>
                    <option value="criticalCount">Critical Issues Count</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Condition</label>
                  <select
                    title="Trigger condition"
                    value={ruleFormState.triggerOp}
                    onChange={(e) => setRuleFormState((s) => ({ ...s, triggerOp: e.target.value }))}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="lt">Falls below ( &lt; )</option>
                    <option value="gt">Exceeds ( &gt; )</option>
                    <option value="drop_by">Drops by ≥ N points</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Threshold</label>
                  <input
                    type="number" min="0" max="999"
                    title="Threshold value"
                    placeholder="e.g. 60"
                    value={ruleFormState.triggerThreshold}
                    onChange={(e) => setRuleFormState((s) => ({ ...s, triggerThreshold: e.target.value }))}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Action</label>
                  <select
                    title="Action to perform"
                    value={ruleFormState.actionType}
                    onChange={(e) => setRuleFormState((s) => ({ ...s, actionType: e.target.value }))}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="slack">Slack (saved webhook)</option>
                    <option value="discord">Discord (saved webhook)</option>
                    <option value="github_issue">Open GitHub Issue</option>
                    <option value="webhook">Custom Webhook URL</option>
                  </select>
                </div>
                {(ruleFormState.actionType === "webhook" || ruleFormState.actionType === "github_issue") && (
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                      {ruleFormState.actionType === "github_issue" ? "GitHub Issues API URL" : "Webhook URL"}
                    </label>
                    <input
                      type="url"
                      placeholder={ruleFormState.actionType === "github_issue" ? "https://api.github.com/repos/owner/repo/issues" : "https://hooks.example.com/..."}
                      value={ruleFormState.actionUrl}
                      onChange={(e) => setRuleFormState((s) => ({ ...s, actionUrl: e.target.value }))}
                      className="w-full rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Repo Filter (optional)</label>
                  <input
                    type="text" placeholder="owner/repo — leave blank to apply to all repos"
                    value={ruleFormState.repoFilter}
                    onChange={(e) => setRuleFormState((s) => ({ ...s, repoFilter: e.target.value }))}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
              {ruleMsg && (
                <p className={cn("text-[11px]", ruleMsg.type === "success" ? "text-emerald-500" : "text-destructive")}>{ruleMsg.text}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowRuleForm(false)} className="rounded-none border border-border px-4 py-2 text-[11px] font-bold text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                <button
                  type="button"
                  disabled={ruleSaving || !ruleFormState.name.trim()}
                  onClick={async () => {
                    setRuleSaving(true); setRuleMsg(null);
                    try {
                      const res = await fetch("/api/webhook-rules", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: ruleFormState.name,
                          triggerMetric: ruleFormState.triggerMetric,
                          triggerOp: ruleFormState.triggerOp,
                          triggerThreshold: Number(ruleFormState.triggerThreshold),
                          actionType: ruleFormState.actionType,
                          actionUrl: ruleFormState.actionUrl || null,
                          repoFilter: ruleFormState.repoFilter || null,
                        }),
                      });
                      const d = await res.json() as { error?: string; rule?: unknown };
                      if (!res.ok) { setRuleMsg({ type: "error", text: d.error ?? "Failed to create rule." }); return; }
                      setRuleMsg({ type: "success", text: "Rule created!" });
                      setShowRuleForm(false);
                      setRuleFormState({ name: "", triggerMetric: "healthScore", triggerOp: "lt", triggerThreshold: "60", actionType: "slack", actionUrl: "", repoFilter: "" });
                      const listRes = await fetch("/api/webhook-rules");
                      if (listRes.ok) { const ld = await listRes.json(); setAutoRules(ld.rules ?? []); }
                    } catch { setRuleMsg({ type: "error", text: "Network error." }); }
                    finally { setRuleSaving(false); }
                  }}
                  className="rounded-none bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-5 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-colors"
                >
                  {ruleSaving ? "Saving…" : "Create Rule"}
                </button>
              </div>
            </div>
          )}

          {/* Upgrade gate */}
          {tierInfo && tierInfo.resolvedPlan !== "developer" && (
            <div className="rounded-none border border-dashed border-amber-500/30 bg-amber-500/5 p-8 text-center space-y-3">
              <MaterialIcon name="bolt" size={32} className="text-amber-500/40 mx-auto" />
              <p className="text-sm font-bold">Developer plan required</p>
              <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                Automation rules trigger Slack, Discord, GitHub Issues, or custom webhooks when your repo health crosses a threshold.
              </p>
              <a href="/pricing" className="inline-flex items-center gap-1.5 rounded-none bg-amber-500 hover:bg-amber-600 px-5 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-colors">
                <MaterialIcon name="upgrade" size={13} /> Upgrade to Developer
              </a>
            </div>
          )}

          {/* Rules list */}
          {autoLoading && (
            <div className="text-center py-6 text-muted-foreground text-sm">Loading rules…</div>
          )}
          {!autoLoading && autoRules.length > 0 && (
            <div className="space-y-3">
              {autoRules.map((rule) => (
                <div key={rule.id} className="rounded-none border border-border bg-card p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold">{rule.name}</span>
                      <span className={cn("text-[9px] font-black uppercase tracking-wider rounded-full border px-2 py-0.5", rule.enabled ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10" : "border-border text-muted-foreground")}>
                        {rule.enabled ? "Active" : "Paused"}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      When <strong>{rule.triggerMetric}</strong> {rule.triggerOp === "lt" ? "falls below" : rule.triggerOp === "gt" ? "exceeds" : "drops by ≥"} <strong>{rule.triggerThreshold}</strong>
                      {rule.repoFilter && <> in <strong>{rule.repoFilter}</strong></>}
                      {" → "}<strong>{rule.actionType}</strong>
                    </p>
                    {rule.lastTriggeredAt && (
                      <p className="text-[10px] text-muted-foreground/60">Last fired: {new Date(rule.lastTriggeredAt).toLocaleString()} · {rule.triggerCount} times total</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      title={rule.enabled ? "Pause rule" : "Activate rule"}
                      onClick={async () => {
                        const res = await fetch(`/api/webhook-rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !rule.enabled }) });
                        if (res.ok) { const d = await res.json(); setAutoRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: d.rule.enabled } : r)); }
                      }}
                      className="p-1.5 rounded-none border border-border hover:bg-muted transition-colors"
                    >
                      <MaterialIcon name={rule.enabled ? "pause" : "play_arrow"} size={14} className="text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      title="Delete rule"
                      onClick={async () => {
                        const res = await fetch(`/api/webhook-rules/${rule.id}`, { method: "DELETE" });
                        if (res.ok) setAutoRules((prev) => prev.filter((r) => r.id !== rule.id));
                      }}
                      className="p-1.5 rounded-none border border-destructive/30 hover:bg-destructive/10 transition-colors"
                    >
                      <MaterialIcon name="delete" size={14} className="text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!autoLoading && autoRules.length === 0 && tierInfo?.resolvedPlan === "developer" && (
            <div className="rounded-none border border-dashed border-border bg-muted/20 p-8 text-center space-y-2">
              <MaterialIcon name="bolt" size={28} className="text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-semibold text-muted-foreground">No automation rules yet</p>
              <p className="text-[11px] text-muted-foreground/70">Create a rule to automatically notify your team when scan scores drop.</p>
            </div>
          )}
        </div>
      )}

      {/* ── API Keys Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "api-keys" && (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground/50">API Keys</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">Use API keys to access GitScope data from your own tools and integrations.</p>
          </div>

          {/* Plan gate */}
          {pubApiKeyMaxKeys === 0 && !pubApiKeysLoading && (
            <div className="rounded-none border border-primary/20 bg-primary/5 p-5 space-y-2">
              <p className="text-sm font-black text-primary flex items-center gap-2">
                <MaterialIcon name="vpn_key" size={16} /> API Keys require Developer plan
              </p>
              <p className="text-[11px] text-muted-foreground/60">Upgrade to generate machine-readable keys for the GitScope REST API.</p>
            </div>
          )}

          {/* Revealed key one-time banner */}
          {revealedKey && (
            <div className="rounded-none border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                <MaterialIcon name="check_circle" size={13} /> Key created — copy it now, it will never be shown again
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-[11px] bg-surface-container-highest px-3 py-2 rounded-none border border-outline-variant/20 text-foreground/80 break-all select-all">
                  {revealedKey}
                </code>
                <button
                  type="button"
                  title="Copy API key"
                  onClick={() => { void navigator.clipboard.writeText(revealedKey); }}
                  className="p-2 rounded-none border border-outline-variant/20 hover:bg-surface-container-highest transition-colors shrink-0"
                >
                  <MaterialIcon name="content_copy" size={14} className="text-muted-foreground" />
                </button>
              </div>
              <button type="button" onClick={() => setRevealedKey(null)} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                Dismiss
              </button>
            </div>
          )}

          {/* Create key form */}
          {pubApiKeyMaxKeys > 0 && pubApiKeys.length < pubApiKeyMaxKeys && (
            <div className="rounded-none border border-outline-variant/10 bg-surface-container/20 p-5 space-y-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Create New Key</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Key Name</label>
                  <input
                    type="text"
                    placeholder="My CI pipeline"
                    value={newPubKeyName}
                    onChange={(e) => setNewPubKeyName(e.target.value)}
                    maxLength={64}
                    title="Key name"
                    className="w-full text-sm bg-surface-container-highest border border-outline-variant/20 rounded-none px-3 py-2 font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Expires In (days)</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={newPubKeyExpiry}
                    onChange={(e) => setNewPubKeyExpiry(e.target.value)}
                    placeholder="90"
                    title="Expiry in days"
                    className="w-full text-sm bg-surface-container-highest border border-outline-variant/20 rounded-none px-3 py-2 font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Scopes</p>
                <div className="flex flex-wrap gap-2">
                  {(["repos:read", "scans:read", "scans:write", "coverage:read", "dora:read"] as const).map((scope) => (
                    <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newPubKeyScopes.includes(scope)}
                        onChange={(e) => setNewPubKeyScopes((prev) =>
                          e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope)
                        )}
                        className="rounded border-border"
                      />
                      <span className="font-mono text-[10px] text-foreground/70">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>
              {pubApiKeyMsg && (
                <p className={`text-xs font-medium ${pubApiKeyMsg.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
                  {pubApiKeyMsg.text}
                </p>
              )}
              <button
                type="button"
                disabled={pubApiKeyCreating || !newPubKeyName.trim()}
                onClick={async () => {
                  setPubApiKeyCreating(true); setPubApiKeyMsg(null); setRevealedKey(null);
                  try {
                    const res = await fetch("/api/user/api-keys", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: newPubKeyName.trim(),
                        scopes: newPubKeyScopes,
                        expiresInDays: parseInt(newPubKeyExpiry, 10) || 90,
                      }),
                    });
                    const d = await res.json() as { rawKey?: string; id?: string; name?: string; prefix?: string; scopes?: string[]; expiresAt?: string | null; createdAt?: string; error?: string };
                    if (!res.ok) { setPubApiKeyMsg({ type: "error", text: d.error ?? "Failed to create key" }); return; }
                    setRevealedKey(d.rawKey ?? null);
                    const { rawKey: _, ...rest } = d;
                    setPubApiKeys((prev) => [{ ...rest, lastUsedAt: null, expiresAt: rest.expiresAt ?? null, createdAt: rest.createdAt ?? new Date().toISOString() } as typeof pubApiKeys[0], ...prev]);
                    setNewPubKeyName(""); setNewPubKeyScopes(["repos:read", "scans:read"]);
                    setPubApiKeyMsg({ type: "success", text: "Key created. Copy it now — you won't see it again." });
                  } catch { setPubApiKeyMsg({ type: "error", text: "Network error" }); }
                  finally { setPubApiKeyCreating(false); }
                }}
                className="px-4 py-2 rounded-none bg-primary/90 hover:bg-primary text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-colors"
              >
                {pubApiKeyCreating ? "Creating…" : "Generate Key"}
              </button>
            </div>
          )}

          {/* Key list */}
          {pubApiKeysLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground/50 text-sm">
              <MaterialIcon name="sync" size={16} className="animate-spin" /> Loading keys…
            </div>
          )}
          {!pubApiKeysLoading && pubApiKeys.length > 0 && (
            <div className="space-y-3">
              {pubApiKeys.map((key) => (
                <div key={key.id} className="flex items-start gap-3 p-4 rounded-none border border-outline-variant/10 bg-surface-container/20">
                  <div className="size-8 rounded-none bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <MaterialIcon name="vpn_key" size={14} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black">{key.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground/50">{key.prefix}…</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {key.scopes.map((s) => (
                        <span key={s} className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-surface-container-highest border border-outline-variant/15 text-muted-foreground/60">{s}</span>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 mt-1">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                      {key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : " · Never used"}
                      {key.expiresAt ? ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    title="Revoke key"
                    onClick={async () => {
                      const res = await fetch(`/api/user/api-keys?id=${key.id}`, { method: "DELETE" });
                      if (res.ok) setPubApiKeys((prev) => prev.filter((k) => k.id !== key.id));
                    }}
                    className="p-1.5 rounded-none border border-destructive/30 hover:bg-destructive/10 transition-colors shrink-0"
                  >
                    <MaterialIcon name="delete" size={14} className="text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!pubApiKeysLoading && pubApiKeys.length === 0 && pubApiKeyMaxKeys > 0 && (
            <div className="rounded-none border border-dashed border-border bg-muted/20 p-8 text-center space-y-2">
              <MaterialIcon name="vpn_key" size={28} className="text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-semibold text-muted-foreground">No API keys yet</p>
              <p className="text-[11px] text-muted-foreground/70">
                Generate a key to access GitScope data from CI pipelines, scripts, or third-party tools.
              </p>
              <p className="text-[10px] text-muted-foreground/50 font-mono">GET /api/v1/repos/&#123;owner&#125;/&#123;repo&#125;/scan</p>
            </div>
          )}

          {/* Endpoint reference */}
          {pubApiKeyMaxKeys > 0 && (
            <div className="rounded-none border border-outline-variant/10 bg-surface-container/20 p-5 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Available Endpoints</p>
              <div className="space-y-2">
                {[
                  { method: "GET", path: "/api/v1/repos/{owner}/{repo}/scan", scope: "scans:read", desc: "Latest scan result" },
                  { method: "GET", path: "/api/v1/repos/{owner}/{repo}/dora", scope: "dora:read",  desc: "DORA metrics" },
                ].map((ep) => (
                  <div key={ep.path} className="flex items-start gap-3 p-3 rounded-none bg-surface-container-highest/30 border border-outline-variant/10">
                    <span className="font-mono text-[9px] px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">{ep.method}</span>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] text-foreground/70 truncate">{ep.path}</p>
                      <p className="text-[9px] text-muted-foreground/50">{ep.desc} · scope: <span className="font-mono">{ep.scope}</span></p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/40">Pass key as <code className="font-mono bg-surface-container-highest px-1 rounded">Authorization: Bearer sk_gs_...</code> or <code className="font-mono bg-surface-container-highest px-1 rounded">X-API-Key</code> header.</p>
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
