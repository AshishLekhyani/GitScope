"use client";

import { signOut } from "next-auth/react";

export async function performLogout() {
  const from =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/";

  // Avoid soft client navigation cache artifacts by forcing a hard redirect after sign out.
  await signOut({ redirect: false });
  if (typeof window !== "undefined") {
    window.location.replace("/");
  }
}
