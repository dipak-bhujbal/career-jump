import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Briefcase, CheckSquare, Target, Settings, Sparkles, ScrollText, User, LogOut, Shield, LifeBuoy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarActions } from "./sidebar-actions";
import { useAuth } from "@/features/auth/AuthContext";
import { getAuthDisplayName } from "@/features/auth/display";
import { useProfile } from "@/features/profile/useProfile";
import { useMe } from "@/features/session/queries";

const userItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Available Jobs", icon: Briefcase },
  { to: "/applied", label: "Applied Jobs", icon: CheckSquare },
  { to: "/plan", label: "Action Plan", icon: Target },
  { to: "/support", label: "Support", icon: LifeBuoy },
  { to: "/configuration", label: "Configuration", icon: Settings },
];

const adminItems = [
  { to: "/admin", label: "Admin", icon: Shield },
  { to: "/admin-users", label: "Users", icon: Users },
  { to: "/admin-support", label: "Support Queue", icon: LifeBuoy },
  { to: "/logs", label: "Logs", icon: ScrollText },
];

export function Sidebar() {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { data: me } = useMe();
  const items = me?.actor?.isAdmin ? [...userItems, ...adminItems] : userItems;

  // Prefer the user-saved profile username; fall back to auth identity.
  const displayName = profile.username !== "User" ? profile.username : getAuthDisplayName(user);
  const initial = (displayName[0] ?? "U").toUpperCase();

  return (
    <aside className="w-60 shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 backdrop-blur flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[hsl(var(--border))]">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white shadow-sm shrink-0">
          <Sparkles size={18} />
        </div>
        <div>
          <div className="font-semibold text-sm">Career Jump</div>
          <div className="text-[12.5px] text-[hsl(var(--muted-foreground))]">Private job radar</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="p-2 flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {items.map((it) => {
          const active = pathname === it.to || (it.to !== "/" && pathname.startsWith(it.to));
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] font-medium"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/60 hover:text-[hsl(var(--foreground))]",
              )}
            >
              <Icon size={16} />
              {it.label}
            </Link>
          );
        })}
      </nav>

      <SidebarActions />

      {/* User footer */}
      <div className="p-3 border-t border-[hsl(var(--border))]">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 group">
          <Link
            to="/profile"
            className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition-opacity"
          >
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white text-xs font-bold shrink-0">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{displayName}</div>
              <div className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">{user?.email || ""}</div>
            </div>
            <User size={13} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
          </Link>
          <button
            type="button"
            onClick={() => { if (window.confirm("Sign out?")) signOut(); }}
            title="Sign out"
            className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-rose-500 transition-colors p-1"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
