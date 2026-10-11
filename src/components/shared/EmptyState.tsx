import type { ReactNode } from "react";
import { ThemeArtwork } from "@/components/theme/ThemeArtwork";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <ThemeArtwork slot="emptyState" className="empty__art" />
      <h2>{title}</h2>
      {body ? <p className="muted">{body}</p> : null}
      {action}
    </div>
  );
}
