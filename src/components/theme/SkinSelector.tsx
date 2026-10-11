"use client";

import { Check } from "lucide-react";
import { useSkin } from "./SkinProvider";

/** Picks a skin instantly. Changes how things look; never what they do. */
export function SkinSelector() {
  const { skin, skins, setSkinId } = useSkin();
  return (
    <div className="skins" role="radiogroup" aria-label="Appearance">
      {skins.map((s) => {
        const c = s.tokens.color;
        const on = s.id === skin.id;
        return (
          <label key={s.id} className={`skin${on ? " is-on" : ""}`}>
            <input
              className="sr-only"
              type="radio"
              name="skin"
              value={s.id}
              checked={on}
              onChange={() => setSkinId(s.id)}
            />
            <span className="skin__swatches" aria-hidden="true">
              {(["canvas", "surface", "primary", "text"] as const).map((role) => (
                <span key={role} style={{ background: c[role] }} />
              ))}
            </span>
            <span className="skin__text">
              <span className="skin__name">{s.name}</span>
              <span className="muted">{s.description}</span>
            </span>
            {on ? <Check size={20} aria-label="Selected" /> : null}
          </label>
        );
      })}
    </div>
  );
}
