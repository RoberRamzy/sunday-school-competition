import { Portal } from "../components/portal";
import { initialState } from "../initial-state";

export default async function StaffPage() {
  return <Portal staffEntry {...await initialState()} />;
}
