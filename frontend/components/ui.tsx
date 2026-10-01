import Link from 'next/link';
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
export function SectionTitle({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {detail && <span>{detail}</span>}
      </div>
      {action}
    </div>
  );
}
export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`tag tag-${tone.toLowerCase().replaceAll(' ', '-')}`}>{children}</span>;
}
export function StationLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link href={`/stations/${id}`} className="text-link">
      {children}
    </Link>
  );
}
