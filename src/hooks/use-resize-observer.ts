import { useEffect, useRef } from "react";

const useResizeObserver = <T extends HTMLElement>(onResize: (size: { width: number, height: number }) => void) => {

  const elementRef = useRef<T>(null);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      onResize({ width: entries[0].contentRect.width, height: entries[0].contentRect.height });
    });

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return elementRef
};

export { useResizeObserver };