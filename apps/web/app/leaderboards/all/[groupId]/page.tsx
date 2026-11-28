import { notFound } from "next/navigation";
import { groupIdPattern } from "../../../api";
import { PublicLeaderboard } from "../../../components/leaderboard";
import { initialState } from "../../../initial-state";

export const metadata = { robots: { index: false, follow: false } };

export default async function GroupLeaderboard({ params }: { params: Promise<{ groupId: string }> }) {
  const [{ groupId }, { initialLanguage, initialTheme }] = await Promise.all([params, initialState()]);
  if (!groupIdPattern.test(groupId)) notFound();
  return <PublicLeaderboard key={groupId} id="all" groupId={groupId} language={initialLanguage} theme={initialTheme}/>;
}
