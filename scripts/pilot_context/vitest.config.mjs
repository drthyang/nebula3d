// Vitest config for the Pilot context measurement (measure.spec.ts): run from
// web/ so its modules and node_modules resolve; outside CI's include patterns.
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../web", import.meta.url));
export default {
  root: web,
  test: { environment: "node", include: ["../scripts/pilot_context/*.spec.ts"], testTimeout: 120_000 },
};
