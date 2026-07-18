import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RAW: Array<[string, string, string, string]> = [
  ["U.S. Employment Situation (NFP)", "2026-06-05T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for May 2026"],
  ["U.S. Consumer Price Index", "2026-06-10T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for May 2026"],
  ["U.S. Producer Price Index", "2026-06-11T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for May 2026"],
  ["FOMC policy decision", "2026-06-17T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-07-02T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for June 2026"],
  ["U.S. Consumer Price Index", "2026-07-14T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for June 2026"],
  ["U.S. Producer Price Index", "2026-07-15T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for June 2026"],
  ["FOMC policy decision", "2026-07-29T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-08-07T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for July 2026"],
  ["U.S. Consumer Price Index", "2026-08-12T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for July 2026"],
  ["U.S. Producer Price Index", "2026-08-13T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for July 2026"],
  ["U.S. Employment Situation (NFP)", "2026-09-04T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for August 2026"],
  ["U.S. Producer Price Index", "2026-09-10T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for August 2026"],
  ["U.S. Consumer Price Index", "2026-09-11T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for August 2026"],
  ["FOMC policy decision", "2026-09-16T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-10-02T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for September 2026"],
  ["U.S. Consumer Price Index", "2026-10-14T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for September 2026"],
  ["U.S. Producer Price Index", "2026-10-15T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for September 2026"],
  ["FOMC policy decision", "2026-10-28T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-11-06T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for October 2026"],
  ["U.S. Consumer Price Index", "2026-11-10T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for October 2026"],
  ["U.S. Producer Price Index", "2026-11-13T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for October 2026"],
  ["FOMC policy decision", "2026-12-09T19:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
];

const events = RAW.map(([name, time, publisher, note]) => ({ name, time, publisher, note }));

export async function GET() {
  return NextResponse.json(
    {
      source: "BLS + FED OFFICIAL 2026",
      verified: true,
      coverage: ["CPI", "PPI", "Employment Situation (NFP)", "FOMC policy decisions"],
      limitation:
        "Unscheduled events and newly announced Federal Reserve speeches require a licensed real-time calendar.",
      events,
    },
    { headers: { "Cache-Control": "s-maxage=21600, stale-while-revalidate=86400" } }
  );
}
