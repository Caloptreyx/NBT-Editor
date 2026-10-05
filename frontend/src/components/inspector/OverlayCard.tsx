import classNames from 'classnames';
import type { ComponentProps } from 'react';

// a compact translucent card floating over the 3D view; overlay containers disable pointer events so the
// viewport keeps receiving drags between the cards
export default function OverlayCard({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={classNames(
        'pointer-events-auto rounded-md border border-(--mantine-color-default-border) bg-(--mantine-color-body)/80 text-sm shadow-lg backdrop-blur-md',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
