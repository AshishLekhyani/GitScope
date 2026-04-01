import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID as string,
      clientSecret: process.env.GITHUB_SECRET as string,
      allowDangerousEmailAccountLinking: true,
    }),
    ...(process.env.GOOGLE_ID && process.env.GOOGLE_SECRET
      ? [GoogleProvider({
          clientId: process.env.GOOGLE_ID,
          clientSecret: process.env.GOOGLE_SECRET,
          allowDangerousEmailAccountLinking: true,
        })]
      : []),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        // Brute-force protection: 10 attempts per email per 15 minutes
        const key = `login:${credentials.email.toLowerCase()}`;
        const { allowed } = checkRateLimit(key, { limit: 10, windowMs: 15 * 60 * 1000 });
        if (!allowed) {
          throw new Error("Too many login attempts. Please wait 15 minutes.");
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email,
          },
        });

        if (!user || !user.password) {
          throw new Error("Invalid credentials");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          throw new Error("Invalid credentials");
        }

        const userWithoutPassword = { ...user, password: undefined };
        return userWithoutPassword;
      },
    }),
  ],
  callbacks: {
    async session({ token, session }) {
      if (token && session.user) {
        // Robust mapping to prevent identity loss across tab switches
        session.user.id = token.id;
        session.user.name = token.name || (token.email as string)?.split('@')[0];
        session.user.email = token.email;
        session.user.image = token.picture;
        session.accessToken = token.accessToken;
        session.provider = token.provider;

        // [STRICT SECURITY] Instant User Sync
        // Verify user still exists in the database on every session check.
        // This ensures that deleted users are kicked out immediately.
        try {
          const userExists = await prisma.user.findUnique({
            where: { id: token.id },
            select: { id: true }
          });
          
          if (!userExists) {
            console.warn(`▲ [Security] Active session for deleted user ${token.id} invalidated.`);
            return null as any; // Trigger session invalidation
          }
        } catch (error) {
          console.error("▲ [Security] Failed to verify user existence during session:", error);
        }
      }
      return session;
    },
    async jwt({ token, user, account, trigger, session }) {
      // initial load
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
      }
      
      // Capture access token and provider on initial sign-in
      if (account) {
        token.accessToken = account.access_token;
        token.provider = account.provider;
      }

      // handle manual updates if needed later
      if (trigger === "update" && session) {
        token = { ...token, ...session };
      }
      return token;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
// NextAuth config - github provider wired up
// fix: callbackUrl normalisation
