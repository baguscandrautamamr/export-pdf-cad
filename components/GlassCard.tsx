import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
}

export default function GlassCard({ children, className, title, description }: Props) {
  return (
    <section className={`glass-panel fade-in card${className ? ` ${className}` : ""}`}>
      {title ? <h2 className="card-title">{title}</h2> : null}
      {description ? <p className="card-desc">{description}</p> : null}
      {children}
    </section>
  );
}
