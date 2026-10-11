"use client";

import { useId, useState, type FormEvent } from "react";
import { Search } from "lucide-react";

/** Solid field on a solid card, never sitting directly over artwork. */
export function SearchInput({
  label = "Search",
  placeholder = "Search books or authors",
  initialValue = "",
  onSubmit,
  onChange,
}: {
  label?: string;
  placeholder?: string;
  initialValue?: string;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initialValue);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit?.(value.trim());
  }

  return (
    <form className="search" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e.target.value);
        }}
      />
      <button className="iconbtn" type="submit" aria-label="Search">
        <Search size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
