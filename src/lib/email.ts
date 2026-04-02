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
const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[email] SMTP_USER / SMTP_PASS not set — email skipped");
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
<body style="margin:0;padding:0;background:#0b1326;font-family:'Segoe UI',system-ui,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1326;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#111827;border-radius:16px;border:1px solid rgba(99,102,241,0.2);overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#4361ee,#7c3aed);padding:32px 40px;">
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
       <a href="${url}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#4361ee,#7c3aed);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.5px;">
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
