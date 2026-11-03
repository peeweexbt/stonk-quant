import { blockedCountries } from "@stonkquant/core";

/** Vercel sets x-vercel-ip-country on every request. Returns the country if it's restricted. */
export function restrictedCountry(req: Request): string | null {
  const c = (req.headers.get("x-vercel-ip-country") || "").toUpperCase();
  if (!c) return null;
  return blockedCountries().includes(c) ? c : null;
}

export const RESTRICTED_MSG =
  "Stonk Quant isn't available in your region. Tokenized stocks (xStocks and PreStocks) are not offered to persons in restricted jurisdictions.";
