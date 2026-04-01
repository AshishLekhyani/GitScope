export const BOOKMARKS_KEY = "gitscope_bookmarks";

export type BookmarkedRepo = {
  owner: string;
  repo: string;
  avatar: string;
  stars: number;
  description: string;
  bookmarkedAt: string; // ISO date string
};
