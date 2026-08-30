import { describe, expect, mock, test } from "bun:test";
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
    const detach = mock(() => undefined);
    const release = mock(() => undefined);
    const lifecycle = attachmentLifecycle(release);

    lifecycle.dispose();
    lifecycle.attach(detach);

    expect(lifecycle.active()).toBe(false);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
