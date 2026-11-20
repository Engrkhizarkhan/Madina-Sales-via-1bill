import type { Ref } from "react";
import { voucherStyle, type ReceiptLayout } from "../shared/receipt-layout.mjs";

export type VoucherRow = {
  id: string;
  ticket: string;
  time: string;
  passenger: string;
  destination: string;
  seats: string;
  channel: string;
  amount: string;
  seatRows: { number: number; label: string; amount: string }[];
};
export type VoucherData = {
  date: string;
  run: number;
  vehicle: string;
  route: string;
  departure: string;
  service: string;
  driver: string;
  attendant: string;
  destinations: boolean;
  rows: VoucherRow[];
  totals: (string | number)[][];
  printed: string;
  preparedBy: string;
};

// The editor and the actual report use this same document, including print styles.
export function VoucherDocument({
  layout,
  data,
  thermal,
  ref,
}: {
  layout: ReceiptLayout;
  data: VoucherData;
  thermal: boolean;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <article
      ref={ref}
      style={voucherStyle(layout)}
      className={`print-document operations-document document-terminal-${thermal ? "thermal" : "a4"} ${thermal ? "report-thermal" : "report-a4"} ${data.rows.length > 50 ? "document-dense" : ""}`}
    >
      <header className="document-header">
        <div>
          <h1>{layout.businessName}</h1>
          <p className="document-brand-urdu" lang="ur" dir="rtl">
            مدینہ ایکسپریس
          </p>
          {layout.voucherShowContact && (
            <>
              <p>{layout.terminal}</p>
              <p>{layout.contact}</p>
            </>
          )}
        </div>
        <div className="document-title-block">
          <h2>{thermal ? "Terminal Voucher" : "Terminal Voucher Report"}</h2>
          <p>
            {data.date} · Run {data.run}
          </p>
          <strong>{data.vehicle}</strong>
        </div>
      </header>
      <div className="document-meta">
        <span>
          <small>Route</small>
          <strong>{data.route}</strong>
        </span>
        <span>
          <small>Departure</small>
          <strong>
            {data.date} · {data.departure}
          </strong>
        </span>
        <span>
          <small>Bus</small>
          <strong>
            {data.vehicle} · {data.service}
          </strong>
        </span>
        {layout.voucherShowCrew && (
          <>
            <span>
              <small>Driver</small>
              <strong>{data.driver}</strong>
            </span>
            <span>
              <small>Attendant</small>
              <strong>{data.attendant}</strong>
            </span>
          </>
        )}
      </div>
      {thermal ? (
        <>
          <h3 className="document-section-title">
            Seat · Passenger{layout.voucherShowNetCollected ? " · Net PKR" : ""}
          </h3>
          {data.rows
            .flatMap((row) => row.seatRows.map((seat) => ({ row, seat })))
            .sort((a, b) => a.seat.number - b.seat.number)
            .map(({ row, seat }) => (
              <div
                className="thermal-passenger"
                key={`${row.id}-${seat.label}`}
              >
                <span>
                  <b>{seat.label}</b>
                  <strong>
                    {row.passenger}
                    {data.destinations && <small> · {row.destination}</small>}
                  </strong>
                  {layout.voucherShowNetCollected && <b>{seat.amount}</b>}
                </span>
              </div>
            ))}
        </>
      ) : (
        <>
          <h3 className="document-section-title">
            Ticket &amp; payment register
          </h3>
          <table className="document-table">
            <colgroup>
              {(layout.voucherShowNetCollected
                ? [17, 8, 25, 14, 6, 10, 20]
                : [18, 9, 32, 22, 8, 11]
              ).map((width, index) => (
                <col key={index} style={{ width: `${width}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {[
                  "Ticket",
                  "Time",
                  "Passenger",
                  "Destination",
                  "Seats",
                  "Channel",
                  ...(layout.voucherShowNetCollected ? ["Net collected"] : []),
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.ticket}</td>
                  <td>{row.time}</td>
                  <td>{row.passenger}</td>
                  <td>{row.destination}</td>
                  <td>{row.seats}</td>
                  <td>{row.channel}</td>
                  {layout.voucherShowNetCollected && <td>{row.amount}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {!data.rows.length && (
        <p className="document-empty">
          No tickets recorded for this departure.
        </p>
      )}
      <h3 className="document-section-title">Collection summary</h3>
      {thermal ? (
        <div className="thermal-total">
          {data.totals.map(([label, value]) => (
            <span
              className={
                label === "Total remaining" ? "document-grand-total" : undefined
              }
              key={label}
            >
              {label}
              <b>{value}</b>
            </span>
          ))}
        </div>
      ) : (
        <div className="voucher-summary-grid">
          {data.totals.map(([label, value]) => (
            <span
              className={
                label === "Total remaining" ? "document-grand-total" : undefined
              }
              key={label}
            >
              <small>{label}</small>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="document-signatures">
        <span>Prepared by</span>
        <span>Checked by</span>
      </div>
      <footer className="document-footer">
        <span>Printed {data.printed}</span>
        <span>Prepared by {data.preparedBy}</span>
      </footer>
    </article>
  );
}
