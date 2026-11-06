"use client";

/* Learn — is the bot getting smarter? (plan:
   docs/superpowers/plans/2026-11-07-free-ai-and-ui-revamp.md)

   First what a non-trader asks: learning progress, who is in charge and how
   the free AI's second opinion is doing. Everything technical (candidates,
   reviews, change history, the bot's jobs, owner tools, the historical study
   and method research) sits in folds that load only when opened. The virtual
   account itself lives on Today; it is not repeated here. */

import HistorySection from "@/components/history/HistorySection";
import Fold from "@/components/ui/Fold";
import LearnSection from "./LearnSection";
import ResearchSection from "./ResearchSection";
import AIResearch from "./AIResearch";
import OwnerControls from "./OwnerControls";
import page from "@/components/ui/page.module.css";

export default function BotClient() {
  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className="pageTitle">Learn</h1>
        <p className={page.paperLine}>How the bot learns · Virtual money only · Delayed prices</p>
      </header>
      <LearnSection />
      <Fold id="ai-research" summary="Ask the AI about your bot · owner only">
        <AIResearch />
      </Fold>
      <Fold id="owner" summary="Owner controls · pause, resume or start a campaign">
        <OwnerControls />
      </Fold>
      <Fold id="history" summary="Historical practice · the older-data study">
        <HistorySection />
      </Fold>
      <Fold id="research" summary="Method research · how each method was tested">
        <ResearchSection />
      </Fold>
    </div>
  );
}
