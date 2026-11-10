/**
 * What the one-use dice rule's sheet adds under its choices (the rolls canvas,
 * one-use dice B; the Rules board puts the choice itself in the House rules
 * group, `RuleSheet`): under 2024 rules neither die is offered before the
 * roll, and Bless has nothing to set, which it says, since a player will look
 * for it here.
 */
export function OneUseDiceNotes() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-ink-muted">
        Under 2024 rules Guidance is not one use, and Bardic Inspiration waits for a failed roll, so
        neither is offered before the roll.
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-body-strong">Bless</span>
        <p className="text-caption text-ink-muted">
          Rolls in with every attack and save, and the roll prompt shows it, where you can leave it
          out of one roll. There is nothing to set.
        </p>
      </div>
    </div>
  );
}
