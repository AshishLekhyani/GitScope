/**
 * Bookmark helpers — API-backed (database), not localStorage.
 * All user data is server-side so it persists across devices and browsers.
 */

export type BookmarkedRepo = {
  owner: string;
  repo: string;
  avatar: string;
  stars: number;
  description: string;
  bookmarkedAt: string; // ISO date string
};

/** Fetch all bookmarks for the current user from the API. */
export async function fetchBookmarks(): Promise<BookmarkedRepo[]> {
  try {
    const res = await fetch("/api/user/bookmarks", { credentials: "include" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.bookmarks) ? data.bookmarks : [];
  } catch {
    return [];
  }
}

/** Add or update a bookmark. Returns true on success. */
export async function addBookmark(
  bookmark: Omit<BookmarkedRepo, "bookmarkedAt">
): Promise<boolean> {
  try {
    const res = await fetch("/api/user/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(bookmark),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Remove a bookmark. Returns true on success. */
export async function removeBookmark(owner: string, repo: string): Promise<boolean> {
  try {
    const res = await fetch("/api/user/bookmarks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ owner, repo }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
