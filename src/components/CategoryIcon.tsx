"use client";

import { useState } from "react";

// Stable color per category name, so tiles look varied without any manual
// picking — same idea as a chat app's default avatar colors.
const PALETTE = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
];
function paletteFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * A category's register-tile icon: its picture when one is set, otherwise a
 * colored initial. Falls back to the initial if the image fails to load.
 */
export function CategoryIcon({
  category,
  size = 40,
}: {
  category: { name: string; iconUrl?: string };
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!category.iconUrl && !broken;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={category.iconUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-md object-cover"
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-md font-bold ${paletteFor(category.name)}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {(category.name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
