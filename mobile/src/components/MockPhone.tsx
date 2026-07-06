import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

export default function MockPhone({ children }: Props) {
  return (
    <div className="phone-shell">
      <div className="status-bar">09:41 • LTE</div>
      <div className="screen">{children}</div>
    </div>
  );
}
