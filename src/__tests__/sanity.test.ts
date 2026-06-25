import { describe, it, expect } from "vitest";

describe("Vitest unit project — sanity check", () => {
  it("runs in the unit project", () => {
    expect(1 + 1).toBe(2);
  });

  it("has access to the #/ alias (import resolved)", async () => {
    // Dynamically import the utils module to verify alias resolution
    const { cn } = await import("#/lib/utils");
    const result = cn("foo", "bar");
    expect(result).toBe("foo bar");
  });
});
