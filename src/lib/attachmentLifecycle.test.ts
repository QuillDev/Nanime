import { describe, expect, test } from "bun:test";
import { attachmentLifecycle } from "./attachmentLifecycle.ts";

describe("managed media attachment lifecycle", () => {
  test("detaches before releasing and only disposes once", () => {
    const order: string[] = [];
    const lifecycle = attachmentLifecycle(() => order.push("release"));
    lifecycle.attach(() => order.push("detach"));

    lifecycle.dispose();
    lifecycle.dispose();

    expect(order).toEqual(["detach", "release"]);
  });

  test("immediately tears down an engine attached after disposal", () => {
    const order: string[] = [];
    const lifecycle = attachmentLifecycle(() => order.push("release"));

    lifecycle.dispose();
    lifecycle.attach(() => order.push("detach"));

    expect(lifecycle.active()).toBe(false);
    expect(order).toEqual(["release", "detach"]);
  });
});
