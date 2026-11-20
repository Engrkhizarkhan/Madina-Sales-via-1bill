import { useEffect, useRef, useState } from "react";
import {
  boardingTextFields,
  boardingNumberFields,
  boardingFlags,
  receiptDefaults,
  receiptFonts,
  type ReceiptLayout,
} from "../shared/receipt-layout.mjs";
import { useReceiptSettings } from "./receipt-settings";
import { BoardingPass, type BoardingPassData } from "./boarding-pass";
type NumberKey = keyof typeof boardingNumberFields;
type TextKey = keyof typeof boardingTextFields;
type FlagKey = keyof typeof boardingFlags;
const zeroAllowed = new Set([
  "boardingPaddingX",
  "boardingPaddingY",
  "boardingRowPadding",
  "boardingBorderWidth",
]);
function designFor(layout: ReceiptLayout) {
  return {
    font: layout.boardingFont,
    headerLayout: layout.boardingHeaderLayout,
    headerAlign: layout.boardingHeaderAlign,
    valueAlign: layout.boardingValueAlign,
    noteAlign: layout.boardingNoteAlign,
    texts: Object.fromEntries(
      Object.keys(boardingTextFields).map((key) => [
        key,
        layout[key as TextKey],
      ]),
    ) as Record<TextKey, string>,
    numbers: Object.fromEntries(
      Object.keys(boardingNumberFields).map((key) => [
        key,
        String(layout[key as NumberKey]),
      ]),
    ) as Record<NumberKey, string>,
    flags: Object.fromEntries(
      Object.keys(boardingFlags).map((key) => [key, layout[key as FlagKey]]),
    ) as Record<FlagKey, boolean>,
  };
}
function valuesFor(
  draft: ReturnType<typeof designFor>,
  fallback: ReceiptLayout,
) {
  const values: Partial<ReceiptLayout> = {
    ...draft.texts,
    ...draft.flags,
    boardingFont: draft.font,
    boardingHeaderLayout: draft.headerLayout,
    boardingHeaderAlign: draft.headerAlign,
    boardingValueAlign: draft.valueAlign,
    boardingNoteAlign: draft.noteAlign,
  };
  let valid = Boolean(draft.texts.tokenTitle.trim());
  for (const key of Object.keys(boardingNumberFields) as NumberKey[]) {
    const raw = draft.numbers[key],
      value = Number(raw),
      ok =
        raw.trim() !== "" &&
        Number.isFinite(value) &&
        (zeroAllowed.has(key) ? value >= 0 : value > 0);
    if (!ok) valid = false;
    values[key] = ok ? value : fallback[key];
  }
  return { values, valid };
}
const sample: BoardingPassData = {
  seats: "4",
  bus: "ME-123",
  destination: "D. I. Khan",
  date: "20-Nov-26",
  time: "19:00",
  ticket: "ME-000001",
  paid: "PKR 2,200",
  seller: "Account full name",
};
function BoardingPreview({ layout }: { layout: ReceiptLayout }) {
  const host = useRef<HTMLDivElement>(null),
    paper = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ scale: 1, height: 0 });
  useEffect(() => {
    if (!host.current || !paper.current) return;
    const measure = () => {
      const scale = Math.min(
          1,
          Math.max(1, host.current!.clientWidth - 24) /
            Math.max(1, paper.current!.offsetWidth),
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
  }, []);
  return (
    <div ref={host} className="voucher-preview-viewport">
      <div style={{ height: size.height || undefined }}>
        <div
          className="voucher-preview-paper"
          style={{ transform: `scale(${size.scale})` }}
        >
          <div
            ref={paper}
            className="receipt thermal-ticket boarding-design-preview"
          >
            <BoardingPass layout={layout} data={sample} />
          </div>
        </div>
      </div>
    </div>
  );
}
export default function BoardingDesignEditor({
  editable,
}: {
  editable: boolean;
}) {
  const { layout, save } = useReceiptSettings(),
    [draft, setDraft] = useState(() => designFor(layout)),
    previous = useRef(layout),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    setDraft((current) =>
      JSON.stringify(current) === JSON.stringify(designFor(previous.current))
        ? designFor(layout)
        : current,
    );
    previous.current = layout;
  }, [layout]);
  const { values, valid } = valuesFor(draft, layout),
    dirty = JSON.stringify(draft) !== JSON.stringify(designFor(layout));
  const textField = (key: TextKey) => (
    <label key={key} className={key === "tokenNote" ? "span-2" : undefined}>
      <span>{boardingTextFields[key]}</span>
      {key === "tokenNote" ? (
        <textarea
          lang="ur"
          dir="rtl"
          value={draft.texts[key]}
          onChange={(e) =>
            setDraft({
              ...draft,
              texts: { ...draft.texts, [key]: e.target.value },
            })
          }
        />
      ) : (
        <input
          required={key === "tokenTitle"}
          value={draft.texts[key]}
          onChange={(e) =>
            setDraft({
              ...draft,
              texts: { ...draft.texts, [key]: e.target.value },
            })
          }
        />
      )}
    </label>
  );
  return (
    <details className="receipt-editor boarding-design-editor">
      <summary>Edit boarding pass design</summary>
      <div className="receipt-design-workspace">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid || busy) return;
            setBusy(true);
            setMessage("");
            try {
              await save(values);
              setDraft(designFor({ ...layout, ...values }));
              setMessage("Boarding pass design saved for all counters.");
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Could not save boarding pass design.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {!editable && (
            <p className="receipt-edit-notice">
              Sign in with the main administrator account to edit this design.
            </p>
          )}
          <fieldset className="counter-fields" disabled={!editable || busy}>
            <h3>Boarding pass text</h3>
            <div className="settings-fields">
              {(
                ["boardingBusinessName", "tokenTitle", "tokenNote"] as TextKey[]
              ).map(textField)}
            </div>
            <details className="boarding-label-editor">
              <summary>Edit field labels</summary>
              <div className="settings-fields">
                {(Object.keys(boardingTextFields) as TextKey[])
                  .filter(
                    (key) =>
                      ![
                        "boardingBusinessName",
                        "tokenTitle",
                        "tokenNote",
                      ].includes(key),
                  )
                  .map(textField)}
              </div>
            </details>
            <h3>Font, sizes & spacing</h3>
            <div className="settings-fields">
              <label>
                <span>Boarding pass font</span>
                <select
                  value={draft.font}
                  onChange={(e) => setDraft({ ...draft, font: e.target.value })}
                >
                  {receiptFonts.map((font) => (
                    <option key={font}>{font}</option>
                  ))}
                </select>
              </label>
              {(
                Object.entries(boardingNumberFields) as [NumberKey, string][]
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    required
                    step="any"
                    value={draft.numbers[key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        numbers: { ...draft.numbers, [key]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <h3>Layout & visible details</h3>
            <div className="settings-fields">
              <label>
                <span>Header layout</span>
                <select
                  value={draft.headerLayout}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      headerLayout: e.target
                        .value as ReceiptLayout["boardingHeaderLayout"],
                    })
                  }
                >
                  <option value="row">Side by side</option>
                  <option value="stacked">Stacked</option>
                </select>
              </label>
              {(["headerAlign", "valueAlign", "noteAlign"] as const).map(
                (key) => (
                  <label key={key}>
                    <span>
                      {key === "headerAlign"
                        ? "Stacked header alignment"
                        : key === "valueAlign"
                          ? "Field value alignment"
                          : "Urdu note alignment"}
                    </span>
                    <select
                      value={draft[key]}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    >
                      {["left", "center", "right"].map((value) => (
                        <option key={value} value={value}>
                          {value[0].toUpperCase() + value.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )}
              {(Object.entries(boardingFlags) as [FlagKey, string][]).map(
                ([key, label]) => (
                  <label key={key} className="voucher-design-toggle">
                    <input
                      type="checkbox"
                      checked={draft.flags[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          flags: { ...draft.flags, [key]: e.target.checked },
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ),
              )}
            </div>
            {!valid && (
              <p className="form-error" role="alert">
                Enter a pass title and positive sizes. Padding and border width
                can be zero.
              </p>
            )}
            <p>
              Only changes the boarding pass. Passenger receipt and voucher
              designs are saved separately.
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
                Boarding pass defaults
              </button>
              <button
                className="primary-button"
                disabled={!dirty || !valid || busy}
              >
                {busy ? "Saving…" : "Save boarding pass design"}
              </button>
            </div>
          </fieldset>
          <p role="status">{message}</p>
        </form>
        <aside
          className="voucher-live-preview"
          aria-label="Live boarding pass preview"
        >
          <strong>Live boarding pass preview</strong>
          <p>
            <small>
              80 mm paper · sample details · changes appear immediately
            </small>
          </p>
          <BoardingPreview layout={{ ...layout, ...values }} />
        </aside>
      </div>
    </details>
  );
}
