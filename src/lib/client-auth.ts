"use client";

import { signOut } from "next-auth/react";

export async function performLogout() {
  try {
    // Call signOut and wait for it to complete
    await signOut({ redirect: false, callbackUrl: "/" });
    
    // Small delay to ensure cookies are cleared
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Force a full page reload to clear all client state
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  } catch (error) {
    console.error("[Auth] Sign out failed:", error);
    // Fallback: force redirect anyway
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }
}
