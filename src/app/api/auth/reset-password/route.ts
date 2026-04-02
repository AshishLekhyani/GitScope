import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

function validatePasswordComplexity(pass: string): string | null {
  if (pass.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pass)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(pass)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(pass)) return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(pass)) return "Password must contain at least one special character.";
  return null;
}

export async function POST(req: NextRequest) {
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

  if (!record || !record.identifier.startsWith("reset:")) {
    return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
  }

  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
    return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 });
  }

  const email = record.identifier.replace("reset:", "");
  const hashed = await bcrypt.hash(password, 12);

  await prisma.user.updateMany({ where: { email }, data: { password: hashed } });
  await prisma.verificationToken.delete({ where: { token } });

  return NextResponse.json({ ok: true });
}
