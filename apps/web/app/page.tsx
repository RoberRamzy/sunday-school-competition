import { Portal } from "./components/portal";
import { initialState } from "./initial-state";

export default async function Page() {
  return <Portal {...await initialState()} />;
}
