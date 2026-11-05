import { useEffect, useRef, useState } from 'react';
import type { DerivedResource, PlayState, SpellcastingBlock } from '@/engine/types';
import {
  availableCastResources,
  type CastResource,
  castResourceId,
  defaultCastResource,
} from './castResources';

/**
 * Which resource each castable spell will spend, keyed by the caller, held only
 * for as long as the tab is open: a pick is about this cast, not a setting.
 *
 * Anything that moves a slot, a pact slot, an arcanum or a pool drops every
 * standing pick. Suppressing an unavailable pick is not enough on its own: the
 * id would sit there and take effect again the moment the option came back, so
 * a choice made before a long rest would silently upcast the first cast after
 * it.
 */
export function useCastChoice(play: PlayState | undefined) {
  const [castChoice, setCastChoice] = useState<Record<string, string>>({});
  const spendState = JSON.stringify([
    play?.slotsSpent,
    play?.pactSlotsSpent,
    play?.arcanumUsed,
    play?.resources,
  ]);
  const lastSpendState = useRef(spendState);
  useEffect(() => {
    if (lastSpendState.current === spendState) return;
    lastSpendState.current = spendState;
    setCastChoice({});
  }, [spendState]);
  return {
    /**
     * What a cast will spend, and everything it could spend: the player's
     * standing pick when it is still on offer, else the automatic one. Checking
     * the pick against the live options is the synchronous guard that a cast in
     * the same tick as a build change cannot spend something the character no
     * longer has; the effect above is what stops a suppressed pick from coming
     * back.
     */
    resourceFor(
      key: string,
      block: SpellcastingBlock,
      level: number,
      current: PlayState,
      pools: readonly DerivedResource[],
    ) {
      const options = availableCastResources(block, current, level, pools);
      const picked = options.find((o) => castResourceId(o) === castChoice[key]);
      return {
        options,
        resource: picked ?? defaultCastResource(block, current, level, pools, options),
      };
    },
    choose(key: string, resource: CastResource) {
      setCastChoice((prev) => ({ ...prev, [key]: castResourceId(resource) }));
    },
  };
}
