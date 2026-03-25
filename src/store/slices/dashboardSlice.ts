import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface RecentSearch {
  fullName: string;
  owner: string;
  repo: string;
  at: number;
}

export interface WidgetLayoutItem {
  id: string;
  type: "metrics" | "commits" | "languages" | "contributors";
}

export interface DashboardState {
  recentSearches: RecentSearch[];
  compareA: { owner: string; repo: string } | null;
  compareB: { owner: string; repo: string } | null;
  /** Draggable dashboard widget order */
  widgetOrder: WidgetLayoutItem["type"][];
}

const MAX_RECENT = 8;

const initialState: DashboardState = {
  recentSearches: [],
  compareA: null,
  compareB: null,
  widgetOrder: ["metrics", "commits", "languages", "contributors"],
};

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState,
  reducers: {
    addRecentSearch(
      state,
      action: PayloadAction<{ owner: string; repo: string }>
    ) {
      const { owner, repo } = action.payload;
      const fullName = `${owner}/${repo}`;
      const filtered = state.recentSearches.filter(
        (r) => r.fullName !== fullName
      );
      state.recentSearches = [
        { fullName, owner, repo, at: Date.now() },
        ...filtered,
      ].slice(0, MAX_RECENT);
    },
    clearRecentSearches(state) {
      state.recentSearches = [];
    },
    removeRecentSearch(state, action: PayloadAction<string>) {
      state.recentSearches = state.recentSearches.filter(
        (r) => r.fullName !== action.payload
      );
    },
    setCompareA(
      state,
      action: PayloadAction<{ owner: string; repo: string } | null>
    ) {
      state.compareA = action.payload;
    },
    setCompareB(
      state,
      action: PayloadAction<{ owner: string; repo: string } | null>
    ) {
      state.compareB = action.payload;
    },
    setWidgetOrder(state, action: PayloadAction<WidgetLayoutItem["type"][]>) {
      state.widgetOrder = action.payload;
    },
    optimisticReorderWidgets(
      state,
      action: PayloadAction<{ from: number; to: number }>
    ) {
      const { from, to } = action.payload;
      const next = [...state.widgetOrder];
      const [removed] = next.splice(from, 1);
      next.splice(to, 0, removed);
      state.widgetOrder = next;
    },
  },
});

export const {
  addRecentSearch,
  clearRecentSearches,
  removeRecentSearch,
  setCompareA,
  setCompareB,
  setWidgetOrder,
  optimisticReorderWidgets,
} = dashboardSlice.actions;
export default dashboardSlice.reducer;
