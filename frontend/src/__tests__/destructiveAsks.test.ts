/**
 * An irreversible action asks first.
 *
 * Five places removed something the user cannot get back without a question:
 * a loyalty card (the spec's named defect — the card, and with it every stay
 * linked to it), a passkey, a share link, a photograph, and an instance's
 * login background. Each called its delete straight from the click handler.
 *
 * The test drives the SOURCE, not five components: rendering each one needs
 * its own fixture, and four of the five are the kind of component whose happy
 * path is easy to mock and whose failure path never gets written — which is
 * how these five shipped. What is asserted is the thing that was missing: the
 * handler awaits an answer before it deletes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CASES: Array<{ file: string; confirmCall: string }> = [
  { file: "components/lodging/MembershipManager.tsx", confirmCall: "confirmDelete" },
  { file: "components/Settings/PasskeySection.tsx", confirmCall: "confirmDelete" },
  { file: "components/Settings/ShareLinksSection.tsx", confirmCall: "confirmDelete" },
  { file: "components/common/PhotoStrip.tsx", confirmCall: "confirmDelete" },
  { file: "components/Admin/LoginBackgroundsCard.tsx", confirmCall: "confirmDelete" },
];

const read = (relative: string) => readFileSync(join(__dirname, "..", relative), "utf8");

describe("destructive actions", () => {
  it.each(CASES)("$file asks before it removes", ({ file, confirmCall }) => {
    const source = read(file);
    expect(source, `${file} does not use the confirm hook`).toContain("useConfirmDialog");
    expect(source, `${file} never awaits an answer`).toContain(`await ${confirmCall}(`);
    // The shape that shipped: the handler calls the API with no question in
    // front of it. `if (!(await confirmDelete(...))) return;` is the guard.
    expect(source, `${file} does not bail out on a declined confirm`).toMatch(
      new RegExp(`if\\s*\\(\\s*!\\(await\\s+${confirmCall}\\(`)
    );
    // And the dialog has to be rendered, or the promise never settles.
    expect(source, `${file} never renders confirmDialog`).toContain("{confirmDialog}");
  });
});
