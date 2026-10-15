/**
 * The two admin confirms that painted themselves.
 *
 * Both passed a raw Tailwind palette string to `confirmButtonClass` — the 2FA
 * reset in orange, the SMTP delete in red. Orange exists nowhere in the design
 * system (DESIGN_SYSTEM.md §2 has accent, good, warn, bad and nothing else), so
 * it was a fifth semantic colour invented by one dialog; and the red bypassed
 * the token layer to reach Tailwind's own red, which is a different red from
 * `--ts-bad`.
 *
 * Read as source rather than rendered, because the point is the absence of a
 * palette class in the call site — a render assertion could pass while a
 * leftover `text-white` sat beside it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string) =>
  readFileSync(join(__dirname, "..", "..", "..", relative), "utf8");

describe("the admin confirm dialogs", () => {
  it("paints neither of them from the Tailwind palette", () => {
    for (const file of [
      "components/Admin/UserManagement.tsx",
      "components/Admin/SmtpManager.tsx",
    ]) {
      const source = read(file);
      for (const family of ["orange", "red", "slate", "gray", "zinc"]) {
        expect(source, `${file} still names a raw Tailwind ${family} colour`).not.toMatch(
          new RegExp(`\\b(?:text|bg|border|ring|from|to|via)-${family}-\\d{2,3}\\b`)
        );
      }
      expect(source, `${file} still passes confirmButtonClass`).not.toContain("confirmButtonClass");
    }
  });
});
