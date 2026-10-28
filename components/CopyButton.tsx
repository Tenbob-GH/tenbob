"use client";

import { useState } from "react";

export function CopyButton({
  value,
  label,
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`font-mono text-xs text-mist hover:text-lime ${className}`}
    >
      {copied ? "Copied" : label ?? value}
    </button>
  );
}
