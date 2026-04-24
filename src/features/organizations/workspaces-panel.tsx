"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Users, Plus, Trash2, UserMinus, ChevronDown, ChevronUp,
  Mail, Shield, Eye, Crown, Loader2, Copy, Check, X,
} from "lucide-react";
import { MaterialIcon } from "@/components/material-icon";

// ── Types ──────────────────────────────────────────────────────────────────────

interface OrgMemberUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface OrgMember {
  id: string;
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
  joinedAt: string;
  user: OrgMemberUser;
}

interface OrgInvite {
  id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  expiresAt: string;
  token: string;
}

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  maxSeats: number;
  allowedDomain: string | null;
  createdAt: string;
  owner: OrgMemberUser;
  members: OrgMember[];
  invites: OrgInvite[];
  _count?: { members: number; invites: number };
}

interface WorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  plan: string;
  maxSeats: number;
  allowedDomain: string | null;
  _count: { members: number; invites: number };
  createdAt: string;
  owner: OrgMemberUser;
  members: OrgMember[];
  invites: OrgInvite[];
}

const roleColors: Record<string, string> = {
  owner:  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  admin:  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  member: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  viewer: "bg-muted text-muted-foreground border-border",
};

const RoleIcon = ({ role }: { role: string }) => {
  if (role === "owner")  return <Crown  className="size-3" />;
  if (role === "admin")  return <Shield className="size-3" />;
  if (role === "viewer") return <Eye    className="size-3" />;
  return <Users className="size-3" />;
};

// ── WorkspaceCard ──────────────────────────────────────────────────────────────

function WorkspaceCard({ ws, currentUserId, onRefresh }: {
  ws: WorkspaceListItem;
  currentUserId: string;
  onRefresh: () => void;
}) {
  const [expanded,    setExpanded]    = useState(false);
  const [detail,      setDetail]      = useState<Org | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole,  setInviteRole]  = useState<"admin" | "member" | "viewer">("member");
  const [inviting,    setInviting]    = useState(false);
  const [inviteErr,   setInviteErr]   = useState("");
  const [inviteOk,    setInviteOk]    = useState(false);
  const [copied,      setCopied]      = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainMsg,    setDomainMsg]    = useState<string | null>(null);

  const myRole = ws.members.find((m) => m.userId === currentUserId)?.role ?? "viewer";
  const canManage = myRole === "owner" || myRole === "admin";

  const loadDetail = async () => {
    if (detail) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${ws.id}`);
      if (res.ok) { const d = await res.json(); setDetail(d.org); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const toggle = async () => {
    if (!expanded) {
      await loadDetail();
    }
    setExpanded((v) => !v);
  };

  // Sync domainInput from detail when it loads
  useEffect(() => {
    if (detail?.allowedDomain !== undefined) {
      setDomainInput(detail.allowedDomain ?? "");
    }
  }, [detail?.allowedDomain]);

  const handleSaveDomain = async () => {
    setDomainSaving(true); setDomainMsg(null);
    try {
      const res = await fetch(`/api/orgs/${ws.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: (detail?.name ?? ws.name), allowedDomain: domainInput.trim() || null }),
      });
      const d = await res.json() as { org?: Org; error?: string };
      if (!res.ok) { setDomainMsg(d.error ?? "Failed to save"); return; }
      if (d.org) setDetail(d.org);
      setDomainMsg("SSO domain saved.");
    } catch { setDomainMsg("Network error"); }
    finally { setDomainSaving(false); setTimeout(() => setDomainMsg(null), 3000); }
  };

  const handleInvite = async () => {
    setInviteErr(""); setInviteOk(false); setInviting(true);
    try {
      const res = await fetch(`/api/orgs/${ws.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setInviteErr(data.error ?? "Failed to send invite."); return; }
      setInviteOk(true);
      setInviteEmail("");
      const updRes = await fetch(`/api/orgs/${ws.id}`);
      if (updRes.ok) { const d = await updRes.json(); setDetail(d.org); }
    } catch { setInviteErr("Network error."); }
    finally { setInviting(false); }
  };

  const handleCancelInvite = async (inviteId: string) => {
    const res = await fetch(`/api/orgs/${ws.id}/invite?inviteId=${inviteId}`, { method: "DELETE" });
    if (res.ok) {
      const updRes = await fetch(`/api/orgs/${ws.id}`);
      if (updRes.ok) { const d = await updRes.json(); setDetail(d.org); }
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    const res = await fetch(`/api/orgs/${ws.id}/members/${memberId}`, { method: "DELETE" });
    if (res.ok) {
      const updRes = await fetch(`/api/orgs/${ws.id}`);
      if (updRes.ok) { const d = await updRes.json(); setDetail(d.org); onRefresh(); }
    }
  };

  const handleChangeRole = async (memberId: string, role: "admin" | "member" | "viewer") => {
    const res = await fetch(`/api/orgs/${ws.id}/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      const updRes = await fetch(`/api/orgs/${ws.id}`);
      if (updRes.ok) { const d = await updRes.json(); setDetail(d.org); }
    }
  };

  const copyInviteLink = async (token: string) => {
    const url = `${window.location.origin}/invite/accept?token=${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const members = detail?.members ?? ws.members;
  const invites = detail?.invites ?? [];
  const seatUsed = members.length;

  return (
    <div className="rounded-none border border-border bg-card overflow-hidden">
      {/* Card header */}
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="size-10 rounded-none bg-linear-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white font-black text-sm shrink-0">
          {ws.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm truncate">{ws.name}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider", roleColors[myRole])}>
              <RoleIcon role={myRole} /> {myRole}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{seatUsed}/{ws.maxSeats} seats · {ws.plan} plan</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex -space-x-2">
            {members.slice(0, 4).map((m) => (
              <div key={m.id} className="size-7 rounded-full border-2 border-card bg-muted overflow-hidden flex items-center justify-center text-[9px] font-bold">
                {m.user.image
                  ? <img src={m.user.image} alt={m.user.name ?? ""} className="size-full object-cover" />
                  : (m.user.name ?? "?").slice(0, 2).toUpperCase()}
              </div>
            ))}
            {members.length > 4 && (
              <div className="size-7 rounded-full border-2 border-card bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground">
                +{members.length - 4}
              </div>
            )}
          </div>
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-5 space-y-5">
              {loading && (
                <div className="flex items-center justify-center py-6 text-muted-foreground gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Loading...
                </div>
              )}

              {/* Members list */}
              {!loading && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Members ({members.length})</h4>
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-none bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="size-8 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[10px] font-bold shrink-0">
                        {m.user.image
                          ? <img src={m.user.image} alt={m.user.name ?? ""} className="size-full object-cover" />
                          : (m.user.name ?? "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{m.user.name ?? m.user.email ?? "Unknown"}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{m.user.email}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {canManage && m.role !== "owner" && m.userId !== currentUserId ? (
                          <select
                            value={m.role}
                            onChange={(e) => handleChangeRole(m.id, e.target.value as "admin" | "member" | "viewer")}
                            title="Change member role"
                            className={cn("text-[9px] font-black uppercase tracking-wider rounded-full border px-2 py-0.5 bg-transparent cursor-pointer", roleColors[m.role])}
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider", roleColors[m.role])}>
                            <RoleIcon role={m.role} /> {m.role}
                          </span>
                        )}
                        {(canManage && m.role !== "owner") || m.userId === currentUserId ? (
                          <button
                            type="button"
                            title={m.userId === currentUserId ? "Leave workspace" : "Remove member"}
                            onClick={() => handleRemoveMember(m.id)}
                            className="p-1 rounded-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            {m.userId === currentUserId ? <X className="size-3.5" /> : <UserMinus className="size-3.5" />}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending invites */}
              {!loading && invites.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pending Invites ({invites.length})</h4>
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 p-2.5 rounded-none border border-dashed border-border bg-muted/10">
                      <Mail className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{inv.email}</p>
                        <p className="text-[10px] text-muted-foreground">Role: {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                      </div>
                      <button
                        type="button"
                        title="Copy invite link"
                        onClick={() => copyInviteLink(inv.token)}
                        className="p-1 rounded-none text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {copied === inv.token ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          title="Cancel invite"
                          onClick={() => handleCancelInvite(inv.id)}
                          className="p-1 rounded-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Invite form */}
              {canManage && seatUsed < ws.maxSeats && (
                <div className="space-y-2 pt-1">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Invite Member</h4>
                  <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                    <input
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={(e) => { setInviteEmail(e.target.value); setInviteErr(""); setInviteOk(false); }}
                      className="flex-1 rounded-none border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "admin" | "member" | "viewer")}
                      title="Invite role"
                      className="rounded-none border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleInvite}
                      disabled={inviting || !inviteEmail}
                      className="inline-flex items-center gap-1.5 rounded-none bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-colors"
                    >
                      {inviting ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                      Invite
                    </button>
                  </div>
                  {inviteErr && <p className="text-[11px] text-destructive">{inviteErr}</p>}
                  {inviteOk  && <p className="text-[11px] text-emerald-500">Invite sent! Share the link with your teammate.</p>}
                </div>
              )}

              {canManage && seatUsed >= ws.maxSeats && (
                <p className="text-[11px] text-amber-500">Seat limit reached ({ws.maxSeats}). Upgrade your plan to add more members.</p>
              )}

              {/* SSO Domain Auto-Join */}
              {canManage && (
                <div className="space-y-2 pt-1 border-t border-border">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <MaterialIcon name="domain" size={11} /> SSO Domain Auto-Join
                  </h4>
                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                    Users who sign in with this email domain are automatically added as members.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="company.com"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value.toLowerCase().replace(/^@/, ""))}
                      title="Allowed email domain"
                      className="flex-1 rounded-none border border-border bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveDomain}
                      disabled={domainSaving}
                      className="px-3 py-2 rounded-none bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-[11px] font-black uppercase tracking-wider text-white transition-colors"
                    >
                      {domainSaving ? "…" : "Save"}
                    </button>
                  </div>
                  {domainMsg && <p className="text-[10px] text-emerald-500">{domainMsg}</p>}
                  {(detail?.allowedDomain ?? null) && (
                    <p className="text-[10px] text-amber-400 flex items-center gap-1">
                      <MaterialIcon name="check_circle" size={11} />
                      Active: <span className="font-mono">@{detail?.allowedDomain}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── WorkspacesPanel ────────────────────────────────────────────────────────────

export function WorkspacesPanel({ currentUserId, plan }: { currentUserId: string; plan: string }) {
  const [owned,   setOwned]   = useState<WorkspaceListItem[]>([]);
  const [joined,  setJoined]  = useState<{ role: string; org: WorkspaceListItem }[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating,setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [createErr, setCreateErr] = useState("");

  const canCreate = plan === "team" || plan === "enterprise";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orgs");
      if (res.ok) {
        const data = await res.json() as { owned: WorkspaceListItem[]; joined: { role: string; org: WorkspaceListItem }[] };
        setOwned(data.owned ?? []);
        setJoined(data.joined ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    setCreateErr(""); setCreating(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setCreateErr(data.error ?? "Failed to create workspace."); return; }
      setNewName(""); setShowCreate(false);
      await load();
    } catch { setCreateErr("Network error."); }
    finally { setCreating(false); }
  };

  const allWorkspaces = [
    ...owned,
    ...joined.map((j) => j.org),
  ];

  if (loading) {
    return (
      <div className="rounded-none border border-border bg-card p-8 flex items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading workspaces...
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Section header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-none bg-linear-to-br from-amber-500 to-amber-600 flex items-center justify-center">
            <Users className="size-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-black tracking-tight">My Workspaces</h2>
            <p className="text-[11px] text-muted-foreground">Invite teammates, manage roles, share scan results</p>
          </div>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => { setShowCreate((v) => !v); setCreateErr(""); }}
            className="inline-flex items-center gap-1.5 rounded-none bg-amber-500 hover:bg-amber-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-colors"
          >
            <Plus className="size-3.5" /> New Workspace
          </button>
        ) : (
          <div className="inline-flex items-center gap-1.5 rounded-none border border-amber-500/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-500/70">
            <MaterialIcon name="lock" size={12} /> Team plan required
          </div>
        )}
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-none border border-amber-500/20 bg-amber-500/5 p-4 flex gap-2 flex-wrap sm:flex-nowrap items-start">
              <input
                type="text"
                placeholder="Workspace name (e.g. Acme Engineering)"
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setCreateErr(""); }}
                onKeyDown={(e) => e.key === "Enter" && newName.trim() && handleCreate()}
                className="flex-1 rounded-none border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="inline-flex items-center gap-1.5 rounded-none bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white transition-colors"
              >
                {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Create
              </button>
              {createErr && <p className="w-full text-[11px] text-destructive mt-1">{createErr}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workspace list */}
      {allWorkspaces.length === 0 ? (
        <div className="rounded-none border border-dashed border-border bg-muted/20 p-8 text-center space-y-2">
          <div className="size-12 rounded-none bg-muted/50 flex items-center justify-center mx-auto">
            <Users className="size-6 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">No workspaces yet</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
            {canCreate
              ? 'Create a workspace to invite teammates and share GitScope analytics across your team.'
              : 'Upgrade to the Team plan to create shared workspaces and manage seat invitations.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {allWorkspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              ws={ws}
              currentUserId={currentUserId}
              onRefresh={load}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
