/** CH-14: every real status maps to an honest stepper state. */
import { describe, expect, it } from "vitest";
import { InvestigationStatus } from "../../packages/contracts/src/index";
import { lifecycle, STEPS } from "../../apps/web/src/state/lifecycle";

describe("lifecycle", () => {
  it.each(InvestigationStatus.options)("%s maps for both approval contexts", (status) => {
    for (const hadApproval of [false, true]) {
      const lc = lifecycle(status, { hadApproval });
      expect(lc.steps).toHaveLength(STEPS.length);
      expect(lc.steps.filter((s) => s.state === "current").length).toBeLessThanOrEqual(1);
      // a stopped ending never shows later steps as done or upcoming
      if (lc.ending?.kind === "stopped") expect(lc.steps.some((s) => s.state === "upcoming")).toBe(false);
    }
  });

  it("only PAUSE_VERIFIED shows every step done", () => {
    for (const s of InvestigationStatus.options) {
      const all = lifecycle(s, { hadApproval: true }).steps.every((x) => x.state === "done");
      expect(all).toBe(s === "PAUSE_VERIFIED");
    }
  });

  it("awaiting approval: two done, manager decision current", () => {
    expect(lifecycle("AWAITING_APPROVAL", { hadApproval: false }).steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
  });

  it("blocked is placed where it stopped, never as success", () => {
    expect(lifecycle("BLOCKED", { hadApproval: false }).steps.map((s) => s.state)).toEqual(["done", "done", "not-reached", "not-reached", "not-reached"]);
    expect(lifecycle("BLOCKED", { hadApproval: true }).steps.map((s) => s.state)).toEqual(["done", "done", "done", "not-reached", "not-reached"]);
    expect(lifecycle("BLOCKED", { hadApproval: true }).ending?.kind).toBe("stopped");
  });

  it("dismissed: the manager decision happened, nothing after it", () => {
    expect(lifecycle("DISMISSED", { hadApproval: false }).steps.map((s) => s.state)).toEqual(["done", "done", "done", "not-reached", "not-reached"]);
  });

  it("not verified keeps the last step current, not done", () => {
    const lc = lifecycle("PAUSE_REQUESTED_NOT_VERIFIED", { hadApproval: true });
    expect(lc.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "current"]);
    expect(lc.ending).toEqual({ text: "Pause not confirmed yet", kind: "waiting" });
  });
});
