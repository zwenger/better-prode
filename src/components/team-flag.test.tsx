// @vitest-environment jsdom
/**
 * TDD 3.2 (RED): TeamFlag component tests.
 *
 * Spec coverage (team-flags):
 *  - Valid ISO code renders a flag element (no external request)
 *  - null code renders a placeholder with data-testid="flag-placeholder"
 *  - Unknown/unmapped code renders a placeholder (no crash)
 *  - No network requests are made (flag-icons uses bundled CSS, no fetch)
 *
 * Uses @testing-library/react with jsdom — no network requests possible.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamFlag } from "./team-flag";

// ---------------------------------------------------------------------------
// Valid ISO code → renders flag element
// ---------------------------------------------------------------------------

describe("TeamFlag — valid ISO code", () => {
  it("renders a flag element with the correct flag-icons class", () => {
    render(<TeamFlag code="AR" />);
    // flag-icons uses .fi.fi-{lowercase code} convention
    const flag = document.querySelector(".fi-ar");
    expect(flag).toBeTruthy();
  });

  it("renders a flag element, not a placeholder, for a known code", () => {
    render(<TeamFlag code="MX" />);
    const placeholder = screen.queryByTestId("flag-placeholder");
    expect(placeholder).toBeNull();
  });

  it("applies the base fi class for flag-icons rendering", () => {
    render(<TeamFlag code="FR" />);
    const flag = document.querySelector(".fi.fi-fr");
    expect(flag).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// null code → placeholder
// ---------------------------------------------------------------------------

describe("TeamFlag — null code (unmapped team)", () => {
  it("renders a placeholder when code is null", () => {
    render(<TeamFlag code={null} />);
    const placeholder = screen.getByTestId("flag-placeholder");
    expect(placeholder).toBeTruthy();
  });

  it("placeholder has accessible aria-label", () => {
    render(<TeamFlag code={null} />);
    const placeholder = screen.getByTestId("flag-placeholder");
    expect(placeholder.getAttribute("aria-label")).toBe("Unknown flag");
  });

  it("null code renders no .fi element (no flag attempted)", () => {
    render(<TeamFlag code={null} />);
    const flag = document.querySelector(".fi");
    expect(flag).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unknown/invalid code → placeholder (no crash)
// ---------------------------------------------------------------------------

describe("TeamFlag — unknown/invalid code", () => {
  it("renders a placeholder for an unknown code string", () => {
    // "ZZ" is not a real ISO 3166-1 alpha-2 code and not in flag-icons country.json
    render(<TeamFlag code="ZZ" />);
    const placeholder = screen.getByTestId("flag-placeholder");
    expect(placeholder).toBeTruthy();
  });

  it("renders a placeholder for an empty string code", () => {
    render(<TeamFlag code="" />);
    const placeholder = screen.getByTestId("flag-placeholder");
    expect(placeholder).toBeTruthy();
  });

  it("renders a placeholder for undefined code", () => {
    render(<TeamFlag code={undefined} />);
    const placeholder = screen.getByTestId("flag-placeholder");
    expect(placeholder).toBeTruthy();
  });

  it("does not crash and renders no .fi element for unknown code", () => {
    render(<TeamFlag code="NOTREAL" />);
    const flag = document.querySelector(".fi");
    expect(flag).toBeNull();
  });
});
