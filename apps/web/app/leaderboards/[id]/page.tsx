import { PublicLeaderboard } from "../../components/leaderboard";
import { initialState } from "../../initial-state";

export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { initialLanguage, initialTheme }] = await Promise.all([params, initialState()]);
  return <PublicLeaderboard id={id} language={initialLanguage} theme={initialTheme}/>;
}
