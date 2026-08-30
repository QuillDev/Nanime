export interface AttachmentLifecycle {
  readonly active: () => boolean;
  readonly attach: (detach: (() => void) | undefined) => void;
  readonly dispose: () => void;
}

export function attachmentLifecycle(release: () => void): AttachmentLifecycle {
  let active = true;
  let detach: (() => void) | undefined = undefined;
  return {
    active: () => active,
    attach(next) {
      if (active) {
        detach = next;
      } else {
        next?.();
      }
    },
    dispose() {
      if (!active) {
        return;
      }
      active = false;
      detach?.();
      release();
    },
  };
}
