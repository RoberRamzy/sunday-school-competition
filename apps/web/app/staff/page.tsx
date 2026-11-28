import { Portal } from "../components/portal";
import { groupIdPattern } from "../api";
import { initialState } from "../initial-state";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const [state, params] = await Promise.all([initialState(), searchParams]);
  const groupId = params.group && groupIdPattern.test(params.group) ? params.group : undefined;
  return <Portal key={groupId ?? "staff"} staffEntry groupId={groupId} {...state} />;
}
