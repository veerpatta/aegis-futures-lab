import TradeDetail from "@/components/trades/TradeDetail";

export const metadata = { title: "Bot trade · Aegis Futures Lab" };

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TradeDetail id={id} />;
}
