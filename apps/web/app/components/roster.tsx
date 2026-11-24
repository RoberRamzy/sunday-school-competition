"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, apiResponse, errorText, json, type Grade, type Translate } from "../api";
import { DeleteConfirmation } from "./delete-confirmation";
import { Icon } from "./ui-icon";

type Status = "PENDING_ACTIVATION" | "ACTIVE" | "SUSPENDED";
type Student = { id: string; gradeId: string; fullName: string; displayLabel: string; status: Status };
type StudentName = Pick<Student, "fullName" | "displayLabel">;
const statuses: Status[] = ["PENDING_ACTIVATION", "ACTIVE", "SUSPENDED"];

function statusLabel(status: Status, t: Translate) {
  switch (status) {
    case "ACTIVE": return t("Active", "مفعّل");
    case "SUSPENDED": return t("Suspended", "موقوف");
    case "PENDING_ACTIVATION": return t("Pending activation", "بانتظار التفعيل");
  }
}

export function Roster({ t }: { t: Translate }) {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [editing, setEditing] = useState<Student | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<Student | "handout" | null>(null);
  const [feedback, setFeedback] = useState<"saved" | "downloaded" | "reset" | "imported" | "deleted" | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<Grade[]>("/admin/grades", { signal: controller.signal }).then((grades) => {
      setGrades(grades);
      setGradeId((current) => grades.some((grade) => grade.id === current) ? current : grades[0]?.id || "");
      if (grades.length === 0) setLoading(false);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setLoadError(error);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!gradeId) return;
    const controller = new AbortController();
    api<Student[]>(`/admin/students?gradeId=${encodeURIComponent(gradeId)}`, { signal: controller.signal }).then((students) => {
      setStudents(students);
      setLoading(false);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setLoadError(error);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [gradeId, revision]);

  function clearActions() {
    setEditing(null);
    setImporting(false);
    setConfirm(null);
    setActionError(null);
    setFeedback(null);
  }

  function refresh() {
    setLoadError(null);
    setLoading(true);
    setSelection([]);
    setRevision((value) => value + 1);
  }

  async function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const values = {
      fullName: String(form.get("fullName")).trim(),
      displayLabel: String(form.get("displayLabel")).trim(),
      gradeId: String(form.get("gradeId")),
      ...(editing === "new" ? {} : { status: form.get("status") }),
    };
    setActionError(null);
    setBusy(true);
    try {
      if (editing === "new") await api("/admin/students", json("POST", values));
      else await api(`/admin/students/${editing.id}`, json("PATCH", values));
      setEditing(null);
      setFeedback("saved");
      refresh();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setActionError(null);
    setBusy(true);
    try {
      if (confirm === "handout") {
        const response = await apiResponse(`/admin/grades/${gradeId}/activation-handout`, json("POST", { studentIds: selection }));
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = "activation-handout.xlsx";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setFeedback("downloaded");
      } else {
        await api(`/admin/students/${confirm.id}/reset-pin`, json("POST"));
        setFeedback("reset");
      }
      setConfirm(null);
      refresh();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  const pending = students.filter((student) => student.status === "PENDING_ACTIVATION");
  const allPendingSelected = pending.length > 0 && pending.every((student) => selection.includes(student.id));
  const feedbackCopy = {
    saved: t("Student saved.", "تم حفظ بيانات الطالب."),
    downloaded: t("Handout downloaded. Give each student only their own password.", "تم تنزيل الكشف. أعطِ كل طالب كلمة مروره فقط."),
    reset: t("PIN reset. Select this student to issue a fresh activation handout.", "تمت إعادة ضبط الرمز. حدد الطالب لإصدار كشف تفعيل جديد."),
    imported: t("Roster imported.", "تم استيراد القائمة."),
    deleted: t("Student deleted.", "تم حذف الطالب."),
  };

  return <section aria-labelledby="roster-title">
    <h1 id="roster-title">{t("Student roster", "قائمة الطلاب")}</h1>
    {deleting && <DeleteConfirmation title={t("Delete student", "حذف الطالب")} name={deleting.displayLabel}
      consequence={t("This permanently removes the account, PIN, attempts, and scores, including any published leaderboard entries.", "سيُحذف الحساب والرمز والمحاولات والنتائج نهائيًا، بما فيها النتائج المنشورة في لوحات الترتيب.")}
      path={`/admin/students/${deleting.id}`} t={t} onCancel={() => setDeleting(null)}
      onDeleted={() => { setDeleting(null); setFeedback("deleted"); refresh(); }}/>}
    <p className="subtle">{t("Manage accounts and issue one-time passwords by grade.", "أدر الحسابات وأصدر كلمات مرور لمرة واحدة حسب الصف.")}</p>
    <div className="roster-controls">
      <label>{t("Grade", "الصف الدراسي")}<div className="select-wrap">
        <select value={gradeId} disabled={grades.length === 0 || busy} onChange={(event) => {
          clearActions();
          setStudents([]);
          setSelection([]);
          setLoading(true);
          setLoadError(null);
          setGradeId(event.target.value);
        }}>
          {grades.length === 0 && <option value="">{t("No grades available", "لا توجد صفوف متاحة")}</option>}
          {grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
        </select><Icon name="down" size={16}/></div>
      </label>
      {gradeId && <div className="record-actions">
        <button className="button" type="button" disabled={busy} onClick={() => { clearActions(); setImporting(true); }}>{t("Import roster", "استيراد قائمة")}</button>
        <button className="button primary" type="button" disabled={busy} onClick={() => { clearActions(); setEditing("new"); }}><Icon name="plus" size={18}/>{t("Add student", "إضافة طالب")}</button>
      </div>}
    </div>
    {feedback && <p className="notice success" role="status">{feedbackCopy[feedback]}</p>}
    {actionError ? <p className="notice error" role="alert">{errorText(actionError, t)}</p> : null}
    {editing && <form className="panel" onSubmit={saveStudent} key={editing === "new" ? "new" : editing.id}>
      <h2>{editing === "new" ? t("Add student", "إضافة طالب") : t("Edit student", "تعديل بيانات الطالب")}</h2>
      <div className="form-grid">
        <label>{t("Full name", "الاسم الكامل")}<input name="fullName" required maxLength={150} defaultValue={editing === "new" ? "" : editing.fullName} disabled={busy}/></label>
        <label>{t("Display name", "الاسم المعروض")}<input name="displayLabel" required maxLength={150} defaultValue={editing === "new" ? "" : editing.displayLabel} disabled={busy}/></label>
        <p className="note">{t("Students use the display name to sign in. Give students who share a name distinct labels.", "يستخدم الطلاب الاسم المعروض للدخول. ميّز بين الطلاب الذين يحملون الاسم نفسه.")}</p>
        <label>{t("Grade", "الصف الدراسي")}<div className="select-wrap"><select name="gradeId" defaultValue={editing === "new" ? gradeId : editing.gradeId} disabled={busy}>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select><Icon name="down" size={16}/></div></label>
        {editing !== "new" && <label>{t("Account status", "حالة الحساب")}<div className="select-wrap"><select name="status" defaultValue={editing.status} disabled={busy}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status, t)}</option>)}</select><Icon name="down" size={16}/></div></label>}
        <div className="record-actions">
          <button className="button primary" disabled={busy}>{t("Save student", "حفظ الطالب")}</button>
          <button className="button" type="button" disabled={busy} onClick={clearActions}>{t("Cancel", "إلغاء")}</button>
        </div>
      </div>
    </form>}
    {importing && <ImportRoster gradeId={gradeId} t={t} setParentBusy={setBusy} onCancel={clearActions} onImport={() => {
      setImporting(false);
      setFeedback("imported");
      refresh();
    }}/>}
    {confirm && <div className="panel">
      <h2>{confirm === "handout" ? t("Issue one-time passwords?", "إصدار كلمات مرور لمرة واحدة؟") : t("Reset this PIN?", "إعادة ضبط هذا الرمز؟")}</h2>
      <p className="section-description">{confirm === "handout"
        ? t("The download replaces any previously issued passwords for the selected students.", "يحُل هذا الكشف محل كلمات المرور التي صدرت سابقًا للطلاب المحددين.")
        : <><bdi>{confirm.displayLabel}</bdi>{" · "}{t("This signs the student out and requires them to activate again.", "سيؤدي هذا إلى تسجيل خروج الطالب، وسيحتاج إلى تفعيل حسابه مجددًا.")}</>}</p>
      <div className="record-actions">
        <button className="button primary" type="button" disabled={busy} onClick={confirmAction}>{busy ? t("Please wait…", "يرجى الانتظار…") : confirm === "handout" ? t("Download XLSX", "تنزيل XLSX") : t("Confirm PIN reset", "تأكيد إعادة الضبط")}</button>
        <button className="button" type="button" disabled={busy} onClick={clearActions}>{t("Cancel", "إلغاء")}</button>
      </div>
    </div>}
    {loadError ? <p className="notice error" role="alert">{errorText(loadError, t)}{" "}<button className="link-button" type="button" onClick={refresh}>{t("Try again", "حاول مجددًا")}</button></p>
      : loading ? <p role="status">{t("Loading roster…", "جارٍ تحميل القائمة…")}</p>
      : students.length === 0 ? <p className="panel subtle">{gradeId ? t("There are no students in this grade.", "لا يوجد طلاب في هذا الصف.") : t("There are no grades assigned to your account.", "لا توجد صفوف معيّنة لحسابك.")}</p>
      : <>
        <div className="handout-bar">
          <p className="subtle" aria-live="polite">{t(`${selection.length} selected`, `${selection.length} محدد`)}</p>
          <button type="button" className="button" disabled={selection.length === 0 || busy} onClick={() => { clearActions(); setConfirm("handout"); }}>
            <Icon name="download" size={17}/>{t("Activation handout", "كشف التفعيل")}
          </button>
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Students in selected grade", "طلاب الصف المحدد")}>
          <table className="roster-table">
            <thead><tr>
              <th scope="col"><label className="check-box"><input type="checkbox" aria-label={t("Select all pending students", "تحديد كل الطلاب بانتظار التفعيل")} checked={allPendingSelected} disabled={pending.length === 0 || busy} onChange={(event) => {
                setConfirm(null); setSelection(event.target.checked ? pending.map((student) => student.id) : []);
              }}/></label></th>
              <th scope="col">{t("Student", "الطالب")}</th><th scope="col">{t("Account status", "حالة الحساب")}</th><th scope="col">{t("Actions", "الإجراءات")}</th>
            </tr></thead>
            <tbody>{students.map((student) => <tr key={student.id}>
              <td>{student.status === "PENDING_ACTIVATION" && <label className="check-box"><input type="checkbox" aria-label={t(`Select ${student.displayLabel}`, `تحديد ${student.displayLabel}`)} checked={selection.includes(student.id)} disabled={busy} onChange={(event) => {
                const checked = event.target.checked;
                setConfirm(null); setSelection((current) => checked ? [...current, student.id] : current.filter((id) => id !== student.id));
              }}/></label>}</td>
              <td><strong><bdi>{student.displayLabel}</bdi></strong>{student.fullName !== student.displayLabel && <div className="subtle"><bdi>{student.fullName}</bdi></div>}</td>
              <td><span className="status" data-status={student.status}>{statusLabel(student.status, t)}</span></td>
              <td><div className="record-actions">
                <button type="button" className="link-button" disabled={busy} onClick={() => { clearActions(); setEditing(student); }}>{t("Edit", "تعديل")}</button>
                <button type="button" className="link-button danger-text" disabled={busy} onClick={() => { clearActions(); setDeleting(student); }}>{t("Delete student", "حذف الطالب")}</button>
                {student.status === "ACTIVE" && <button type="button" className="link-button" disabled={busy} onClick={() => { clearActions(); setConfirm(student); }}>{t("Reset PIN", "إعادة ضبط الرمز")}</button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
  </section>;
}

async function readRoster(file: File): Promise<StudentName[]> {
  let rows: string[][];
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    rows = [];
    workbook.worksheets[0]?.eachRow((row) => rows.push([row.getCell(1).text, row.getCell(2).text]));
  } else {
    const { default: Papa } = await import("papaparse");
    const csv = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" });
    if (csv.errors.length > 0) throw new Error("Invalid CSV");
    rows = csv.data;
  }
  const [head, ...body] = rows;
  const normalize = (value = "") => value.trim().toLowerCase().replace(/\s/g, "");
  if (normalize(head?.[0]) !== "fullname" || normalize(head?.[1]) !== "displaylabel" || !body.length) throw new Error("Invalid headers");
  return body.map(([fullName, displayLabel]) => ({ fullName: fullName?.trim() ?? "", displayLabel: displayLabel?.trim() ?? "" }));
}

function ImportRoster({ gradeId, t, setParentBusy, onCancel, onImport }: {
  gradeId: string; t: Translate; setParentBusy: (busy: boolean) => void; onCancel: () => void; onImport: () => void;
}) {
  const [rows, setRows] = useState<StudentName[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [badFile, setBadFile] = useState(false);

  async function send(dryRun: boolean) {
    setBusy(true);
    setParentBusy(true);
    setError(null);
    setBadFile(false);
    try {
      let students = rows;
      if (dryRun && file) {
        try {
          students = await readRoster(file);
        } catch {
          setBadFile(true);
          return;
        }
      }
      await api<{ count: number }>("/admin/students/import", json("POST", { gradeId, students, dryRun }));
      if (dryRun) setRows(students);
      else onImport();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
      setParentBusy(false);
    }
  }

  return <form className="panel form-stack" onSubmit={(event) => {
    event.preventDefault();
    void send(rows.length === 0);
  }}>
    <h2>{t("Import roster", "استيراد قائمة الطلاب")}</h2>
    <p className="note">{t("Upload a CSV or XLSX with fullName and displayLabel as the first two column headers.", "ارفع ملف CSV أو XLSX بعنوانَي fullName وdisplayLabel في أول عمودين.")}</p>
    <label>{t("Roster file", "ملف القائمة")}<input type="file" accept=".csv,.xlsx" required disabled={busy} onChange={(event) => {
      setFile(event.target.files?.[0] ?? null);
      setRows([]);
      setError(null);
      setBadFile(false);
    }}/></label>
    {badFile && <p role="alert" className="notice error">{t("The file could not be read. Check the format and column headers.", "تعذرت قراءة الملف. تحقق من صيغته وعناوين الأعمدة.")}</p>}
    {error ? <p role="alert" className="notice error">{errorText(error, t)}</p> : null}
    {rows.length > 0 && <div>
      <p className="note" role="status">{t(`${rows.length} students validated.`, `تم التحقق من ${rows.length} طالب.`)}</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Roster preview", "معاينة القائمة")}>
        <table className="roster-table"><thead><tr><th scope="col">{t("Full name", "الاسم الكامل")}</th><th scope="col">{t("Display name", "الاسم المعروض")}</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.displayLabel}><td><bdi>{row.fullName}</bdi></td><td><bdi>{row.displayLabel}</bdi></td></tr>)}
        </tbody></table>
      </div>
    </div>}
    <div className="record-actions">
      <button className="button primary" disabled={!file || busy}>{busy ? t("Please wait…", "يرجى الانتظار…") : rows.length ? t("Import students", "استيراد الطلاب") : t("Validate and preview", "التحقق والمعاينة")}</button>
      <button className="button" type="button" disabled={busy} onClick={onCancel}>{t("Cancel", "إلغاء")}</button>
    </div>
  </form>;
}
