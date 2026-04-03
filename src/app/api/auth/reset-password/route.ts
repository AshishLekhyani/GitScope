import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import bcrypt from "bcryptjs";

function validatePasswordComplexity(pass: string): string | null {
  if (pass.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pass)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(pass)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(pass)) return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(pass)) return "Password must contain at least one special character.";
  return null;
}

async function postHandler(req: NextRequest) {
  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { token, password } = body;

  if (!token || !password) {
    return NextResponse.json({ error: "Missing token or password." }, { status: 400 });
  }

  const complexityError = validatePasswordComplexity(password);
  if (complexityError) {
    return NextResponse.json({ error: complexityError }, { status: 400 });
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } });

  // Accept both "reset:" and "set:" token identifiers
  if (!record || (!record.identifier.startsWith("reset:") && !record.identifier.startsWith("set:"))) {
    return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
  }

  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
    return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 });
  }

  // Extract email from either "reset:email" or "set:email"
  const email = record.identifier.replace(/^(reset|set):/, "");
  const hashed = await bcrypt.hash(password, 12);

  // Update password and mark email as verified (for OAuth users setting password for first time)
  await prisma.user.updateMany({ 
    where: { email }, 
    data: { 
      password: hashed,
      emailVerified: new Date(), // Mark as verified since OAuth already verified it
    } 
  });
  
  // Delete both reset and set tokens for this email to clean up
  await prisma.verificationToken.deleteMany({ 
    where: { 
      identifier: { in: [`reset:${email}`, `set:${email}`] } 
    } 
  });

  return NextResponse.json({ ok: true });
}

// Apply security middleware for password reset (sensitive operation)
export const POST = withRouteSecurity(postHandler, SecurityPresets.sensitive);
