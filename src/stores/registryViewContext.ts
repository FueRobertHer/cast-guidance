import { createContext } from 'react';
import type { ViewCharacter } from '@/data5e/registryView';

/**
 * The character whose view of the registry every registry hook under it reads
 * (ADR-002, D3): its sheet, its pickers and its info sheets see the versions
 * its collection switches pick. Outside one, the shared registry.
 *
 * Its own module, not the hooks': many tests mock `@/data5e/hooks` whole, and
 * a sheet rendered under such a mock still needs the provider. Here rather
 * than in `data5e`, which stays React-free outside `hooks.ts`.
 */
export const RegistryViewContext = createContext<ViewCharacter | undefined>(undefined);

export const RegistryViewProvider = RegistryViewContext.Provider;
