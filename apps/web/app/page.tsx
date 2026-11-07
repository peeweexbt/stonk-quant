import type { Metadata } from "next";
import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "Stock Quant",
  description: "Spawn ASCII trading agents that buy and manage tokenized stocks and stock-paired coins on Solana for you.",
};

export default function Page() {
  return <Landing />;
}
