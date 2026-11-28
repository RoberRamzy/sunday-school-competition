import { PublicLeaderboard } from "../../components/leaderboard";
import { groupIdPattern } from "../../api";
import { competitionEntryGroup, initialState } from "../../initial-state";

export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { initialLanguage, initialTheme }] = await Promise.all([params, initialState()]);
  const groupId = groupIdPattern.test(id) ? await competitionEntryGroup(id) : undefined;
  return <PublicLeaderboard key={id} id={id} groupId={groupId} language={initialLanguage} theme={initialTheme}/>;
}
