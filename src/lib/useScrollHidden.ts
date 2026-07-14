import { useEffect, useState } from 'react';

/**
 * True while the user is scrolling DOWN the page — floating controls slide
 * out of the way so they never obscure the content being read. Scrolling up
 * (or reaching the ends) brings them back immediately.
 */
export function useScrollHidden(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const delta = y - lastY;
        lastY = y;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        // Small deltas (momentum wobble, iOS bounce) don't count.
        if (y <= 8 || y >= max - 8) setHidden(false);
        else if (delta > 6) setHidden(true);
        else if (delta < -6) setHidden(false);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return hidden;
}
