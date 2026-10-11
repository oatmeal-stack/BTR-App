import { STATUS_LABEL, type ReadingStatus } from "@/domain/book";

export function StatusChip({ status }: { status: ReadingStatus }) {
  return <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>;
}
