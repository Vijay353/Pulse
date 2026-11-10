/**
 * Lifecycle stepper model (V3 CH-14). One mapping from every real
 * InvestigationStatus to presentation; the Record type makes TypeScript fail
 * if a status is ever added without a mapping. No client-side state machine:
 * the status always comes from the server.
 */
import type { InvestigationStatus } from "../../../../packages/contracts/src/index";

export const STEPS = ["Alert received", "Checked", "Manager decision", "Pause sent", "Verified by readback"] as const;

export type StepState = "done" | "current" | "upcoming" | "not-reached";
export interface Lifecycle {
  steps: { label: string; state: StepState }[];
  ending: { text: string; kind: "success" | "stopped" | "waiting" } | null;
}

/** `at`: index of the first step not yet completed (for stopped endings: the first step that was never reached). */
interface Map { at: number; ending?: Lifecycle["ending"] }

const MAP: Record<InvestigationStatus, Map | ((ctx: { hadApproval: boolean }) => Map)> = {
  RECEIVED: { at: 0 },
  ASSESSING: { at: 1 },
  NO_ACTION: { at: 2, ending: { text: "Ended: no action needed", kind: "stopped" } },
  NEEDS_REVIEW: { at: 2, ending: { text: "Ended: needs a person to review", kind: "stopped" } },
  BLOCKED: ({ hadApproval }) => (hadApproval
    ? { at: 3, ending: { text: "Stopped before sending: blocked by a final check", kind: "stopped" } }
    : { at: 2, ending: { text: "Stopped: blocked by a check", kind: "stopped" } }),
  RECOMMENDATION_READY: { at: 2 },
  AWAITING_APPROVAL: { at: 2, ending: { text: "Waiting for a manager", kind: "waiting" } },
  APPROVED: { at: 3, ending: { text: "Approved, sending the pause", kind: "waiting" } },
  PAUSE_REQUESTED: { at: 3 },
  PAUSE_REQUESTED_NOT_VERIFIED: { at: 4, ending: { text: "Pause not confirmed yet", kind: "waiting" } },
  PAUSE_VERIFIED: { at: 5, ending: { text: "Done: paused and verified", kind: "success" } },
  DISMISSED: { at: 3, ending: { text: "Ended: manager kept the campaign active", kind: "stopped" } },
};

export function lifecycle(status: InvestigationStatus, ctx: { hadApproval: boolean }): Lifecycle {
  const m0 = MAP[status];
  const m = typeof m0 === "function" ? m0(ctx) : m0;
  const stopped = m.ending?.kind === "stopped";
  return {
    ending: m.ending ?? null,
    steps: STEPS.map((label, i) => ({
      label,
      state: i < m.at ? "done" : stopped ? "not-reached" : i === m.at ? "current" : "upcoming",
    })),
  };
}
