import { Button, type ButtonProps } from '@/ui/Button';
import { ChipFace, type ChipWear, NOT_WORN } from '@/ui/ChipFace';

/**
 * A spell row's Cast. It wears what stops casting (`conditionWear` on the
 * "Can't take actions" warning), and never flashes, because it doesn't roll. One
 * that can't be pressed anyway stays plain, so it still reads as disabled.
 */
export function CastButton({
  wear,
  disabled,
  ...props
}: Omit<ButtonProps, 'variant' | 'size' | 'className' | 'children'> & { wear: ChipWear }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="-my-1 relative p-0!"
      disabled={disabled}
      {...props}
    >
      <ChipFace surface="cast" wear={disabled === true ? NOT_WORN : wear} rolls={0} showing={false}>
        Cast
      </ChipFace>
    </Button>
  );
}
