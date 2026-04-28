"use client";

import { useEffect, useState, useCallback } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

type Tab = "overview" | "users" | "orgs" | "audit" | "announcement" | "usage";

interface Stats {
  totalUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  totalScans: number;
  scansToday: number;
  totalOrgs: number;
  totalApiKeys: number;
  totalAuditEvents: number;
  auditEventsToday: number;
  tierCounts: Record<string, number>;
  activeAnnouncement: { id: string; message: string; type: string } | null;
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  aiTier: string;
  aiTierUpdatedAt: string;
  createdAt: string;
  _count: { repoScanHistory: number; apiKeys: number; orgMemberships: number };
}

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  maxSeats: number;
  createdAt: string;
  owner: { id: string; name: string | null; email: string | null };
  _count: { members: number };
}

interface AuditEntry {
  id: string;
  eventType: string;
  email: string | null;
  ip: string;
  severity: string;
  success: boolean;
  timestamp: string;
  metadata: unknown;
}

interface UsageData {
  window: string;
  since: string;
  totalEvents: number;
  byFeature: { feature: string; units: number; calls: number }[];
  byPlan: { plan: string; units: number; calls: number }[];
  topUsers: { userId: string; email: string; name?: string | null; tier?: string; units: number }[];
}

const TIER_COLORS: Record<string, string> = {
  free: "bg-zinc-500/20 text-zinc-300",
  developer: "bg-amber-500/20 text-amber-300",
  professional: "bg-amber-500/20 text-amber-300",
  team: "bg-amber-500/20 text-amber-300",
  enterprise: "bg-amber-500/20 text-amber-300",
};

const SEV_COLORS: Record<string, string> = {
  info: "text-amber-400",
  warning: "text-amber-400",
  error: "text-orange-400",
  critical: "text-red-400",
};

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview",      label: "Overview",      icon: "dashboard" },
  { id: "users",         label: "Users",         icon: "manage_accounts" },
  { id: "orgs",          label: "Workspaces",    icon: "corporate_fare" },
  { id: "audit",         label: "Audit Log",     icon: "policy" },
  { id: "usage",         label: "AI Usage",      icon: "auto_awesome" },
  { id: "announcement",  label: "Announcement",  icon: "campaign" },
];

const TIERS = ["free", "developer"];

export function AdminPanel({ adminEmail }: { adminEmail: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Stats | null>(null);

  // Users
  const [users, setUsers] = useState<User[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userQ, setUserQ] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [tierChanging, setTierChanging] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [resettingPw, setResettingPw] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ userId: string; msg: string; ok: boolean } | null>(null);

  // Orgs
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgTotal, setOrgTotal] = useState(0);
  const [orgQ, setOrgQ] = useState("");
  const [orgPage, setOrgPage] = useState(1);
  const [seatInput, setSeatInput] = useState<Record<string, string>>({});
  const [seatSaving, setSeatSaving] = useState<string | null>(null);

  // Audit
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logQ, setLogQ] = useState("");
  const [logSev, setLogSev] = useState("");
  const [logPage, setLogPage] = useState(1);

  // Usage
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageWindow, setUsageWindow] = useState("24h");
  const [usageLoading, setUsageLoading] = useState(false);

  // Announcement
  const [annMsg, setAnnMsg] = useState("");
  const [annType, setAnnType] = useState("info");
  const [annSaving, setAnnSaving] = useState(false);
  const [annResult, setAnnResult] = useState("");

  const loadStats = useCallback(async () => {
    const r = await fetch("/api/admin/stats");
    if (r.ok) setStats(await r.json());
  }, []);

  const loadUsers = useCallback(async () => {
    const r = await fetch(`/api/admin/users?q=${encodeURIComponent(userQ)}&page=${userPage}`);
    if (r.ok) { const d = await r.json(); setUsers(d.users); setUserTotal(d.total); }
  }, [userQ, userPage]);

  const loadOrgs = useCallback(async () => {
    const r = await fetch(`/api/admin/orgs?q=${encodeURIComponent(orgQ)}&page=${orgPage}`);
    if (r.ok) { const d = await r.json(); setOrgs(d.orgs); setOrgTotal(d.total); }
  }, [orgQ, orgPage]);

  const loadLogs = useCallback(async () => {
    const r = await fetch(`/api/admin/audit-log?q=${encodeURIComponent(logQ)}&severity=${logSev}&page=${logPage}`);
    if (r.ok) { const d = await r.json(); setLogs(d.logs); setLogTotal(d.total); }
  }, [logQ, logSev, logPage]);

  const loadUsage = useCallback(async (w: string) => {
    setUsageLoading(true);
    try {
      const r = await fetch(`/api/admin/system-usage?window=${w}`);
      if (r.ok) setUsageData(await r.json());
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === "users") loadUsers(); }, [tab, loadUsers]);
  useEffect(() => { if (tab === "orgs") loadOrgs(); }, [tab, loadOrgs]);
  useEffect(() => { if (tab === "audit") loadLogs(); }, [tab, loadLogs]);
  useEffect(() => { if (tab === "usage") loadUsage(usageWindow); }, [tab, usageWindow, loadUsage]);
  useEffect(() => {
    if (tab === "announcement" && stats?.activeAnnouncement) {
      setAnnMsg(stats.activeAnnouncement.message);
      setAnnType(stats.activeAnnouncement.type);
    }
  }, [tab, stats]);

  async function changeTier(userId: string, plan: string) {
    setTierChanging(userId);
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, plan }) });
    setTierChanging(null);
    loadUsers();
  }

  async function deleteUser(userId: string, email: string | null) {
    if (!confirm(`Permanently delete user ${email ?? userId}? This cannot be undone.`)) return;
    setDeletingUser(userId);
    const r = await fetch(`/api/admin/users?userId=${userId}`, { method: "DELETE" });
    setDeletingUser(null);
    if (r.ok) {
      setActionMsg({ userId, msg: "User deleted.", ok: true });
      loadUsers();
      loadStats();
    } else {
      const d = await r.json() as { error?: string };
      setActionMsg({ userId, msg: d.error ?? "Delete failed.", ok: false });
    }
  }

  async function sendPasswordReset(userId: string) {
    setResettingPw(userId);
    const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    setResettingPw(null);
    const d = await r.json() as { ok?: boolean; email?: string; error?: string };
    setActionMsg({ userId, msg: r.ok ? `Password reset sent to ${d.email}` : (d.error ?? "Failed."), ok: r.ok });
  }

  async function saveSeats(orgId: string) {
    const val = parseInt(seatInput[orgId] ?? "", 10);
    if (isNaN(val) || val < 1) return;
    setSeatSaving(orgId);
    await fetch("/api/admin/orgs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, maxSeats: val }) });
    setSeatSaving(null);
    loadOrgs();
  }

  async function saveAnnouncement() {
    setAnnSaving(true);
    setAnnResult("");
    const r = await fetch("/api/admin/announcement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: annMsg, type: annType }) });
    setAnnResult(r.ok ? "Announcement published." : "Failed to publish.");
    setAnnSaving(false);
    loadStats();
  }

  async function clearAnnouncement() {
    setAnnSaving(true);
    await fetch("/api/admin/announcement", { method: "DELETE" });
    setAnnMsg("");
    setAnnResult("Announcement cleared.");
    setAnnSaving(false);
    loadStats();
  }

  const maxUsage = usageData?.byFeature.reduce((m, f) => Math.max(m, f.units), 1) ?? 1;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <div className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <MaterialIcon name="shield" className="text-amber-400" size={20} />
          <span className="font-bold tracking-tight text-sm">GitScope Admin</span>
          <span className="text-xs text-zinc-500 font-mono">{adminEmail}</span>
        </div>
        <a href="/overview" className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors flex items-center gap-1">
          <MaterialIcon name="arrow_back" size={14} /> Back to app
        </a>
      </div>

      <div className="flex h-[calc(100vh-53px)]">
        {/* Sidebar */}
        <nav className="w-52 border-r border-zinc-800 bg-zinc-900/40 flex flex-col pt-4 shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors",
                tab === t.id
                  ? "bg-amber-500/10 text-amber-400 border-r-2 border-amber-400"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
              )}
            >
              <MaterialIcon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── OVERVIEW ── */}
          {tab === "overview" && (
            <div className="space-y-6">
              <h1 className="text-xl font-bold text-zinc-100">Platform Overview</h1>
              {stats ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Total Users",  value: stats.totalUsers,      sub: `+${stats.newUsersToday} today · +${stats.newUsersThisWeek} this week`, icon: "person" },
                      { label: "Total Scans",  value: stats.totalScans,      sub: `${stats.scansToday} today`, icon: "search" },
                      { label: "Workspaces",   value: stats.totalOrgs,       sub: `${stats.totalApiKeys} API keys`, icon: "corporate_fare" },
                      { label: "Audit Events", value: stats.totalAuditEvents, sub: `${stats.auditEventsToday} today`, icon: "policy" },
                    ].map((s) => (
                      <div key={s.label} className="rounded-none border border-zinc-800 bg-zinc-900 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-zinc-500 uppercase tracking-wide">{s.label}</span>
                          <MaterialIcon name={s.icon} size={16} className="text-zinc-600" />
                        </div>
                        <div className="text-2xl font-bold text-zinc-100">{s.value.toLocaleString()}</div>
                        {s.sub && <div className="text-xs text-zinc-500 mt-1">{s.sub}</div>}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-none border border-zinc-800 bg-zinc-900 p-4">
                    <h2 className="text-sm font-semibold text-zinc-300 mb-3">Users by Tier</h2>
                    <div className="flex flex-wrap gap-2">
                      {TIERS.map((tier) => (
                        <div key={tier} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-none text-sm font-mono", TIER_COLORS[tier])}>
                          <span className="capitalize">{tier}</span>
                          <span className="font-bold">{stats.tierCounts[tier] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {stats.activeAnnouncement && (
                    <div className="rounded-none border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
                      <span className="font-semibold">Active announcement:</span> {stats.activeAnnouncement.message}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-zinc-500 text-sm">Loading…</div>
              )}
            </div>
          )}

          {/* ── USERS ── */}
          {tab === "users" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-zinc-100">Users <span className="text-zinc-500 text-base font-normal">({userTotal})</span></h1>
              </div>
              <div className="flex gap-2">
                <input
                  value={userQ}
                  onChange={(e) => { setUserQ(e.target.value); setUserPage(1); }}
                  placeholder="Search by email or name…"
                  className="flex-1 rounded-none border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
                />
                <button type="button" onClick={loadUsers} className="rounded-none border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Search</button>
              </div>

              <div className="rounded-none border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/60">
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">User</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Tier</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Scans / Keys</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Joined</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Change Tier</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <>
                        <tr key={u.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-zinc-200">{u.name ?? "—"}</div>
                            <div className="text-xs text-zinc-500 font-mono">{u.email}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("text-xs px-2 py-0.5 rounded font-mono capitalize", TIER_COLORS[u.aiTier])}>{u.aiTier}</span>
                          </td>
                          <td className="px-4 py-3 text-zinc-400 text-xs">
                            <span>{u._count.repoScanHistory} scans</span>
                            <span className="text-zinc-600 mx-1">·</span>
                            <span>{u._count.apiKeys} keys</span>
                          </td>
                          <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <select
                                title="Change user tier"
                                defaultValue={u.aiTier}
                                onChange={(e) => changeTier(u.id, e.target.value)}
                                disabled={tierChanging === u.id}
                                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                              >
                                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                              {tierChanging === u.id && <span className="text-xs text-zinc-500">Saving…</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                title="Send password reset"
                                onClick={() => sendPasswordReset(u.id)}
                                disabled={resettingPw === u.id}
                                className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition-colors disabled:opacity-40"
                              >
                                {resettingPw === u.id
                                  ? <MaterialIcon name="hourglass_top" size={13} />
                                  : <MaterialIcon name="lock_reset" size={13} />}
                              </button>
                              <button
                                title="Delete user"
                                onClick={() => deleteUser(u.id, u.email)}
                                disabled={deletingUser === u.id}
                                className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-40"
                              >
                                {deletingUser === u.id
                                  ? <MaterialIcon name="hourglass_top" size={13} />
                                  : <MaterialIcon name="delete" size={13} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {actionMsg?.userId === u.id && (
                          <tr key={`${u.id}-msg`} className="border-b border-zinc-800/30">
                            <td colSpan={6} className="px-4 py-1.5">
                              <span className={cn("text-xs", actionMsg.ok ? "text-emerald-400" : "text-red-400")}>{actionMsg.msg}</span>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
                {users.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">No users found.</div>}
              </div>

              {userTotal > 20 && (
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>Page {userPage} of {Math.ceil(userTotal / 20)}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setUserPage((p) => Math.max(1, p - 1))} disabled={userPage === 1} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Prev</button>
                    <button type="button" onClick={() => setUserPage((p) => p + 1)} disabled={userPage * 20 >= userTotal} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Next</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ORGS ── */}
          {tab === "orgs" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-zinc-100">Workspaces <span className="text-zinc-500 text-base font-normal">({orgTotal})</span></h1>
              </div>
              <div className="flex gap-2">
                <input
                  value={orgQ}
                  onChange={(e) => { setOrgQ(e.target.value); setOrgPage(1); }}
                  placeholder="Search by name…"
                  className="flex-1 rounded-none border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
                />
                <button type="button" onClick={loadOrgs} className="rounded-none border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Search</button>
              </div>

              <div className="rounded-none border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/60">
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Workspace</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Owner</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Members / Seats</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Override Seats</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map((o) => (
                      <tr key={o.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-zinc-200">{o.name}</div>
                          <div className="text-xs text-zinc-500 font-mono">{o.slug}</div>
                        </td>
                        <td className="px-4 py-3 text-zinc-400 text-xs">{o.owner.email}</td>
                        <td className="px-4 py-3 text-zinc-300">{o._count.members} / {o.maxSeats}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              aria-label="Override seat count"
                              value={seatInput[o.id] ?? o.maxSeats}
                              onChange={(e) => setSeatInput((s) => ({ ...s, [o.id]: e.target.value }))}
                              className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                            />
                            <button
                              type="button"
                              onClick={() => saveSeats(o.id)}
                              disabled={seatSaving === o.id}
                              className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/30 disabled:opacity-40"
                            >
                              {seatSaving === o.id ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(o.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {orgs.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">No workspaces found.</div>}
              </div>
            </div>
          )}

          {/* ── AUDIT LOG ── */}
          {tab === "audit" && (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-zinc-100">Audit Log <span className="text-zinc-500 text-base font-normal">({logTotal})</span></h1>
              <div className="flex gap-2">
                <input
                  value={logQ}
                  onChange={(e) => { setLogQ(e.target.value); setLogPage(1); }}
                  placeholder="Filter by email or event…"
                  className="flex-1 rounded-none border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
                />
                <select
                  title="Filter by severity"
                  value={logSev}
                  onChange={(e) => { setLogSev(e.target.value); setLogPage(1); }}
                  className="rounded-none border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="">All severities</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                  <option value="critical">Critical</option>
                </select>
                <button type="button" onClick={loadLogs} className="rounded-none border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Filter</button>
              </div>

              <div className="rounded-none border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/60">
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Event</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">User</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">IP</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Severity</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">{l.eventType}</td>
                        <td className="px-4 py-2.5 text-xs text-zinc-400">{l.email ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">{l.ip}</td>
                        <td className={cn("px-4 py-2.5 text-xs font-semibold capitalize", SEV_COLORS[l.severity])}>{l.severity}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("text-xs px-1.5 py-0.5 rounded", l.success ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
                            {l.success ? "ok" : "fail"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-500">{new Date(l.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {logs.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">No audit events found.</div>}
              </div>

              {logTotal > 50 && (
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>Page {logPage} of {Math.ceil(logTotal / 50)}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setLogPage((p) => Math.max(1, p - 1))} disabled={logPage === 1} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Prev</button>
                    <button type="button" onClick={() => setLogPage((p) => p + 1)} disabled={logPage * 50 >= logTotal} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Next</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── AI USAGE ── */}
          {tab === "usage" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-zinc-100">AI Usage Analytics</h1>
                <div className="flex gap-1">
                  {(["24h", "7d", "30d"] as const).map((w) => (
                    <button
                      type="button"
                      key={w}
                      onClick={() => setUsageWindow(w)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-mono rounded border transition-colors",
                        usageWindow === w
                          ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                          : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                      )}
                    >
                      {w}
                    </button>
                  ))}
                  <button type="button" aria-label="Refresh usage data" onClick={() => loadUsage(usageWindow)} className="px-3 py-1.5 text-xs rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 ml-2">
                    <MaterialIcon name="refresh" size={13} />
                  </button>
                </div>
              </div>

              {usageLoading ? (
                <div className="text-zinc-500 text-sm">Loading…</div>
              ) : usageData ? (
                <div className="space-y-6">
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-none border border-zinc-800 bg-zinc-900 p-4">
                      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Total Events</div>
                      <div className="text-2xl font-bold text-amber-400">{usageData.totalEvents.toLocaleString()}</div>
                    </div>
                    <div className="rounded-none border border-zinc-800 bg-zinc-900 p-4">
                      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Total Units</div>
                      <div className="text-2xl font-bold text-amber-400">
                        {usageData.byFeature.reduce((s, f) => s + f.units, 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-none border border-zinc-800 bg-zinc-900 p-4">
                      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Active Features</div>
                      <div className="text-2xl font-bold text-amber-400">{usageData.byFeature.length}</div>
                    </div>
                  </div>

                  {/* Feature breakdown */}
                  <div className="rounded-none border border-zinc-800 bg-zinc-900 p-4 space-y-3">
                    <h2 className="text-sm font-semibold text-zinc-300">Usage by Feature</h2>
                    {usageData.byFeature.length === 0 ? (
                      <p className="text-xs text-zinc-500">No AI usage recorded in this window.</p>
                    ) : usageData.byFeature.map((f) => (
                      <div key={f.feature} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-zinc-300">{f.feature}</span>
                          <span className="text-zinc-500">{f.units.toLocaleString()} units · {f.calls} calls</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-500/70"
                            style={{ width: `${Math.round((f.units / maxUsage) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* By plan */}
                  <div className="rounded-none border border-zinc-800 bg-zinc-900 p-4">
                    <h2 className="text-sm font-semibold text-zinc-300 mb-3">Usage by Plan</h2>
                    <div className="flex gap-4">
                      {usageData.byPlan.map((p) => (
                        <div key={p.plan} className={cn("px-4 py-2 rounded-none text-sm font-mono flex items-center gap-2", TIER_COLORS[p.plan] ?? "bg-zinc-700/20 text-zinc-300")}>
                          <span className="capitalize">{p.plan}</span>
                          <span className="font-bold">{p.units.toLocaleString()}</span>
                          <span className="text-zinc-500 text-xs">units</span>
                        </div>
                      ))}
                      {usageData.byPlan.length === 0 && <p className="text-xs text-zinc-500">No data.</p>}
                    </div>
                  </div>

                  {/* Top users */}
                  <div className="rounded-none border border-zinc-800 bg-zinc-900 p-4">
                    <h2 className="text-sm font-semibold text-zinc-300 mb-3">Top Users by AI Usage</h2>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left py-2 text-xs text-zinc-500">User</th>
                          <th className="text-left py-2 text-xs text-zinc-500">Tier</th>
                          <th className="text-right py-2 text-xs text-zinc-500">Units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageData.topUsers.map((u, i) => (
                          <tr key={u.userId} className="border-b border-zinc-800/30">
                            <td className="py-2">
                              <span className="text-zinc-600 font-mono text-xs mr-2">#{i + 1}</span>
                              <span className="text-zinc-300 text-xs">{u.name ?? u.email}</span>
                              {u.name && <span className="text-zinc-600 text-xs ml-1">({u.email})</span>}
                            </td>
                            <td className="py-2">
                              <span className={cn("text-xs px-1.5 py-0.5 rounded font-mono capitalize", TIER_COLORS[u.tier ?? "free"])}>{u.tier ?? "free"}</span>
                            </td>
                            <td className="py-2 text-right font-mono text-xs text-amber-400">{u.units.toLocaleString()}</td>
                          </tr>
                        ))}
                        {usageData.topUsers.length === 0 && (
                          <tr><td colSpan={3} className="text-center text-zinc-500 py-4 text-xs">No usage data.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-zinc-500 text-sm">Failed to load usage data.</div>
              )}
            </div>
          )}

          {/* ── ANNOUNCEMENT ── */}
          {tab === "announcement" && (
            <div className="space-y-5 max-w-2xl">
              <h1 className="text-xl font-bold text-zinc-100">Global Announcement Banner</h1>
              <p className="text-sm text-zinc-400">This message appears at the top of the app for all logged-in users. Leave blank to clear.</p>

              {stats?.activeAnnouncement && (
                <div className="rounded-none border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                  <span className="font-semibold">Currently active:</span> {stats.activeAnnouncement.message}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1">Message</label>
                  <textarea
                    value={annMsg}
                    onChange={(e) => setAnnMsg(e.target.value)}
                    rows={3}
                    placeholder="e.g. Scheduled maintenance on Saturday 14:00–16:00 UTC."
                    className="w-full rounded-none border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1">Type</label>
                  <select
                    title="Announcement type"
                    value={annType}
                    onChange={(e) => setAnnType(e.target.value)}
                    className="rounded-none border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="info">Info (blue)</option>
                    <option value="warning">Warning (amber)</option>
                    <option value="error">Error (red)</option>
                    <option value="success">Success (green)</option>
                  </select>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={saveAnnouncement}
                    disabled={annSaving || !annMsg.trim()}
                    className="px-4 py-2 rounded-none bg-amber-500 text-amber-950 text-sm font-semibold hover:bg-amber-400 transition-colors disabled:opacity-40"
                  >
                    {annSaving ? "Publishing…" : "Publish Announcement"}
                  </button>
                  <button
                    type="button"
                    onClick={clearAnnouncement}
                    disabled={annSaving}
                    className="px-4 py-2 rounded-none border border-zinc-700 text-zinc-400 text-sm hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
                {annResult && <p className="text-sm text-emerald-400">{annResult}</p>}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
