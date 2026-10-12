import type { JSX, ReactNode } from "react";

import EntityFigures, { type EntityFiguresProps } from "./EntityFigures";

export type EntityPageProps = EntityFiguresProps & {
  /**
   * The level's head — `EntityHeader` (design §2.1: name + country flags, one
   * Edit action). A node, so the shell never has to know the entity again.
   */
  header: ReactNode;
  /** The level's tab bar, driven by the `?tab=` mechanism (design §2.3). */
  tabBar?: ReactNode;
  /** The open tab's body. */
  children: ReactNode;
};

/**
 * The shared page shell both levels render (design 2026-10-12 §2): the head,
 * the figures table, the tab bar and the open tab's body, in THAT order and at
 * the page's one rhythm — so the journey and the trip cannot put their three
 * in two orders or at two gaps, which is the whole point of one template.
 *
 * It places what it is handed: the head is the caller's `EntityHeader` and the
 * tab bar is the `?tab=` mechanism's component, while the LEVEL's own data
 * goes to `EntityFigures`, the one part the shell does build (its cells are
 * the level's — design §2.2). The head carries its own bottom margin
 * (`DetailHeader`'s), so the shell adds none between it and the band, and one
 * `--ts-space-xl` before the tab bar and the body.
 *
 * It draws no `AppShell`: the page owns its width, its loading state and its
 * error state, and wraps this shell only once it has something to show.
 */
export default function EntityPage(props: EntityPageProps): JSX.Element {
  const { header, tabBar, children } = props;
  return (
    <div className="flex flex-col">
      {header}
      {props.level === "journey" ? (
        <EntityFigures
          level="journey"
          trip={props.trip}
          roadtrips={props.roadtrips}
          flights={props.flights}
        />
      ) : (
        <EntityFigures level="trip" detail={props.detail} today={props.today} />
      )}
      {tabBar ? <div style={{ marginTop: "var(--ts-space-xl)" }}>{tabBar}</div> : null}
      <div style={{ marginTop: "var(--ts-space-xl)" }}>{children}</div>
    </div>
  );
}
