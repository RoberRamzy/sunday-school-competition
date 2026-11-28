import { notFound } from "next/navigation";
import { Portal } from "../../components/portal";
import { competitionEntryGroup, initialState } from "../../initial-state";

export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const [state, groupId] = await Promise.all([initialState(), competitionEntryGroup(id)]);
  return <Portal key={id} competitionId={id} groupId={groupId} {...state}/>;
}
