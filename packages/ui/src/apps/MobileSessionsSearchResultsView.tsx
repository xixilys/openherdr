import React from 'react';

export interface MobileSessionsSearchResultsViewProps {
  sections: readonly {
    id: string;
    label: React.ReactNode;
    count: number;
    rows: React.ReactNode;
  }[];
}

export const MobileSessionsSearchResultsView: React.FC<MobileSessionsSearchResultsViewProps> = ({ sections }) => (
  <div className="flex flex-col gap-3 px-3 pt-2">
    {sections.filter((section) => section.count > 0).map((section) => (
      <section key={section.id}>
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="typography-micro font-semibold uppercase tracking-wider text-muted-foreground">
            {section.label}
          </span>
          <span className="typography-micro text-muted-foreground tabular-nums">
            {section.count}
          </span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-[var(--surface-elevated)]">
          {section.rows}
        </div>
      </section>
    ))}
  </div>
);
