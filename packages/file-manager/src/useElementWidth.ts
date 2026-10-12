import { useLayoutEffect, useState, type RefObject } from "react";

/** Container width, so layouts respond to the space the host gives them. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return undefined;
    }
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
