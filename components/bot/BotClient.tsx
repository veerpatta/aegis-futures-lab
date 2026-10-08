"use client";
import { useEffect, useRef } from "react";
import ExperimentCard from "@/components/experiment/ExperimentCard";
import HistorySection from "@/components/history/HistorySection";
import LearnSection from "./LearnSection";
import ResearchSection from "./ResearchSection";
import page from "@/components/ui/page.module.css";
export default function BotClient() {
  const research = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const openResearch = () => { if (window.location.hash === "#research" && research.current) research.current.open = true; };
    openResearch();
    window.addEventListener("hashchange", openResearch);
    return () => window.removeEventListener("hashchange", openResearch);
  }, []);
  return <div className={page.page}>
    <header className={page.head}><h1 className="pageTitle">Learn</h1><p className={page.paperLine}>Virtual only · Delayed prices · No real money</p></header>
    <ExperimentCard /><LearnSection /><HistorySection />
    <details ref={research} className={page.details} id="research"><summary>Method research</summary><ResearchSection /></details>
  </div>;
}
