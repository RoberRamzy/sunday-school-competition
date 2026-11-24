"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api, errorText, json, type Language, type Theme, type Translate } from "../api";
import { ChristmasLights, SiteBrand } from "./site-brand";
import { Icon } from "./ui-icon";

type Row = { rank: number; name: string; grade: string; score: number; maxScore: number };
type Board = { scope: string; name: string | null; rows: Row[] };
type PublicBoards = { title: string; boards: Board[] };
type TiePolicy = "SCORE_THEN_TIME" | "SCORE_ONLY";
type StaffBoards = {
  tiePolicy: TiePolicy; status: string; scopes: string[]; boards: Board[]; publication: PublicBoards;
  overallAvailable: boolean; published: boolean; revision: string;
};

function boardName(board: Board, t: Translate) {
  return board.name ?? t("Overall", "جميع الصفوف");
}

function BoardView({ boards, t }: { boards: Board[]; t: Translate }) {
  const [scope, setScope] = useState("");
  const selected = boards.find(board => board.scope === scope) ?? boards[0];
  if (!selected) return <p className="note">{t("No boards selected.", "لم تُحدَّد أي لوحة.")}</p>;
  return <div className="form-stack">
    {boards.length > 1 && <nav className="record-actions" aria-label={t("Leaderboard scope", "نطاق لوحة الترتيب")}>
      {boards.map(board => <button key={board.scope} className="button" type="button" aria-pressed={board.scope === selected.scope} onClick={() => setScope(board.scope)}>{boardName(board, t)}</button>)}
    </nav>}
    <h3>{boardName(selected, t)}</h3>
    {selected.rows.length === 0 ? <p className="note">{t("No completed attempts yet.", "لا توجد محاولات مكتملة بعد.")}</p>
      : <div className="table-wrap" role="region" tabIndex={0} aria-label={boardName(selected, t)}>
        <table className="roster-table data-table">
          <thead><tr>
            <th scope="col">{t("Rank", "الترتيب")}</th>
            <th scope="col">{t("Full name", "الاسم الكامل")}</th>
            <th scope="col">{t("Grade", "الصف")}</th>
            <th scope="col">{t("Score", "النتيجة")}</th>
          </tr></thead>
          <tbody>{selected.rows.map((row, index) => <tr key={index}>
            <td>{row.rank}</td>
            <td className="leaderboard-name"><bdi>{row.name}</bdi></td>
            <td><bdi>{row.grade}</bdi></td>
            <td><bdi>{row.score} / {row.maxScore}</bdi></td>
          </tr>)}</tbody>
        </table>
      </div>}
  </div>;
}

export function AdminLeaderboard({ id, t }: { id: string; t: Translate }) {
  const path = `/admin/competitions/${id}/leaderboard`;
  const [view, setView] = useState<StaffBoards | null>(null);
  const [tiePolicy, setTiePolicy] = useState<TiePolicy>("SCORE_THEN_TIME");
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function adopt(next: StaffBoards) {
    setView(next);
    setTiePolicy(next.tiePolicy);
    setScopes(next.scopes);
  }

  useEffect(() => {
    const controller = new AbortController();
    api<StaffBoards>(path, { signal: controller.signal }).then(adopt).catch(error => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, [path]);

  async function update(suffix: string, method: string, data?: unknown) {
    setBusy(true);
    setError(null);
    try {
      adopt(await api<StaffBoards>(path + suffix, method === "GET" ? undefined : json(method, data)));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void update("", "PUT", { tiePolicy, scopes });
  }

  const dirty = Boolean(view && (tiePolicy !== view.tiePolicy || scopes.length !== view.scopes.length || scopes.some(scope => !view.scopes.includes(scope))));
  const canPublish = view && ["CLOSED", "ARCHIVED"].includes(view.status);
  return <section className="panel form-stack" aria-labelledby="leaderboard-heading">
    <div className="card-heading">
      <h2 id="leaderboard-heading" className="staff-board-heading">
        <span className="brand-tree"><Icon name="tree" size={24}/></span>
        {t("Leaderboards", "لوحات الترتيب")}
      </h2>
      <button type="button" className="link-button" disabled={busy} onClick={() => update("", "GET")}>{t("Refresh standings", "تحديث الترتيب")}</button>
    </div>
    {error ? <p role="alert" className="notice error">{errorText(error, t)}</p> : null}
    {!view && !error && <p role="status">{t("Loading standings…", "جارٍ تحميل الترتيب…")}</p>}
    {view && <>
      {!canPublish && <p className="note">{t("Provisional standings. Close the competition to publish.", "الترتيب مؤقت. أغلق المسابقة للنشر.")}</p>}
      {!view.overallAvailable && <p className="note">{t("Overall is available when every grade uses the same frozen quiz.", "يتاح الترتيب العام عند استخدام كل الصفوف الاختبار نفسه.")}</p>}
      <BoardView boards={view.boards} t={t}/>
      <form className="form-stack" onSubmit={save}>
        <fieldset disabled={busy || view.published} className="form-stack">
          <legend>{t("Leaderboard settings", "إعدادات لوحة الترتيب")}</legend>
          <label>{t("Tie-breaker", "كسر التعادل")}<select value={tiePolicy} onChange={e => setTiePolicy(e.target.value as TiePolicy)}>
            <option value="SCORE_ONLY">{t("Equal scores share rank", "النتائج المتساوية تشترك في الترتيب")}</option>
            <option value="SCORE_THEN_TIME">{t("Shortest elapsed time", "أقصر مدة")}</option>
          </select></label>
          <div className="grade-choices">{view.boards.map(board => <label key={board.scope} className="field-check">
            <input type="checkbox" checked={scopes.includes(board.scope)} onChange={e => setScopes(list =>
              e.target.checked ? [...list, board.scope] : list.filter(scope => scope !== board.scope))}/>
            {t("Publish", "نشر")} {boardName(board, t)}
          </label>)}</div>
        </fieldset>
        {!view.published && <button className="button" disabled={busy || !dirty}>{t("Save leaderboard settings", "حفظ إعدادات الترتيب")}</button>}
      </form>
      <section className="form-stack" aria-label={t("Public preview", "المعاينة العامة")}>
        <h3>{t("Public preview", "المعاينة العامة")}</h3>
        <p className="note">{t("Published leaderboards show students’ full names to anyone with the link.", "تعرض لوحات الترتيب المنشورة أسماء الطلاب الكاملة لكل من لديه الرابط.")}</p>
        {dirty ? <p className="note">{t("Save your settings to review the public preview.", "احفظ الإعدادات لعرض المعاينة العامة.")}</p>
          : <BoardView boards={view.publication.boards} t={t}/>}
      </section>
      <div className="record-actions">
        {view.published ? <>
          <Link className="button" href={`/leaderboards/${id}`} prefetch={false}>{t("Open public leaderboard", "فتح لوحة الترتيب العامة")}</Link>
          <button className="button" type="button" disabled={busy} onClick={() => update("/unpublish", "POST")}>{t("Unpublish leaderboard", "إلغاء نشر لوحة الترتيب")}</button>
        </> : <button className="button primary" type="button" disabled={busy || !canPublish || dirty || !view.scopes.length}
          onClick={() => update("/publish", "POST", { revision: view.revision })}>{t("Publish leaderboard", "نشر لوحة الترتيب")}</button>}
      </div>
    </>}
  </section>;
}

export function PublicLeaderboard({ id, language, theme }: { id: string; language: Language; theme: Theme }) {
  const t: Translate = (en, ar) => language === "ar" ? ar : en;
  const [boards, setBoards] = useState<PublicBoards | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<PublicBoards>(`/leaderboards/${id}`, { signal: controller.signal }).then(setBoards).catch(error => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, [id]);
  const christmas = theme === "christmas";
  const back = <Link href="/" className={christmas ? "utility leaderboard-back" : "link-button"}>
    {t("Back to the competition site", "العودة إلى موقع المسابقة")}
  </Link>;
  return <div className="site" data-theme={theme} lang={language} dir={language === "ar" ? "rtl" : "ltr"}>
    {christmas && <>
      <a className="skip-link" href="#main-content">{t("Skip to content", "انتقل إلى المحتوى")}</a>
      <header className="site-header">
        <div className="header-inner">
          <SiteBrand href="/" t={t}/>
          <ChristmasLights/>
          <nav aria-label={t("Site", "الموقع")}>{back}</nav>
        </div>
      </header>
    </>}
    <main id="main-content" className="student-shell form-stack public-leaderboard">
      {!christmas && <div>{back}</div>}
      <div className="leaderboard-heading">
        <h1 dir="auto">{boards?.title ?? t("Leaderboard", "لوحة الترتيب")}</h1>
        {christmas && <div className="leaderboard-art" aria-hidden="true"/>}
      </div>
      {boards ? <div className="panel"><BoardView boards={boards.boards} t={t}/></div>
        : error ? <p role="alert">{error instanceof ApiError && [400, 404].includes(error.status) ? t("This leaderboard is unavailable.", "لوحة الترتيب غير متاحة.") : errorText(error, t)}</p>
          : <p role="status">{t("Loading standings…", "جارٍ تحميل الترتيب…")}</p>}
    </main>
  </div>;
}
