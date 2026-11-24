"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText, json, type Translate } from "../api";

export function DeleteConfirmation({ title, name, consequence, path, t, onCancel, onDeleted }: {
  title: string;
  name: string;
  consequence: string;
  path: string;
  t: Translate;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || confirmation !== "DELETE") return;
    setBusy(true);
    setError(null);
    try {
      await api(path, json("DELETE", { confirmation }));
      onDeleted();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="panel delete-dialog" aria-labelledby="delete-heading" onCancel={event => {
    event.preventDefault();
    if (!busy) onCancel();
  }}>
    <form className="form-stack" onSubmit={remove}>
      <h2 id="delete-heading">{title}</h2>
      <p><strong><bdi>{name}</bdi></strong></p>
      <p>{consequence}</p>
      <label>{t("Type DELETE to confirm", "اكتب DELETE للتأكيد")}
        <input dir="ltr" autoComplete="off" autoFocus value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)}/>
      </label>
      {error ? <p className="notice error" role="alert">{errorText(error, t)}</p> : null}
      <div className="record-actions">
        <button type="button" className="button" disabled={busy} onClick={onCancel}>{t("Cancel", "إلغاء")}</button>
        <button type="submit" className="button danger" disabled={busy || confirmation !== "DELETE"}>
          {busy ? t("Deleting…", "جارٍ الحذف…") : t("Delete permanently", "احذف نهائيًا")}
        </button>
      </div>
    </form>
  </dialog>;
}
