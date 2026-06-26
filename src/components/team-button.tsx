"use client";

/**
 * TeamButton — flag + team name as a pressable button that opens the TeamSheet.
 *
 * Visually identical to TeamFlagWithName but wraps the content in a <button>
 * so the whole team display is keyboard-accessible and tappable (≥44px target).
 *
 * align="left"  → Flag | Name (home team)
 * align="right" → Name | Flag (away team)
 */

import { TeamFlag } from "#/components/team-flag";

interface TeamButtonProps {
  name: string;
  code: string | null;
  align: "left" | "right";
  onPress: () => void;
}

export function TeamButton({ name, code, align, onPress }: TeamButtonProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={[
        "flex items-center gap-2 flex-1 min-w-0 min-h-[44px]",
        "focus-visible:underline focus-visible:outline-none",
        align === "right" ? "justify-end text-right" : "justify-start",
      ].join(" ")}
    >
      {align === "right" && (
        <span className="font-medium truncate text-sm">{name}</span>
      )}
      <TeamFlag code={code} />
      {align === "left" && (
        <span className="font-medium truncate text-sm">{name}</span>
      )}
    </button>
  );
}
