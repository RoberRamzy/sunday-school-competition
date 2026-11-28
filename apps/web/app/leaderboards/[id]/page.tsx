import { notFound } from "next/navigation";
import { PublicLeaderboard } from "../../components/leaderboard";
import { groupIdPattern } from "../../api";
import { competitionEntryGroup, initialState } from "../../initial-state";

export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isCompetition = groupIdPattern.test(id);
  const [{ initialLanguage, initialTheme }, groupId] = await Promise.all([
    initialState(), isCompetition ? competitionEntryGroup(id) : undefined,
  ]);
  if (isCompetition && !groupId) notFound();
  return <PublicLeaderboard key={id} id={id} groupId={groupId} language={initialLanguage} theme={initialTheme}/>;
}
