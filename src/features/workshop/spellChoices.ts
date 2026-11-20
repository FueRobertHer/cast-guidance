/**
 * The spells a Cast a spell card can name on a page whose editor names none
 * itself: the Workshop's, from the books (`WorkshopPage`). A list of cards
 * whose host passes `spells` uses those (`EffectCards`); without either, or
 * with a page whose books hold none, Cast a spell is not offered. Its own
 * file, so the page that provides it does not load the cards with it.
 */
import { createContext } from 'react';
import type { SpellOption } from './cards/kit/types';

export const SpellChoices = createContext<readonly SpellOption[] | undefined>(undefined);
