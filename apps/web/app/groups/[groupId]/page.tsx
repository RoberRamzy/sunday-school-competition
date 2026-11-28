import { notFound } from "next/navigation";
import { groupIdPattern } from "../../api";
import { Portal } from "../../components/portal";
import { initialState } from "../../initial-state";

export const metadata = { robots: { index: false, follow: false } };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  if (!groupIdPattern.test(groupId)) notFound();
  return <Portal key={groupId} groupId={groupId} {...await initialState()}/>;
}
