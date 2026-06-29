/**
 * TDD 3.1 (RED): decodePlaceholder — pure domain function for FIFA placeholder codes.
 *
 * Spec: a pure function that maps FIFA placeholder codes to Spanish labels.
 * Never throws, never returns a raw FIFA code.
 */

import { describe, it, expect } from "vitest";
import { decodePlaceholder } from "#/domain/decode-placeholder";

describe("decodePlaceholder — FIFA code to Spanish label", () => {
  describe("W{n} — winner of match n", () => {
    it("W74 → 'Ganador partido 74'", () => {
      expect(decodePlaceholder("W74")).toBe("Ganador partido 74");
    });

    it("W1 → 'Ganador partido 1'", () => {
      expect(decodePlaceholder("W1")).toBe("Ganador partido 1");
    });

    it("W100 → 'Ganador partido 100'", () => {
      expect(decodePlaceholder("W100")).toBe("Ganador partido 100");
    });
  });

  describe("RU{n} — runner-up (loser) of match n", () => {
    it("RU101 → 'Perdedor partido 101'", () => {
      expect(decodePlaceholder("RU101")).toBe("Perdedor partido 101");
    });

    it("RU5 → 'Perdedor partido 5'", () => {
      expect(decodePlaceholder("RU5")).toBe("Perdedor partido 5");
    });
  });

  describe("1{X} — first-place team from group X", () => {
    it("1A → '1° Grupo A'", () => {
      expect(decodePlaceholder("1A")).toBe("1° Grupo A");
    });

    it("1B → '1° Grupo B'", () => {
      expect(decodePlaceholder("1B")).toBe("1° Grupo B");
    });
  });

  describe("2{X} — second-place team from group X", () => {
    it("2B → '2° Grupo B'", () => {
      expect(decodePlaceholder("2B")).toBe("2° Grupo B");
    });

    it("2C → '2° Grupo C'", () => {
      expect(decodePlaceholder("2C")).toBe("2° Grupo C");
    });
  });

  describe("3{XXXX} — best third-place team across specified groups", () => {
    it("3ABCDF → 'Mejor 3° (A/B/C/D/F)'", () => {
      expect(decodePlaceholder("3ABCDF")).toBe("Mejor 3° (A/B/C/D/F)");
    });

    it("3ABC → 'Mejor 3° (A/B/C)'", () => {
      expect(decodePlaceholder("3ABC")).toBe("Mejor 3° (A/B/C)");
    });

    it("3A → 'Por confirmar' (single-letter best-third is out of format)", () => {
      // The best-third pattern requires 2+ group letters; a single letter is
      // not a valid best-third code, so it must fall through to the fallback.
      expect(decodePlaceholder("3A")).toBe("Por confirmar");
    });
  });

  describe("fallback — null, empty, or unrecognized code", () => {
    it("null → 'Por confirmar'", () => {
      expect(decodePlaceholder(null)).toBe("Por confirmar");
    });

    it("empty string → 'Por confirmar'", () => {
      expect(decodePlaceholder("")).toBe("Por confirmar");
    });

    it("unrecognized code XYZ99 → 'Por confirmar'", () => {
      expect(decodePlaceholder("XYZ99")).toBe("Por confirmar");
    });

    it("random gibberish → 'Por confirmar'", () => {
      expect(decodePlaceholder("??FOO")).toBe("Por confirmar");
    });
  });

  describe("never throws for any input", () => {
    it("does not throw for a very long string", () => {
      expect(() => decodePlaceholder("A".repeat(100))).not.toThrow();
    });

    it("does not throw for a string with special chars", () => {
      expect(() => decodePlaceholder("W!@#$%")).not.toThrow();
    });
  });
});
