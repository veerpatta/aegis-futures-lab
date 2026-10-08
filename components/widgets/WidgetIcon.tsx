export type IconName = "wallet" | "activity" | "learn" | "clock" | "arrow" | "check" | "pause" | "shield";
const paths: Record<IconName, string> = {
  wallet: "M20 8H5a2 2 0 0 1 0-4h13v4M4 6v12a2 2 0 0 0 2 2h14V8M20 12h-5v4h5",
  activity: "M3 12h4l3-7 4 14 3-7h4",
  learn: "m3 8 9-5 9 5-9 5-9-5Zm4 3v6l5 3 5-3v-6M21 8v7",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  arrow: "M5 17 19 3M8 3h11v11",
  check: "m5 12 4 4L19 6",
  pause: "M9 5v14M15 5v14",
  shield: "m12 3 8 3v6c0 4-5 7-8 9-3-2-8-5-8-9V6l8-3Zm-4 9 3 3 5-6",
};
export function WidgetIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name]} /></svg>;
}
