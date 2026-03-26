import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface UiState {
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  shortcutsOpen: boolean;
}

const initialState: UiState = {
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  shortcutsOpen: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload;
    },
    setCommandPaletteOpen(state, action: PayloadAction<boolean>) {
      state.commandPaletteOpen = action.payload;
    },
    setShortcutsOpen(state, action: PayloadAction<boolean>) {
      state.shortcutsOpen = action.payload;
    },
  },
});

export const { toggleSidebar, setSidebarCollapsed, setCommandPaletteOpen, setShortcutsOpen } =
  uiSlice.actions;
export default uiSlice.reducer;
// uiSlice v1
