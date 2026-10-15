import type { JSX, ReactNode } from "react";

import ActionLink from "../ui/ActionLink";
import DetailHeader from "../ui/DetailHeader";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { FlagImg } from "../../lib/countryFlag";
import { countryName } from "../../shared/geo/countryCode";

/** What each level's head gets from its own level (design §2.1). */
interface LevelConfig {
  /** The level's EDIT PAGE (design §4) — the head's one and only action. */
  editPath: (id: string) => string;
  backTo: string;
  backLabelKey: string;
  /** The 48px mark's glyph; the tile's colour is the roadtrip domain's. */
  icon: ReactNode;
}

const LEVELS = {
  journey: {
    // The modal's fields become a page at this path (design §4); the route is
    // registered by the edit page's own task.
    editPath: (id: string) => `/trips/${id}/edit`,
    backTo: "/trips",
    backLabelKey: "trips:tab",
    icon: <Icon name="route" size={24} />,
  },
  trip: {
    // A trip's edit page is the route & recordings editor (design §4); Task
    // J6 registers that route — that is the trip's one Edit target.
    editPath: (id: string) => `/roadtrips/${id}/edit`,
    backTo: "/roadtrips",
    backLabelKey: "roadtrips:pageTitle",
    icon: <Icon name="caravan" size={24} />,
  },
} satisfies Record<string, LevelConfig>;

export type EntityHeaderLevel = keyof typeof LEVELS;

export interface EntityHeaderProps {
  level: EntityHeaderLevel;
  /** The entity's id — the level's edit path is built from it. */
  id: string;
  name: string;
  /** ISO alpha-2 codes, as both entities store them; duplicates fold to one chip. */
  countries: readonly string[];
}

/**
 * The head of both levels (design 2026-10-12 §2.1): the entity's NAME and its
 * COUNTRY FLAGS only — "No meta line, no 'Car · …', no 'Completed · …'" — and
 * exactly ONE action, Edit, linking to the level's edit page — amber, the
 * colour every Edit and Save wears (owner, 2026-10-15). Delete and
 * Re-sync from Immich live there now (design §4), not here.
 *
 * It is the app's one head primitive (`ui/DetailHeader`, the head of the four
 * domain details — `detailHeaderFamily.test.ts` is the guard) rather than a
 * third head: the frame, the 48px domain tile and the back link (which goes
 * back to where the reader came from) come from it, and this component adds
 * only what the two levels share — the flag chips and the one Edit link. The
 * level table is what "config-driven" means: the edit path, the back link and
 * the mark's glyph are the whole difference between a journey's head and a
 * trip's.
 *
 * The journey's cover backdrop is NOT drawn: design §2.1 gives the head the
 * name and the flags "only". The field itself is untouched, and the journey
 * edit page (design §4) is where the cover can live from now on.
 */
export default function EntityHeader({
  level,
  id,
  name,
  countries,
}: EntityHeaderProps): JSX.Element {
  const { t, i18n } = useTranslation(["common"]);
  const config = LEVELS[level];
  // A stored list can hold the same country twice (the journey head's own
  // finding, 2026-10-09): fold it, so the chips cannot repeat.
  const distinct = [...new Set(countries)];

  return (
    <DetailHeader
      backTo={config.backTo}
      backLabel={t(config.backLabelKey)}
      domain="roadtrip"
      icon={config.icon}
      title={name}
      subtitle={
        distinct.length > 0 ? (
          <ul className="flex flex-wrap" style={{ gap: 6 }}>
            {distinct.map((cc) => (
              <li
                key={cc}
                className="inline-flex items-center rounded-full"
                style={{
                  gap: 8,
                  padding: "4px 12px 4px 8px",
                  background: "var(--ts-surface2)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ts-text-bright)",
                }}
              >
                {/* Decorative: the name beside it is what names the country. */}
                <FlagImg country={cc} decorative />
                {countryName(cc, i18n.language)}
              </li>
            ))}
          </ul>
        ) : undefined
      }
      actions={
        <ActionLink to={config.editPath(id)} variant="primary">
          {t("common:buttons.edit")}
        </ActionLink>
      }
    />
  );
}
