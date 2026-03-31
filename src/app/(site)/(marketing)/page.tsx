import { LandingPage } from "@/features/landing/landing-page";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";

export default async function Home() {
  const session = await getServerSession(authOptions);
  
  if (session?.user) {
    redirect(ROUTES.overview);
  }

  return <LandingPage />;
}
