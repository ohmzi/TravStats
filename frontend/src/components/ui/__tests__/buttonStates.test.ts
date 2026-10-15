import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The primitives paint their skin inline, and an inline `background` beats any
 * plain stylesheet rule. So each state rule has to say `!important` on the
 * property it changes, or its hover and pressed colours never reach the screen.
 * jsdom does not apply stylesheets to computed style, so the declarations are
 * read from the file itself.
 */
const css = readFileSync(resolve(__dirname, "../../../theme/ui.css"), "utf8");

function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector} exists`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("button state rules beat the inline skin", () => {
  it.each([
    '.ts-button[data-variant="primary"]:hover:not(:disabled)',
    '.ts-button[data-variant="primary"]:active:not(:disabled)',
    '.ts-button[data-variant="secondary"]:hover:not(:disabled)',
    '.ts-button[data-variant="danger"]:hover:not(:disabled)',
  ])("%s marks background !important", (selector) => {
    expect(ruleBody(selector)).toMatch(/background:[^;]*!important;/);
  });

  it("marks the secondary hover colour !important too", () => {
    expect(ruleBody('.ts-button[data-variant="secondary"]:hover:not(:disabled)')).toMatch(
      /color:[^;]*!important;/
    );
  });
});
