"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, apiResponse, errorText, json, type Grade, type Language, type Translate } from "../api";
import { displayDate, statusText, type StaffCompetition } from "../competition";
import { Icon } from "./ui-icon";

type StudentRow = { studentId: string; displayLabel: string; gradeId: string; attemptId: string | null; status: string; score: number | null; maxScore: number | null; rank?: number | null };
type Monitoring = { counts: { notStarted: number; inProgress: number; completed: number; timedOut: number }; students: StudentRow[] };
type AuditEvent = { id?: string; eventType: string; createdAt: string; metadataJson?: { reason?: string } };
type AttemptReview = {
  id: string; status: string; startedAt: string | null; expiresAt: string | null;
  finishedAt: string | null; submittedAt: string | null; auditEvents?: AuditEvent[]; events?: AuditEvent[];
};
type View = "monitoring" | "results";

export function CompetitionMonitor({ competition, grades, admin, language, t }: {
  competition: StaffCompetition; grades: Grade[]; admin: boolean; language: Language; t: Translate;
}) {
  const [view, setView] = useState<View>("monitoring");
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [counts, setCounts] = useState<Monitoring["counts"] | null>(null);
  const [gradeId, setGradeId] = useState("");
  const [review, setReview] = useState<{ student: StudentRow; attempt: AttemptReview } | null>(null);
  const [action, setAction] = useState<"flag" | "authorize-replacement" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (mode: View, signal?: AbortSignal) => {
    const path = `/admin/competitions/${competition.id}/${mode}`;
    setError(null);
    try {
      if (mode === "monitoring") {
        const next = await api<Monitoring>(path, { signal });
        setRows(next.students);
        setCounts(next.counts);
      } else {
        const next = await api<StudentRow[] | { students: StudentRow[] }>(path, { signal });
        setRows(Array.isArray(next) ? next : next.students);
        setCounts(null);
      }
    } catch (error) {
      if (!signal?.aborted) setError(error);
    }
  }, [competition.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(view, controller.signal);
    return () => controller.abort();
  }, [view, load]);

  async function inspect(student: StudentRow) {
    if (!student.attemptId) return;
    setBusy(true);
    setAction(null);
    setSaved(false);
    setError(null);
    try {
      const attempt = await api<AttemptReview>(`/admin/attempts/${student.attemptId}`);
      setReview({ student, attempt });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || !action) return;
    const reason = String(new FormData(event.currentTarget).get("reason")).trim();
    if (!reason) return;
    setError(null);
    setBusy(true);
    try {
      await api(`/admin/attempts/${review.attempt.id}/${action}`, json("POST", { reason }));
      setSaved(true);
      setAction(null);
      await load(view);
      setReview(null);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function download(format: "csv" | "xlsx") {
    setBusy(true);
    setError(null);
    try {
      const response = await apiResponse(`/admin/competitions/${competition.id}/results/export?format=${format}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `competition-results.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  const events = review?.attempt.auditEvents ?? review?.attempt.events ?? [];
  const visible = (rows ?? []).filter((student) => !gradeId || student.gradeId === gradeId);
  const summary = counts ? [
    [t("Not started", "لم تبدأ"), counts.notStarted],
    [t("In progress", "قيد التنفيذ"), counts.inProgress],
    [t("Completed", "اكتملت"), counts.completed],
    [t("Timed out", "انتهى الوقت"), counts.timedOut],
  ] as const : [];
  return <section className="monitor-section">
    <div className="record-actions">
      {(["monitoring", "results"] as const).map((value) => <button type="button" className={view === value ? "button primary" : "button"} aria-pressed={view === value} key={value} disabled={busy || (value === "results" && !admin && !competition.publishedAt)} onClick={() => {
        if (value !== view) {
          setRows(null);
          setCounts(null);
          setReview(null);
          setSaved(false);
          setView(value);
        }
      }}>{value === "monitoring" ? t("Participation", "المشاركة") : t("Results", "النتائج")}</button>)}
      <button type="button" className="button" disabled={busy} onClick={() => load(view)}>{t("Refresh", "تحديث")}</button>
    </div>
    {view === "results" && <>
      <p className="note">{competition.publishedAt ? t("Published results", "النتائج المنشورة") : t("Preview. Students can see results after publication.", "معاينة. يستطيع الطلاب رؤية النتائج بعد النشر.")}</p>
      <div className="record-actions">
        {(["csv", "xlsx"] as const).map((format) => <button className="button" type="button" disabled={busy} key={format} onClick={() => download(format)}><Icon name="download" size={17}/>{t("Export", "تصدير")} {format.toUpperCase()}</button>)}
      </div>
    </>}
    {error ? <p className="notice error" role="alert">{errorText(error, t)}</p> : null}
    {saved && <p className="notice success" role="status">{t("Attempt action recorded.", "تم تسجيل الإجراء على المحاولة.")}</p>}
    {counts && <dl className="participation-summary">{summary.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>}
    {rows === null ? !error && <p role="status">{t("Loading competition records…", "جارٍ تحميل سجلات المسابقة…")}</p> : <>
      <label>{t("Grade", "الصف الدراسي")}<select value={gradeId} onChange={(event) => { setGradeId(event.target.value); setReview(null); }}>
        <option value="">{t("All visible grades", "كل الصفوف المتاحة")}</option>
        {grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
      </select></label>
      {visible.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Competition students", "طلاب المسابقة")}>
        <table className="roster-table data-table"><thead><tr>
          <th scope="col">{t("Student", "الطالب")}</th><th scope="col">{t("Grade", "الصف الدراسي")}</th><th scope="col">{t("Status", "الحالة")}</th>
          {(view === "results" || admin) && <th scope="col">{t("Score", "الدرجة")}</th>}{view === "results" && <th scope="col">{t("Rank", "الترتيب")}</th>}
          <th scope="col">{t("Attempt", "المحاولة")}</th>
        </tr></thead><tbody>
          {visible.map((row) => <tr key={row.studentId}>
            <td><bdi>{row.displayLabel}</bdi></td><td>{grades.find(({ id }) => id === row.gradeId)?.name ?? "—"}</td><td>{statusText(row.status, t)}</td>
            {(view === "results" || admin) && <td>{row.score === null || row.score === undefined ? "—" : <bdi>{row.score} / {row.maxScore}</bdi>}</td>}
            {view === "results" && <td>{row.rank ?? "—"}</td>}
            <td>{row.attemptId && <button className="link-button" type="button" disabled={busy} onClick={() => inspect(row)}>{t("Review", "مراجعة")}</button>}</td>
          </tr>)}
        </tbody></table>
      </div> : <p className="panel subtle">{t("There are no records for this selection.", "لا توجد سجلات لهذا الاختيار.")}</p>}
    </>}
    {review && <div className="panel form-stack">
      <h3><bdi>{review.student.displayLabel}</bdi></h3>
      <p>{statusText(review.attempt.status, t)}</p>
      <dl className="review-dates">
        <div><dt>{t("Started", "بدأت")}</dt><dd>{displayDate(review.attempt.startedAt, language)}</dd></div>
        <div><dt>{t("Deadline", "وقت الانتهاء")}</dt><dd>{displayDate(review.attempt.expiresAt, language)}</dd></div>
        <div><dt>{t("Finished", "اكتملت")}</dt><dd>{displayDate(review.attempt.finishedAt ?? review.attempt.submittedAt, language)}</dd></div>
      </dl>
      <h4>{t("Audit events", "سجل الأحداث")}</h4>
      {events.length ? <ul className="audit-events">{events.map((event, index) => <li key={event.id ?? index}>
        <bdi>{event.eventType}</bdi> · <bdi>{displayDate(event.createdAt, language)}</bdi>
        {event.metadataJson?.reason && <p className="note" dir="auto">{event.metadataJson.reason}</p>}
      </li>)}</ul> : <p className="note">{t("No audit events to display.", "لا توجد أحداث لعرضها.")}</p>}
      {action && <form className="form-stack" onSubmit={save}>
        <label>{t("Reason", "السبب")}<textarea name="reason" required maxLength={500} rows={3} dir="auto" disabled={busy}/></label>
        <div className="record-actions">
          <button className="button primary" disabled={busy}>{action === "flag" ? t("Save flag", "حفظ التنبيه") : t("Confirm replacement", "تأكيد المحاولة البديلة")}</button>
          <button className="button" type="button" disabled={busy} onClick={() => setAction(null)}>{t("Cancel", "إلغاء")}</button>
        </div>
      </form>}
      {!action && <div className="record-actions">
        <button className="button" type="button" disabled={busy} onClick={() => setAction("flag")}>{t("Flag attempt", "وضع تنبيه على المحاولة")}</button>
        {admin && ["IN_PROGRESS", "SUBMITTED", "TIMED_OUT"].includes(review.attempt.status) && <button className="button" type="button" disabled={busy} onClick={() => setAction("authorize-replacement")}>{t("Authorize replacement", "السماح بمحاولة بديلة")}</button>}
        <button className="button" type="button" disabled={busy} onClick={() => setReview(null)}>{t("Close review", "إغلاق المراجعة")}</button>
      </div>}
    </div>}
  </section>;
}
