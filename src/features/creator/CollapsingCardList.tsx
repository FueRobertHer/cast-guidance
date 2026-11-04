import { type ComponentProps, useLayoutEffect, useRef, useState } from 'react';
import { scrollBehavior } from '@/lib/motion';
import { Button } from '@/ui/Button';
import { EntityCardList, PickedEntityCard, uidOf } from '@/ui/EntityCardList';

type ListProps = ComponentProps<typeof EntityCardList>;

/**
 * A wizard step's pick-one list that folds into its pick. With nothing picked
 * it is the whole list. Once something is, it is that one card and a Change
 * button, so the choices that follow a pick (a subclass, skills, a subrace,
 * an origin feat) sit right under it. They used to wait below every other
 * card, past a few hundred backgrounds, where a new player never looked.
 *
 * Change opens the list again on the current pick, with a Keep button above
 * it; tapping the picked card keeps it too. Picking another folds the list
 * around the new pick, and the step's undo offer takes the swap back.
 */
export function CollapsingCardList({
  noun,
  heading,
  ...list
}: ListProps & {
  /** What is picked, as Change says it ("class", "subrace"). */
  noun: string;
  /** The picked name's heading level. */
  heading?: ComponentProps<typeof PickedEntityCard>['heading'];
}) {
  const picked =
    list.selectedUid === undefined
      ? undefined
      : list.entities.find((e) => uidOf(e) === list.selectedUid);
  const [changing, setChanging] = useState(false);

  // Where focus goes once the list has folded or opened: the card tapped to
  // pick goes away with the list, and the Change button with the picked card.
  const focusNext = useRef<'picked' | 'list' | null>(null);
  const pickedHeading = useRef<HTMLHeadingElement>(null);
  const listBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    const el =
      target === 'picked'
        ? pickedHeading.current
        : target === 'list'
          ? listBox.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
          : null;
    if (el == null) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  });

  const keep = () => {
    focusNext.current = 'picked';
    setChanging(false);
  };

  if (picked !== undefined && !changing) {
    return (
      <PickedEntityCard
        entity={picked}
        describe={list.describe}
        infoType={list.infoType}
        infoEntries={list.infoEntries}
        heading={heading}
        headingRef={pickedHeading}
        changeLabel={`Change ${noun}`}
        onChange={() => {
          focusNext.current = 'list';
          setChanging(true);
        }}
      />
    );
  }
  return (
    <div ref={listBox} className="flex flex-col gap-2">
      {picked !== undefined && (
        <Button variant="secondary" size="sm" onClick={keep} className="self-start">
          Keep {String(picked.name)}
        </Button>
      )}
      <EntityCardList
        {...list}
        onSelect={(e) => {
          focusNext.current = 'picked';
          setChanging(false);
          list.onSelect(e);
        }}
        onReselect={keep}
      />
    </div>
  );
}
