import {
  boardingStyle,
  type ReceiptLayout,
} from "../shared/receipt-layout.mjs";
export type BoardingPassData = {
  seats: string;
  bus: string;
  destination: string;
  date: string;
  time: string;
  ticket: string;
  paid: string;
  seller?: string;
};
export function BoardingPass({
  layout,
  data,
}: {
  layout: ReceiptLayout;
  data: BoardingPassData;
}) {
  return (
    <article
      style={boardingStyle(layout)}
      className="conductor-token boarding-pass"
      aria-label={`Conductor boarding token seat ${data.seats}`}
    >
      <header
        className={
          layout.boardingHeaderLayout === "stacked"
            ? "boarding-header-stacked"
            : undefined
        }
      >
        {layout.boardingBusinessName && (
          <strong>{layout.boardingBusinessName}</strong>
        )}
        <span>{layout.tokenTitle}</span>
      </header>
      <div className="token-seats">
        <span>{layout.boardingSeatLabel}</span>
        <strong>{data.seats}</strong>
      </div>
      <table className="token-table">
        <tbody>
          <tr>
            <th>{layout.boardingBusLabel}</th>
            <th>{layout.boardingDestinationLabel}</th>
          </tr>
          <tr>
            <td>{data.bus}</td>
            <td>{data.destination}</td>
          </tr>
          <tr>
            <th>{layout.boardingDateLabel}</th>
            <th>{layout.boardingDepartureLabel}</th>
          </tr>
          <tr>
            <td>{data.date}</td>
            <td className="token-time">{data.time}</td>
          </tr>
          <tr>
            <th colSpan={layout.boardingShowPaid ? 1 : 2}>
              {layout.boardingTicketLabel}
            </th>
            {layout.boardingShowPaid && <th>{layout.boardingPaidLabel}</th>}
          </tr>
          <tr>
            <td colSpan={layout.boardingShowPaid ? 1 : 2}>{data.ticket}</td>
            {layout.boardingShowPaid && <td>{data.paid}</td>}
          </tr>
          {layout.boardingShowSeller && data.seller && (
            <tr className="token-seller">
              <td colSpan={2}>
                <span>{layout.boardingSellerLabel}</span>{" "}
                <strong>{data.seller}</strong>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {layout.boardingShowNote && layout.tokenNote && (
        <p className="ticket-urdu" lang="ur" dir="rtl">
          {layout.tokenNote}
        </p>
      )}
    </article>
  );
}
