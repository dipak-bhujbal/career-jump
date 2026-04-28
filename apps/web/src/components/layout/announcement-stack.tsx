import { useMemo, useState } from "react";
import { AlertTriangle, BellRing, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnnouncementRecord } from "@/lib/api";

type SeverityTheme = {
  container: string;
  badge: string;
  icon: typeof Info;
  label: string;
};

const severityThemes: Record<AnnouncementRecord["severity"], SeverityTheme> = {
  info: {
    container: "border-sky-500/35 bg-sky-500/12 text-sky-950 dark:text-sky-100",
    badge: "bg-sky-500/18 text-sky-800 dark:text-sky-200",
    icon: Info,
    label: "Info",
  },
  warning: {
    container: "border-amber-500/40 bg-amber-500/12 text-amber-950 dark:text-amber-100",
    badge: "bg-amber-500/20 text-amber-800 dark:text-amber-200",
    icon: AlertTriangle,
    label: "Warning",
  },
  critical: {
    container: "border-rose-500/40 bg-rose-500/12 text-rose-950 dark:text-rose-100",
    badge: "bg-rose-500/20 text-rose-800 dark:text-rose-200",
    icon: BellRing,
    label: "Critical",
  },
};

function dismissedAnnouncementKey(id: string): string {
  return `cj.dismissed-announcement.${id}`;
}

export function AnnouncementStack({
  announcements,
}: {
  announcements: AnnouncementRecord[];
}) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const visibleAnnouncements = useMemo(() => {
    return announcements.filter((announcement) => {
      if (!announcement.dismissible) return true;
      if (dismissedIds.includes(announcement.id)) return false;
      try {
        return window.localStorage.getItem(dismissedAnnouncementKey(announcement.id)) !== "1";
      } catch {
        return !dismissedIds.includes(announcement.id);
      }
    });
  }, [announcements, dismissedIds]);

  function dismissAnnouncement(id: string) {
    setDismissedIds((current) => [...current, id]);
    try {
      window.localStorage.setItem(dismissedAnnouncementKey(id), "1");
    } catch {
      // Local dismissal is a UX enhancement only, so ignore storage failures.
    }
  }

  if (!visibleAnnouncements.length) return null;

  return (
    <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/85 backdrop-blur">
      <div className="space-y-2 px-4 py-3 md:px-6">
        {visibleAnnouncements.map((announcement) => {
          const theme = severityThemes[announcement.severity];
          const Icon = theme.icon;

          return (
            <div
              key={announcement.id}
              className={`rounded-2xl border px-4 py-3 shadow-sm ${theme.container}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`mt-0.5 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${theme.badge}`}>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon size={12} />
                      {theme.label}
                    </span>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-semibold">{announcement.title}</div>
                    <div className="text-sm leading-6 opacity-90">{announcement.body}</div>
                  </div>
                </div>
                {announcement.dismissible ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => dismissAnnouncement(announcement.id)}
                  >
                    <X size={14} />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

