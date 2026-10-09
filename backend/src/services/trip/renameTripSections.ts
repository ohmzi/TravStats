import type { DbTransaction } from "../../db";

/** What the photo trip builder puts between a trip's name and a roadtrip's city. */
export const SECTION_NAME_SEPARATOR = " · ";

/**
 * Carries a trip's new name to the sections still carrying its old one.
 *
 * A journey and its roadtrips read as one thing while their names agree, so a
 * section named exactly like the trip is renamed with it — and so is one named
 * "<trip> · <city>", the name the photo trip builder gives each of a trip's
 * several roadtrips (spec 2026-10-09 §C.11, §D1b): "Northvale loop · Port
 * Carrow" becomes "Westshire circuit · Port Carrow". A section named anything
 * else was named deliberately — a second section, an outbound and a return —
 * and keeps its own name.
 *
 * Runs inside the trip update's transaction. The prefix is checked again in
 * code because a database `LIKE` would read `%` or `_` in the old name as a
 * wildcard.
 */
export async function renameTripSections(
  tx: DbTransaction,
  tripId: string,
  oldName: string,
  newName: string
): Promise<void> {
  if (oldName === newName) return;
  const prefix = `${oldName}${SECTION_NAME_SEPARATOR}`;

  // Every section to rename is read before any is written. A trip renamed to
  // "<old> · <new>" would otherwise have its just-renamed section match the
  // prefix on a later read and be renamed a second time.
  const sections = await tx.tripRoute.findMany({
    where: { tripId, OR: [{ name: oldName }, { name: { startsWith: prefix } }] },
    select: { id: true, name: true },
  });
  for (const section of sections) {
    if (section.name === oldName) {
      await tx.tripRoute.update({ where: { id: section.id }, data: { name: newName } });
    } else if (section.name.startsWith(prefix)) {
      await tx.tripRoute.update({
        where: { id: section.id },
        data: { name: `${newName}${SECTION_NAME_SEPARATOR}${section.name.slice(prefix.length)}` },
      });
    }
  }
}
