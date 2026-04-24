/**
 * GitScope Email Service — powered by Nodemailer + Gmail SMTP
 *
 * Required env vars:
 *   SMTP_USER    — your Gmail address, e.g. you@gmail.com
 *   SMTP_PASS    — Gmail App Password (16-char, NOT your real password)
 *   EMAIL_FROM   — display name + address, e.g. "GitScope <you@gmail.com>"
 *
 * Gmail App Password setup:
 *   1. Google Account → Security → enable 2-Step Verification
 *   2. Security → App passwords → App: Mail → Generate
 *   3. Copy the 16-char password → paste into SMTP_PASS (spaces optional)
 *
 * Works on any domain (including *.vercel.app) — no domain purchase needed.
 * Free tier: ~500 emails/day via Gmail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALTERNATIVE: Resend (requires a verified custom domain for sending to anyone)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. npm uninstall nodemailer @types/nodemailer && npm install resend
 *
 * 2. Env vars:
 *      RESEND_API_KEY=re_xxxxxxxxxxxx
 *      EMAIL_FROM="GitScope <noreply@yourdomain.com>"  ← must be verified domain
 *
 * 3. Replace sendEmail below with:
 *
 *    import { Resend } from "resend";
 *    const resend = new Resend(process.env.RESEND_API_KEY);
 *
 *    export async function sendEmail({ to, subject, html }: SendEmailOptions) {
 *      if (!process.env.RESEND_API_KEY) { console.warn("[email] skipped"); return; }
 *      const { error } = await resend.emails.send({
 *        from: process.env.EMAIL_FROM ?? "noreply@yourdomain.com", to, subject, html,
 *      });
 *      if (error) throw new Error(`Resend error: ${error.message}`);
 *    }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.EMAIL_FROM ?? process.env.SMTP_USER ?? "GitScope";

if (process.env.NODE_ENV === "production" && !process.env.NEXTAUTH_URL) {
  console.error("[email] NEXTAUTH_URL is not set — all email links will point to localhost");
}
const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_USER / SMTP_PASS are not configured — cannot send email");
    }
    console.warn("[email] SMTP_USER / SMTP_PASS not set — email skipped (dev mode)");
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, html });
}

// ── Templates ─────────────────────────────────────────────────────────────────

function baseTemplate(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#110f0c;font-family:'Segoe UI',system-ui,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#110f0c;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#1a1612;border-radius:4px;border:1px solid rgba(245,158,11,0.2);overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#d97706,#b45309);padding:32px 40px;">
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">GitScope</h1>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);font-family:monospace;letter-spacing:2px;text-transform:uppercase;">${title}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);font-family:monospace;">
            This email was sent by GitScope. If you didn't request this, you can safely ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildVerificationEmail(name: string, token: string) {
  const url = `${APP_URL}/api/auth/verify-email?token=${token}`;
  return {
    subject: "Verify your GitScope email address",
    html: baseTemplate(
      "Email Verification",
      `<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#f1f5f9;">Hey ${name || "there"},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.6;">
         Click the button below to verify your email address and activate your GitScope account.
         This link expires in <strong style="color:#e2e8f0;">30 minutes</strong>.
       </p>
       <a href="${url}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.5px;">
         Verify Email Address
       </a>
       <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.3);font-family:monospace;word-break:break-all;">
         Or copy this link: ${url}
       </p>`
    ),
  };
}

export function buildPasswordResetEmail(name: string, token: string) {
  const url = `${APP_URL}/reset-password?token=${token}`;
  return {
    subject: "Reset your GitScope password",
    html: baseTemplate(
      "Password Reset",
      `<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#f1f5f9;">Hey ${name || "there"},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.6;">
         We received a request to reset your password. Click the button below to choose a new one.
         This link expires in <strong style="color:#e2e8f0;">1 hour</strong>. If you didn't request this, ignore this email.
       </p>
       <a href="${url}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.5px;">
         Reset Password
       </a>
       <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.3);font-family:monospace;word-break:break-all;">
         Or copy this link: ${url}
       </p>`
    ),
  };
}

export function buildScanAlertEmail(opts: {
  repo: string;
  prevScore: number;
  newScore: number;
  drop: number;
  criticalCount: number;
  highCount: number;
  summary: string;
  scanMode: string;
}) {
  const { repo, prevScore, newScore, drop, criticalCount, highCount, summary, scanMode } = opts;
  const scoreColor = newScore >= 70 ? "#10b981" : newScore >= 50 ? "#f59e0b" : "#ef4444";
  const url = `${APP_URL}/intelligence`;
  return {
    subject: `⚠️ Health score dropped ${drop} pts for ${repo}`,
    html: baseTemplate(
      "Repo Health Alert",
      `<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#f1f5f9;">Health score alert for <span style="color:#fbbf24;">${repo}</span></p>
       <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.6;">
         Your ${scanMode} scan detected a significant drop in the repository health score.
       </p>
       <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
         <tr>
           <td style="text-align:center;padding:16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px 0 0 12px;">
             <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Previous</p>
             <p style="margin:4px 0 0;font-size:32px;font-weight:900;color:#cbd5e1;">${prevScore}</p>
           </td>
           <td style="text-align:center;padding:16px;background:rgba(239,68,68,0.15);border-top:1px solid rgba(239,68,68,0.2);border-bottom:1px solid rgba(239,68,68,0.2);">
             <p style="margin:0;font-size:22px;font-weight:900;color:#ef4444;">−${drop}</p>
           </td>
           <td style="text-align:center;padding:16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:0 12px 12px 0;">
             <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Now</p>
             <p style="margin:4px 0 0;font-size:32px;font-weight:900;color:${scoreColor};">${newScore}</p>
           </td>
         </tr>
       </table>
       ${(criticalCount > 0 || highCount > 0) ? `
       <div style="display:flex;gap:12px;margin-bottom:20px;">
         ${criticalCount > 0 ? `<div style="flex:1;padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:10px;text-align:center;">
           <p style="margin:0;font-size:20px;font-weight:900;color:#ef4444;">${criticalCount}</p>
           <p style="margin:2px 0 0;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Critical</p>
         </div>` : ""}
         ${highCount > 0 ? `<div style="flex:1;padding:12px;background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.25);border-radius:10px;text-align:center;">
           <p style="margin:0;font-size:20px;font-weight:900;color:#f97316;">${highCount}</p>
           <p style="margin:2px 0 0;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">High</p>
         </div>` : ""}
       </div>` : ""}
       <div style="padding:16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:24px;">
         <p style="margin:0;font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Summary</p>
         <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">${summary}</p>
       </div>
       <a href="${url}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.5px;">
         View Full Report
       </a>`
    ),
  };
}

export function buildWeeklyDigestEmail(opts: {
  name: string;
  repoCount: number;
  avgScore: number;
  weeklyDelta: number;
  atRiskRepos: { name: string; score: number }[];
  topRepos: { name: string; score: number }[];
  totalScans: number;
}) {
  const { name, repoCount, avgScore, weeklyDelta, atRiskRepos, topRepos, totalScans } = opts;
  const scoreColor = avgScore >= 80 ? "#10b981" : avgScore >= 65 ? "#14b8a6" : avgScore >= 50 ? "#f59e0b" : "#ef4444";
  const deltaStr = weeklyDelta >= 0 ? `+${weeklyDelta}` : String(weeklyDelta);
  const deltaColor = weeklyDelta >= 0 ? "#10b981" : "#ef4444";
  const weekStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const repoRow = (r: { name: string; score: number }, i: number) => {
    const c = r.score >= 80 ? "#10b981" : r.score >= 65 ? "#14b8a6" : r.score >= 50 ? "#f59e0b" : "#ef4444";
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <td style="padding:8px 4px;font-size:13px;color:#94a3b8;font-family:monospace;">${i + 1}.</td>
      <td style="padding:8px 4px;font-size:13px;color:#e2e8f0;">${r.name}</td>
      <td style="padding:8px 4px;text-align:right;font-size:14px;font-weight:900;color:${c};">${r.score}</td>
    </tr>`;
  };

  return {
    subject: `GitScope Weekly Digest — ${weekStr}`,
    html: baseTemplate(
      "Weekly Digest",
      `<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#f1f5f9;">Hey ${name || "there"},</p>
       <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;line-height:1.6;">
         Here's your weekly fleet health summary for the week ending <strong style="color:#e2e8f0;">${weekStr}</strong>.
       </p>

       <!-- Summary stats -->
       <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
         <tr>
           <td style="text-align:center;padding:20px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:4px 0 0 4px;">
             <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Repos Tracked</p>
             <p style="margin:6px 0 0;font-size:28px;font-weight:900;color:#e2e8f0;">${repoCount}</p>
           </td>
           <td style="text-align:center;padding:20px 12px;background:rgba(245,158,11,0.08);border-top:1px solid rgba(245,158,11,0.2);border-bottom:1px solid rgba(245,158,11,0.2);">
             <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Avg Health</p>
             <p style="margin:6px 0 0;font-size:28px;font-weight:900;color:${scoreColor};">${avgScore}</p>
             <p style="margin:2px 0 0;font-size:12px;font-weight:700;color:${deltaColor};">${deltaStr} vs last week</p>
           </td>
           <td style="text-align:center;padding:20px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:0 4px 4px 0;">
             <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Scans Run</p>
             <p style="margin:6px 0 0;font-size:28px;font-weight:900;color:#e2e8f0;">${totalScans}</p>
           </td>
         </tr>
       </table>

       ${topRepos.length > 0 ? `
       <!-- Top repos -->
       <div style="margin-bottom:24px;">
         <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:1px;">Top Performers</p>
         <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);border-radius:10px;overflow:hidden;">
           ${topRepos.map(repoRow).join("")}
         </table>
       </div>` : ""}

       ${atRiskRepos.length > 0 ? `
       <!-- At-risk repos -->
       <div style="margin-bottom:28px;">
         <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:1px;">Needs Attention</p>
         <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:10px;overflow:hidden;">
           ${atRiskRepos.map(repoRow).join("")}
         </table>
       </div>` : ""}

       <a href="${APP_URL}/intelligence" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.5px;">
         Open GitScope Dashboard
       </a>
       <p style="margin:20px 0 0;font-size:11px;color:rgba(255,255,255,0.3);">
         You're receiving this because weekly digests are enabled.
         <a href="${APP_URL}/settings?tab=workspace" style="color:#d97706;">Manage preferences</a>
       </p>`
    ),
  };
}

export function buildSetPasswordEmail(name: string, token: string) {
  const url = `${APP_URL}/reset-password?token=${token}&mode=set`;
  return {
    subject: "Set your GitScope password",
    html: baseTemplate(
      "Set Password",
      `<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#f1f5f9;">Hey ${name || "there"},</p>
       <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.6;">
         You're signing in with Google/GitHub but haven't set a password yet. Click below to create one so you can also log in with your email and password.
         This link expires in <strong style="color:#e2e8f0;">1 hour</strong>.
       </p>
       <a href="${url}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.5px;">
         Set Password
       </a>
       <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.3);font-family:monospace;word-break:break-all;">
         Or copy this link: ${url}
       </p>`
    ),
  };
}
