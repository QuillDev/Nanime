import { describe, expect, test } from "bun:test";
import {
  ControlVisibilityController,
  type VisibilityScheduler,
  type VisibilityTimer,
} from "./controlVisibility.ts";

class ManualScheduler implements VisibilityScheduler {
  private nextId = 1;
  private readonly timers = new Map<number, () => void>();

  readonly schedule = (task: () => void): VisibilityTimer => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, task);
    return { cancel: () => this.timers.delete(id) };
  };

  runPending(): void {
    const pending = [...this.timers.values()];
    this.timers.clear();
    for (const task of pending) {
      task();
    }
  }
}

function visibilityHarness() {
  const scheduler = new ManualScheduler();
  const changes: boolean[] = [];
  const controller = new ControlVisibilityController(
    (visible) => changes.push(visible),
    scheduler,
  );
  return { changes, controller, scheduler };
}

describe("player control visibility", () => {
  test("holds controls open for the entire timeline drag", () => {
    const { changes, controller, scheduler } = visibilityHarness();

    controller.activity();
    controller.interactionStart();
    scheduler.runPending();
    expect(changes).toEqual([true, true]);

    controller.interactionEnd();
    scheduler.runPending();
    expect(changes).toEqual([true, true, true, false]);
  });

  test("new activity replaces the previous auto-dismiss timer", () => {
    const { changes, controller, scheduler } = visibilityHarness();

    controller.activity();
    controller.activity();
    scheduler.runPending();
    expect(changes).toEqual([true, true, false]);
  });

  test("explicit hiding and disposal cancel pending dismissal", () => {
    const hidden = visibilityHarness();
    hidden.controller.activity();
    hidden.controller.hide();
    hidden.scheduler.runPending();
    expect(hidden.changes).toEqual([true, false]);

    const disposed = visibilityHarness();
    disposed.controller.activity();
    disposed.controller.dispose();
    disposed.scheduler.runPending();
    expect(disposed.changes).toEqual([true]);
  });
});
