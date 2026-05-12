import { getWorkbenchSnapshot } from "../src/server/service";
import { WorkbenchClient } from "./workbench-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getWorkbenchSnapshot();
  return <WorkbenchClient initialSnapshot={snapshot} />;
}
