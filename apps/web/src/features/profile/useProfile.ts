import { useState, useCallback } from "react";

export interface UserProfile {
  username: string;
  email: string;
}

const STORAGE_KEY = "career-jump:profile";

function load(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UserProfile;
  } catch {
    // ignore
  }
  return { username: "User", email: "" };
}

function save(profile: UserProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function useProfile() {
  const [profile, setProfileState] = useState<UserProfile>(load);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setProfileState((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  return { profile, updateProfile };
}
