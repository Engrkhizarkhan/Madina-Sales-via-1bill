import { useEffect, useRef, useState } from "react";
import {
  receiptDefaults,
  receiptFonts,
  voucherNumberFields,
  type ReceiptLayout,
} from "../shared/receipt-layout.mjs";
import { useReceiptSettings } from "./receipt-settings";
import { VoucherDocument, type VoucherData } from "./voucher-document";
type NumberKey = keyof typeof voucherNumberFields;
const flags = [
  "voucherShowNetCollected",
  "voucherShowContact",
  "voucherShowCrew",
] as const;
const padding = new Set([
  "voucherPaddingX",
  "voucherPaddingY",
  "voucherRowPadding",
]);
function designFor(layout: ReceiptLayout) {
  return {
    font: layout.voucherFont,
    numbers: Object.fromEntries(
      Object.keys(voucherNumberFields).map((key) => [
        key,
        String(layout[key as NumberKey]),
      ]),
    ) as Record<NumberKey, string>,
    flags: Object.fromEntries(flags.map((key) => [key, layout[key]])) as Pick<
      ReceiptLayout,
      (typeof flags)[number]
    >,
  };
}
type Draft = ReturnType<typeof designFor>;
function valuesFor(draft: Draft, fallback: ReceiptLayout) {
  const values = {
    ...draft.flags,
    voucherFont: draft.font,
  } as Partial<ReceiptLayout>;
  let valid = true;
  for (const key of Object.keys(voucherNumberFields) as NumberKey[]) {
    const raw = draft.numbers[key],
      value = Number(raw),
      ok =
        raw.trim() !== "" &&
        Number.isFinite(value) &&
        (padding.has(key) ? value >= 0 : value > 0);
    if (!ok) valid = false;
    values[key] = ok ? value : fallback[key];
  }
  return { values, valid };
}
const sample: VoucherData = {
  date: "20-Nov-26",
  run: 1,
  vehicle: "ME-123",
  route: "Peshawar → D. I. Khan",
  departure: "19:00",
  service: "Standard Plus",
  driver: "Driver name",
  attendant: "Attendant name",
  destinations: false,
  rows: [
    {
      id: "1",
      ticket: "ME-000001",
      time: "18:10",
      passenger: "Passenger 1",
      destination: "D. I. Khan",
      seats: "3",
      channel: "Cash",
      amount: "PKR 2,200",
      seatRows: [{ number: 3, label: "3", amount: "2,200" }],
    },
    {
      id: "2",
      ticket: "ME-000002",
      time: "18:12",
      passenger: "Passenger 2",
      destination: "D. I. Khan",
      seats: "4",
      channel: "Cash",
      amount: "PKR 2,200",
      seatRows: [{ number: 4, label: "4", amount: "2,200" }],
    },
  ],
  totals: [
    ["Paid tickets", 2],
    ["Net collected", "PKR 4,400"],
    ["Commission (10%)", "PKR 440"],
    ["Refreshments", "PKR 100"],
    ["Total deductions", "PKR 540"],
    ["Total remaining", "PKR 3,860"],
  ],
  printed: "20-Nov-26 · 18:15",
  preparedBy: "Account name",
};

function VoucherPreview({
  layout,
  thermal,
}: {
  layout: ReceiptLayout;
  thermal: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    paper = useRef<HTMLElement>(null),
    [size, setSize] = useState({ scale: 1, height: 0 });
  useEffect(() => {
    if (!host.current || !paper.current) return;
    const measure = () => {
      const width = paper.current!.offsetWidth,
        scale = Math.min(
          1,
          Math.max(1, host.current!.clientWidth - 24) / Math.max(1, width),
        ),
        height = paper.current!.offsetHeight * scale;
      setSize((old) =>
        Math.abs(old.scale - scale) < 0.001 && Math.abs(old.height - height) < 1
          ? old
          : { scale, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host.current);
    observer.observe(paper.current);
    measure();
    return () => observer.disconnect();
  }, [thermal]);
  return (
    <div ref={host} className="voucher-preview-viewport">
      <div style={{ height: size.height || undefined }}>
        <div
          className="voucher-preview-paper"
          style={{ transform: `scale(${size.scale})` }}
        >
          <VoucherDocument
            ref={paper}
            layout={layout}
            data={sample}
            thermal={thermal}
          />
        </div>
      </div>
    </div>
  );
}

export default function VoucherDesignEditor({
  editable,
}: {
  editable: boolean;
}) {
  const { layout, save } = useReceiptSettings(),
    [draft, setDraft] = useState(() => designFor(layout)),
    previous = useRef(layout),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [thermal, setThermal] = useState(true);
  useEffect(() => {
    setDraft((current) =>
      JSON.stringify(current) === JSON.stringify(designFor(previous.current))
        ? designFor(layout)
        : current,
    );
    previous.current = layout;
  }, [layout]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(designFor(layout)),
    { values, valid } = valuesFor(draft, layout);
  return (
    <details className="receipt-editor voucher-design-editor">
      <summary>Edit voucher design</summary>
      <div className="receipt-design-workspace">
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !valid) return;
            setBusy(true);
            setMessage("");
            try {
              await save(values);
              setDraft(designFor({ ...layout, ...values }));
              setMessage("Voucher design saved for all counters.");
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Could not save voucher design.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {!editable && (
            <p className="receipt-edit-notice">
              Sign in with the main administrator account to edit this design.
              You can view the saved design here.
            </p>
          )}
          <fieldset className="counter-fields" disabled={!editable || busy}>
            <div className="settings-fields">
              <label>
                <span>Voucher font</span>
                <select
                  value={draft.font}
                  onChange={(event) =>
                    setDraft({ ...draft, font: event.target.value })
                  }
                >
                  {receiptFonts.map((font) => (
                    <option key={font}>{font}</option>
                  ))}
                </select>
              </label>
              {(
                Object.entries(voucherNumberFields) as [NumberKey, string][]
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={draft.numbers[key]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        numbers: {
                          ...draft.numbers,
                          [key]: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
              {flags.map((key, index) => (
                <label key={key} className="voucher-design-toggle">
                  <input
                    type="checkbox"
                    checked={draft.flags[key]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        flags: { ...draft.flags, [key]: event.target.checked },
                      })
                    }
                  />
                  <span>
                    {
                      [
                        "Show Net collected for each passenger",
                        "Show contact details",
                        "Show driver and attendant",
                      ][index]
                    }
                  </span>
                </label>
              ))}
            </div>
            {!valid && (
              <p className="form-error" role="alert">
                Enter positive sizes and line spacing. Padding can be zero.
              </p>
            )}
            <p>
              Saved for both A4 and 80 mm vouchers. Collection totals always
              remain visible.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDraft(designFor(receiptDefaults));
                  setMessage("");
                }}
              >
                Compact defaults
              </button>
              <button
                className="primary-button"
                disabled={!dirty || !valid || busy}
              >
                {busy ? "Saving…" : "Save voucher design"}
              </button>
            </div>
          </fieldset>
          <p role="status">{message}</p>
        </form>
        <aside
          className="voucher-live-preview"
          aria-label="Live voucher preview"
        >
          <div className="voucher-preview-toolbar">
            <strong>Live preview</strong>
            <label>
              Paper
              <select
                value={thermal ? "thermal" : "a4"}
                onChange={(event) =>
                  setThermal(event.target.value === "thermal")
                }
              >
                <option value="thermal">80 mm thermal</option>
                <option value="a4">A4 portrait</option>
              </select>
            </label>
          </div>
          <small>Sample details · changes appear immediately</small>
          <VoucherPreview layout={{ ...layout, ...values }} thermal={thermal} />
        </aside>
      </div>
    </details>
  );
}
