import type { JSX } from "react";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import { useTranslation } from "../hooks/useTranslation";

/**
 * The photo trip builder's page (`/trips/builder`, spec 2026-10-09 §G).
 *
 * The launcher in the create-trip popup lands here with `?job=<jobId>`. This
 * file starts as the route's landing page, a heading under the app shell; the
 * progress line, the review and the commit are built on it by the review-page
 * tasks.
 */
export default function TripBuilderPage(): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  return (
    <AppShell width="reading">
      <PageHeader title={t("tripBuilder:page.title")} />
    </AppShell>
  );
}
