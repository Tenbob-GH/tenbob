"use client";

import Image from "next/image";
import { useState } from "react";
import { ipfsToHttp } from "@/lib/metadata";

export function NftImage({
  src,
  alt,
  className = "",
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = src ? ipfsToHttp(src) : "";

  if (!resolved || failed) {
    return (
      <div className={`flex items-center justify-center bg-ink-700 text-mist ${className}`}>
        <span className="font-display text-3xl opacity-40">NFT</span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-ink-700 ${className}`}>
      <Image
        src={resolved}
        alt={alt}
        fill
        unoptimized
        className="object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
