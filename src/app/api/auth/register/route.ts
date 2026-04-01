import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";

export async function POST(
  request: Request
) {
  // Brute-force protection: 5 registration attempts per IP per 15 minutes
  const { allowed } = checkRateLimit(getRateLimitKey(request, "register"), {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!allowed) {
    return new NextResponse("Too many registration attempts. Try again later.", { status: 429 });
  }

  try {
    const body = await request.json();
    const { email, name, password } = body;

    if (!email || !name || !password) {
      return new NextResponse("Missing information", { status: 400 });
    }

    // Server-side validation
    const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const validatePassword = (pass: string) => {
      const minLength = pass.length >= 8;
      const hasUpper = /[A-Z]/.test(pass);
      const hasLower = /[a-z]/.test(pass);
      const hasNumber = /[0-9]/.test(pass);
      const hasSpecial = /[^A-Za-z0-9]/.test(pass);
      return minLength && hasUpper && hasLower && hasNumber && hasSpecial;
    };

    if (!validateEmail(email)) {
      return new NextResponse("Invalid email format.", { status: 400 });
    }

    if (!validatePassword(password)) {
      return new NextResponse("Password does not meet security requirements.", { status: 400 });
    }

    const userExists = await prisma.user.findUnique({
      where: {
        email
      }
    });

    if (userExists) {
      return new NextResponse("Email already exists", { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword
      }
    });

    return NextResponse.json(user);

  } catch (error) {
    console.error("REGISTRATION_ERROR", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
