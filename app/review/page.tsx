import type { Metadata } from "next";
import ReviewClient from "@/components/review/ReviewClient";

export const metadata: Metadata = {
  title: "Review — Aegis Futures Lab",
  description:
    "Post-trade review for the Aegis paper engine: a P&L calendar, a year heatmap, and performance sliced by session, weekday, market and regime — every slice with its sample size.",
};

export default function ReviewPage() {
  return <ReviewClient />;
}
