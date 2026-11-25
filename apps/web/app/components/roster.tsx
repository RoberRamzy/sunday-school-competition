"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
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
  const [feedback, setFeedback] = useState<"saved" | "moved" | "downloaded" | "reset" | "imported" | "deleted" | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [savedStudentId, setSavedStudentId] = useState<string | null>(null);
  const editorId = useId();
  const gradeFilter = useRef<HTMLSelectElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreEditFocus = useRef(false);

  useLayoutEffect(() => {
    if (editing || busy || !restoreEditFocus.current) return;
    restoreEditFocus.current = false;
    const target = editTrigger.current?.isConnected ? editTrigger.current : table.current ?? gradeFilter.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [editing, busy]);

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
    setSavedStudentId(null);
  }

  function cancelEdit() {
    restoreEditFocus.current = editing !== "new";
    clearActions();
  }

  function refresh() {
    setLoadError(null);
    setLoading(true);
    setSelection([]);
    setRevision((value) => value + 1);
  }

  async function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const form = new FormData(event.currentTarget);
    const status = form.get("status");
    const values = {
      fullName: String(form.get("fullName")).trim(),
      displayLabel: String(form.get("displayLabel")).trim(),
      gradeId: String(form.get("gradeId")),
      ...(editing !== "new" && status !== editing.status ? { status } : {}),
    };
    setActionError(null);
    setBusy(true);
    try {
      if (editing === "new") {
        await api("/admin/students", json("POST", values));
        setFeedback("saved");
        refresh();
      } else {
        const saved = await api<Student>(`/admin/students/${editing.id}`, json("PATCH", values));
        const moved = saved.gradeId !== gradeId;
        setStudents((current) => moved ? current.filter((student) => student.id !== saved.id)
          : current.map((student) => student.id === saved.id ? saved : student));
        if (moved || saved.status !== "PENDING_ACTIVATION") setSelection((current) => current.filter((id) => id !== saved.id));
        if (moved) setFeedback("moved");
        else setSavedStudentId(saved.id);
        restoreEditFocus.current = true;
      }
      setEditing(null);
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
    moved: t("Student moved to the selected grade.", "تم نقل الطالب إلى الصف المحدد."),
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
        <select ref={gradeFilter} value={gradeId} disabled={grades.length === 0 || busy} onChange={(event) => {
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
    {!editing && actionError ? <p className="notice error" role="alert">{errorText(actionError, t)}</p> : null}
    {editing === "new" && <StudentForm id={editorId} grades={grades} gradeId={gradeId} t={t} busy={busy}
      error={actionError} onSave={saveStudent} onCancel={cancelEdit}/>}
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
        <div ref={table} className="table-wrap" tabIndex={0} role="region" aria-label={t("Students in selected grade", "طلاب الصف المحدد")}>
          <table className="roster-table student-roster-table">
            <thead><tr>
              <th scope="col"><label className="check-box"><input type="checkbox" aria-label={t("Select all pending students", "تحديد كل الطلاب بانتظار التفعيل")} checked={allPendingSelected} disabled={pending.length === 0 || busy} onChange={(event) => {
                setConfirm(null); setSelection(event.target.checked ? pending.map((student) => student.id) : []);
              }}/></label></th>
              <th scope="col">{t("Student", "الطالب")}</th><th scope="col">{t("Account status", "حالة الحساب")}</th><th scope="col">{t("Actions", "الإجراءات")}</th>
            </tr></thead>
            <tbody>{students.map((student) => {
              const expanded = editing !== "new" && editing?.id === student.id;
              return <Fragment key={student.id}>
                <tr className={expanded ? "student-row-expanded" : undefined}>
                  <td>{student.status === "PENDING_ACTIVATION" && <label className="check-box"><input type="checkbox" aria-label={t(`Select ${student.displayLabel}`, `تحديد ${student.displayLabel}`)} checked={selection.includes(student.id)} disabled={busy} onChange={(event) => {
                    const checked = event.target.checked;
                    setConfirm(null); setSelection((current) => checked ? [...current, student.id] : current.filter((id) => id !== student.id));
                  }}/></label>}</td>
                  <td><strong><bdi>{student.displayLabel}</bdi></strong>{student.fullName !== student.displayLabel && <div className="subtle"><bdi>{student.fullName}</bdi></div>}
                    {savedStudentId === student.id && <small className="student-row-saved" role="status">{feedbackCopy.saved}</small>}</td>
                  <td><span className="status" data-status={student.status}>{statusLabel(student.status, t)}</span></td>
                  <td><div className="record-actions">
                    <button type="button" className="link-button" disabled={busy} aria-expanded={expanded} aria-controls={expanded ? editorId : undefined}
                      onClick={(event) => {
                        if (expanded) { cancelEdit(); return; }
                        editTrigger.current = event.currentTarget;
                        clearActions();
                        setEditing(student);
                      }}>{t("Edit", "تعديل")}</button>
                    <button type="button" className="link-button danger-text" disabled={busy} onClick={() => { clearActions(); setDeleting(student); }}>{t("Delete student", "حذف الطالب")}</button>
                    {student.status === "ACTIVE" && <button type="button" className="link-button" disabled={busy} onClick={() => { clearActions(); setConfirm(student); }}>{t("Reset PIN", "إعادة ضبط الرمز")}</button>}
                  </div></td>
                </tr>
                {expanded && <tr className="student-edit-row"><td colSpan={4}>
                    <StudentForm key={student.id} id={editorId} student={student} grades={grades} gradeId={gradeId} t={t}
                      busy={busy} error={actionError} onSave={saveStudent} onCancel={cancelEdit}/>
                </td></tr>}
              </Fragment>;
            })}</tbody>
          </table>
        </div>
      </>}
  </section>;
}

function StudentForm({ id, student, grades, gradeId, t, busy, error, onSave, onCancel }: {
  id: string; student?: Student; grades: Grade[]; gradeId: string; t: Translate; busy: boolean; error: unknown;
  onSave: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  const fullName = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!student) return;
    fullName.current?.focus({ preventScroll: true });
    fullName.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [student]);

  return <form id={id} className={student ? "student-edit-form" : "panel"} aria-labelledby={`${id}-heading`} onSubmit={onSave}
    onKeyDown={(event) => {
      if (student && !busy && event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) {
        event.preventDefault();
        onCancel();
      }
    }}>
    <h2 id={`${id}-heading`}>{student ? t("Edit student", "تعديل بيانات الطالب") : t("Add student", "إضافة طالب")}</h2>
    {error ? <p className="notice error" role="alert">{errorText(error, t)}</p> : null}
    <div className="form-grid">
      <label>{t("Full name", "الاسم الكامل")}<input ref={fullName} name="fullName" dir="auto" required maxLength={150} defaultValue={student?.fullName ?? ""} disabled={busy}/></label>
      <label>{t("Display name", "الاسم المعروض")}<input name="displayLabel" dir="auto" required maxLength={150} defaultValue={student?.displayLabel ?? ""} disabled={busy}/></label>
      <p className="note">{t("Students use the display name to sign in. Give students who share a name distinct labels.", "يستخدم الطلاب الاسم المعروض للدخول. ميّز بين الطلاب الذين يحملون الاسم نفسه.")}</p>
      <label>{t("Grade", "الصف الدراسي")}<div className="select-wrap"><select name="gradeId" defaultValue={student?.gradeId ?? gradeId} disabled={busy}>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select><Icon name="down" size={16}/></div></label>
      {student && <label>{t("Account status", "حالة الحساب")}<div className="select-wrap"><select name="status" defaultValue={student.status} disabled={busy}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status, t)}</option>)}</select><Icon name="down" size={16}/></div></label>}
      <div className="record-actions">
        <button className="button primary" disabled={busy}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Save student", "حفظ الطالب")}</button>
        <button className="button" type="button" disabled={busy} onClick={onCancel}>{t("Cancel", "إلغاء")}</button>
      </div>
    </div>
  </form>;
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
