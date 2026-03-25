import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface UserState {
  displayName: string;
  gitHandle: string;
  bio: string;
  avatarUrl: string | null;
  isAuthenticated: boolean;
}

const initialState: UserState = {
  displayName: "",
  gitHandle: "",
  bio: "",
  avatarUrl: null,
  isAuthenticated: false,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    updateProfile: (
      state,
      action: PayloadAction<Partial<UserState>>
    ) => {
      Object.assign(state, action.payload);
    },
    setAvatarUrl: (state, action: PayloadAction<string | null>) => {
      state.avatarUrl = action.payload;
    },
    login: (state) => {
      state.isAuthenticated = true;
    },
    logout: (state) => {
      state.isAuthenticated = false;
    },
  },
});

export const { updateProfile, setAvatarUrl, login, logout } = userSlice.actions;
export default userSlice.reducer;
