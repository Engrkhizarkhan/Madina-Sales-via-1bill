import { useEffect, useRef, useState } from "react";

export function ConfirmationDialog({ title, children, confirmLabel, passwordRequired = false, onConfirm, onClose }: {
  title: string; children: React.ReactNode; confirmLabel: string; passwordRequired?: boolean;
  onConfirm: (password: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="confirmation-dialog" aria-labelledby="confirmation-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError("");
      try { await onConfirm(password); onClose(); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not complete this action."); }
      finally { setBusy(false); }
    }}>
      <h2 id="confirmation-title">{title}</h2><div>{children}</div>
      {passwordRequired && <label><span>Administrator password</span><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} autoFocus onClick={onClose}>Cancel</button><button type="submit" className="danger-button" disabled={busy}>{busy ? "Please wait…" : confirmLabel}</button></div>
    </form>
  </dialog>;
}
