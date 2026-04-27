import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings2, User } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { getAuthDisplayEmail, getAuthDisplayName } from "@/features/auth/display";
import { useProfile } from "@/features/profile/useProfile";

export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { user, signOut } = useAuth();
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function goTo(path: string) {
    setOpen(false);
    navigate({ to: path });
  }

  // Fall back to auth-backed identity so the menu stays populated even when
  // the local profile store is still at its default placeholder values.
  const displayName = profile.username !== "User" ? profile.username : getAuthDisplayName(user, "User");
  const displayEmail = profile.email || getAuthDisplayEmail(user);
  const initial = (displayName[0] ?? "U").toUpperCase();

  return (
    <div className="relative" ref={ref}>
      {/* Avatar button — border ring always visible so it stands apart from adjacent controls */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Account menu"
        aria-label="Account menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold text-sm transition-opacity hover:opacity-85 border-2 border-white/30 dark:border-white/20"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-[100] w-56 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl text-sm">
          {/* Identity header — text only, no large avatar to avoid clipping */}
          <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
            <div className="font-semibold truncate">{displayName}</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
              {displayEmail || "No email set"}
            </div>
          </div>

          {/* Nav items */}
          <div className="py-1">
            <MenuItem icon={<User size={14} />} label="Profile" onClick={() => goTo("/profile")} />
            <MenuItem icon={<Settings2 size={14} />} label="Settings" onClick={() => goTo("/settings")} />
          </div>

          {/* Sign out */}
          <div className="border-t border-[hsl(var(--border))] py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (window.confirm("Sign out of Career Jump?")) signOut();
              }}
              className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-rose-500/10 text-rose-500 transition-colors text-left"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] transition-colors text-left"
    >
      <span className="text-[hsl(var(--muted-foreground))]">{icon}</span>
      {label}
    </button>
  );
}
