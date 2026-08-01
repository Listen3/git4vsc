export function OperationActivity({ label }: { label?: string | null | undefined }) {
  if (!label) return null;
  return <div className="operation-activity" role="status" aria-live="polite" aria-label={label}>
    <span className="operation-progress-bar" />
    <span className="operation-activity-label"><span className="operation-spinner" />{label}</span>
  </div>;
}
