"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, json, type Grade, type Language, type Translate } from "../api";
import { displayDate, statusText, type StaffCompetition } from "../competition";
import { CompetitionEditor } from "./competition-editor";
import { DeleteConfirmation } from "./delete-confirmation";
import { AdminLeaderboard } from "./leaderboard";
import { CompetitionMonitor } from "./competition-monitor";
import { Icon } from "./ui-icon";

type Action = "activate" | "close" | "publish" | "archive";

export function StaffCompetitions({ admin, language, t }: { admin: boolean; language: Language; t: Translate }) {
  const [competitions, setCompetitions] = useState<StaffCompetition[] | null>(null);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [detail, setDetail] = useState<StaffCompetition | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<"copied" | "failed" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rows, gradeRows] = await Promise.all([
        api<StaffCompetition[]>("/admin/competitions"),
        api<Grade[]>("/admin/grades"),
      ]);
      setCompetitions(rows);
      setGrades(gradeRows);
    } catch (error) {
      setError(error);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function open(id: string) {
    setError(null);
    setBusy(true);
    try {
      setDetail(await api<StaffCompetition>(`/admin/competitions/${id}`));
      setShowLeaderboard(false);
      setDeleted(false);
      setShareStatus(null);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  function edit() {
    setError(null);
    setEditing(true);
  }

  async function copyCompetitionLink(id: string) {
    try {
      await navigator.clipboard.writeText(new URL(`/competitions/${id}`, window.location.origin).href);
      setShareStatus("copied");
    } catch {
      setShareStatus("failed");
    }
  }

  async function runAction() {
    if (!detail || !action) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/competitions/${detail.id}/${action}`, json("POST"));
      setDetail(await api<StaffCompetition>(`/admin/competitions/${detail.id}`));
      setAction(null);
      await load();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  const actionText: Record<Action, string> = {
    activate: t("Activate competition", "تفعيل المسابقة"),
    close: t("Close competition", "إغلاق المسابقة"),
    publish: t("Publish results", "نشر النتائج"),
    archive: t("Archive competition", "أرشفة المسابقة"),
  };
  const actionHelp: Record<Action, string> = {
    activate: t("Activation freezes the question set and scoring. Students can start when the competition opens.", "يثبّت التفعيل الأسئلة وطريقة التصحيح. يمكن للطلاب البدء عند فتح المسابقة."),
    close: t("Closing ends access and finalizes any outstanding attempts.", "يُنهي الإغلاق الوصول إلى المسابقة ويُتم المحاولات الجارية."),
    publish: t("Students and assigned servants will be able to view their results.", "سيتمكن الطلاب والخدام المعيّنون من الاطلاع على نتائجهم."),
    archive: t("Archiving takes the competition off the available list. Students who attempted it can still see its published results.", "تزيل الأرشفة المسابقة من قائمة المسابقات المتاحة. يمكن لمن شارك الاطلاع على نتائجه المنشورة."),
  };
  const playable = detail?.status === "ACTIVE" || detail?.status === "SCHEDULED" || detail?.status === "OPEN";
  return <section>
    <div className="card-heading"><h1>{t("Competitions", "المسابقات")}</h1>
      {!detail && !editing && admin && <button className="button primary" disabled={busy} type="button" onClick={edit}><Icon name="plus" size={17}/>{t("Create competition", "إنشاء مسابقة")}</button>}
    </div>
    <p className="subtle section-description">{admin ? t("Set up competitions, monitor attempts, and publish results.", "أعد المسابقات وتابع المحاولات وانشر النتائج.") : t("Monitor participation and see published results for your grades.", "تابع المشاركة والنتائج المنشورة لصفوفك.")}</p>
    {deleted && <p className="notice success" role="status">{t("Competition deleted.", "تم حذف المسابقة.")}</p>}
    {admin && detail && deleting && <DeleteConfirmation title={t("Delete competition", "حذف المسابقة")} name={detail.title}
      consequence={t("This permanently removes the competition, all attempts and scores, and its public leaderboards.", "سيتم حذف المسابقة وجميع المحاولات والنتائج ولوحات الترتيب العامة نهائيًا.")}
      path={`/admin/competitions/${detail.id}`} t={t} onCancel={() => setDeleting(false)} onDeleted={() => {
        setCompetitions(rows => rows?.filter(row => row.id !== detail.id) ?? null);
        setDeleting(false); setDetail(null); setAction(null); setShowLeaderboard(false); setDeleted(true);
      }}/>}
    {error ? <p role="alert" className="notice error">{errorText(error, t)}{" "}{!competitions && <button className="link-button" type="button" onClick={load}>{t("Try again", "حاول مجددًا")}</button>}</p> : null}
    {editing ? <CompetitionEditor competition={detail} grades={grades} t={t} onCancel={() => setEditing(false)} onSave={(saved) => {
      setEditing(false); void open(saved.id); void load();
    }}/> : detail ? <>
      <button className="link-button" type="button" disabled={busy} onClick={() => { setDetail(null); setAction(null); setError(null); void load(); }}>{t("All competitions", "كل المسابقات")}</button>
      <article className="panel competition-card">
        <div className="card-heading"><h2 dir="auto">{detail.title}</h2><span className="status" data-status={detail.status}>{statusText(detail.status, t)}</span></div>
        {detail.description && <p className="preserve-lines" dir="auto">{detail.description}</p>}
        {detail.instructions && <p className="preserve-lines subtle" dir="auto">{detail.instructions}</p>}
        <p className="competition-facts"><span><Icon name="calendar" size={17}/><bdi>{displayDate(detail.opensAt, language)} – {displayDate(detail.closesAt, language)}</bdi></span><span><Icon name="clock" size={17}/>{t(`${detail.durationMinutes} min`, `${detail.durationMinutes} دقيقة`)}</span></p>
        {detail.status !== "DRAFT" && <div className="record-actions">
          <button className="button" type="button" onClick={() => copyCompetitionLink(detail.id)}>{t("Copy competition link", "نسخ رابط المسابقة")}</button>
          <Link className="link-button" href={`/competitions/${detail.id}`} prefetch={false}>{t("Student competition link", "رابط المسابقة للطلاب")}</Link>
          {shareStatus && <span className="note" role="status">{shareStatus === "copied" ? t("Link copied.", "تم نسخ الرابط.") : t("Copy the address from the student competition link.", "انسخ العنوان من رابط المسابقة للطلاب.")}</span>}
        </div>}
        {admin && <div className="record-actions">
          {detail.status === "DRAFT" && <button className="button" type="button" disabled={busy} onClick={edit}>{t("Edit draft", "تعديل المسودة")}</button>}
          {detail.status === "DRAFT" && <button className="button primary" type="button" disabled={busy} onClick={() => setAction("activate")}>{actionText.activate}</button>}
          {playable && <button className="button" type="button" disabled={busy} onClick={() => setAction("close")}>{actionText.close}</button>}
          {(detail.status === "CLOSED" || detail.status === "ARCHIVED") && !detail.publishedAt && <button className="button primary" type="button" disabled={busy} onClick={() => setAction("publish")}>{actionText.publish}</button>}
          {detail.status === "CLOSED" && <button className="button" type="button" disabled={busy} onClick={() => setAction("archive")}>{actionText.archive}</button>}
          <button className="button danger" type="button" disabled={busy} onClick={() => setDeleting(true)}>{t("Delete competition", "حذف المسابقة")}</button>
          {detail.publishedAt && <span className="status" data-status="ACTIVE">{t("Published", "منشورة")}</span>}
        </div>}
        {action && <div className="submit-confirm">
          <p>{actionHelp[action]}</p>
          <div className="record-actions">
            <button className="button primary" type="button" disabled={busy} onClick={runAction}>{busy ? t("Please wait…", "يرجى الانتظار…") : t("Confirm", "تأكيد")}</button>
            <button className="button" type="button" disabled={busy} onClick={() => setAction(null)}>{t("Cancel", "إلغاء")}</button>
          </div>
        </div>}
      </article>
      {(admin || detail.status !== "DRAFT") && <>
        {admin && <nav className="record-actions" aria-label={t("Competition dashboard", "لوحة المسابقة")}>
          {detail.status !== "DRAFT" && <button className="button" type="button" aria-pressed={!showLeaderboard} onClick={() => setShowLeaderboard(false)}>{t("Monitoring and results", "المتابعة والنتائج")}</button>}
          <button className="button" type="button" aria-pressed={showLeaderboard} onClick={() => setShowLeaderboard(true)}>{t("Leaderboards", "لوحات الترتيب")}</button>
        </nav>}
        {admin && showLeaderboard ? <AdminLeaderboard key={detail.id} id={detail.id} t={t}/> :
          <>{detail.status !== "DRAFT" && <CompetitionMonitor key={detail.id} competition={detail} grades={grades} admin={admin} language={language} t={t}/>}</>}
      </>}
    </> : competitions === null ? !error && <p role="status">{t("Loading competitions…", "جارٍ تحميل المسابقات…")}</p>
    : competitions.length ? <div className="competition-list">{competitions.map((item) => <article className="panel competition-card" key={item.id}>
      <div className="card-heading"><h2 dir="auto">{item.title}</h2><span className="status" data-status={item.status}>{statusText(item.status, t)}</span></div>
      <p className="subtle"><bdi>{displayDate(item.opensAt, language)} – {displayDate(item.closesAt, language)}</bdi></p>
      <div><button type="button" className="button" disabled={busy} onClick={() => open(item.id)}>{t("Open competition", "عرض المسابقة")}<span className="directional"><Icon name="arrow" size={17}/></span></button></div>
    </article>)}</div> : <p className="panel subtle">{t("There are no competitions to show yet.", "لا توجد مسابقات لعرضها بعد.")}</p>}
  </section>;
}
