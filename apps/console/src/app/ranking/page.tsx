import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = getString(value);
    if (normalized) {
      query.set(key, normalized);
    }
  }
  redirect(query.toString() ? `/inspector?${query.toString()}` : "/inspector");
}
