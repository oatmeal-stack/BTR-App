"use client";

import { Star } from "lucide-react";

/** Five tappable stars. Tapping the star you already chose clears it. */
export function StarRating({
  value,
  onChange,
  label = "Your rating",
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="stars">
      <span className="muted" style={{ fontSize: 14, marginRight: 6 }}>
        {label}
      </span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star${(value ?? 0) >= n ? " is-on" : ""}`}
          aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
          aria-pressed={value === n}
          onClick={() => onChange(value === n ? undefined : n)}
        >
          <Star size={26} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
