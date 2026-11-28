"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api, errorText, groupHome, json, overallBoardPath, type Language, type Theme, type Translate } from "../api";
import { ChristmasLights, SiteBrand } from "./site-brand";
import { ChristmasControls, useChristmasSurface } from "./christmas-effects";
import { Icon } from "./ui-icon";

type Row = { rank: number; name: string; grade: string; score: number; maxScore: number; competitions?: number };
type Board = { scope: string; name: string | null; rows: Row[] };
type PublicBoards = { title: string; boards: Board[]; provisional?: boolean };
type TiePolicy = "SCORE_THEN_TIME" | "SCORE_ONLY";
type StaffBoards = {
  tiePolicy: TiePolicy; status: string; scopes: string[]; boards: Board[]; publication: PublicBoards;
  overallAvailable: boolean; published: boolean; revision: string;
};

function boardName(board: Board, t: Translate) {
  return board.name ?? t("Overall", "جميع الصفوف");
}

const gradeOrder = new Intl.Collator("en", { numeric: true });
const rankDecorations = [undefined, "star", "bell", "ornament"] as const;

function sortBoards(boards: Board[]) {
  return [...boards].sort((a, b) =>
    Number(b.scope === "overall") - Number(a.scope === "overall") ||
    gradeOrder.compare(a.name ?? "", b.name ?? ""));
}

function BoardView({ boards, t, cumulative = false, reveal = false }: {
  boards: Board[]; t: Translate; cumulative?: boolean; reveal?: boolean;
}) {
  const [scope, setScope] = useState("");
  const orderedBoards = sortBoards(boards);
  const selected = orderedBoards.find(board => board.scope === scope) ?? orderedBoards[0];
  if (!selected) return <p className="note">{t("No boards selected.", "لم تُحدَّد أي لوحة.")}</p>;
  return <div className="form-stack">
    {boards.length > 1 && <nav className="record-actions" aria-label={t("Leaderboard scope", "نطاق لوحة الترتيب")}>
      {orderedBoards.map(board => <button key={board.scope} className="button" type="button" aria-pressed={board.scope === selected.scope} onClick={() => setScope(board.scope)}>{boardName(board, t)}</button>)}
    </nav>}
    {!cumulative && <h3>{boardName(selected, t)}</h3>}
    {selected.rows.length === 0 ? <p className="note">{t("No completed attempts yet.", "لا توجد محاولات مكتملة بعد.")}</p>
      : <div key={selected.scope} className="table-wrap leaderboard-results" data-reveal={reveal} role="region" tabIndex={0} aria-label={boardName(selected, t)}>
        <table className="roster-table data-table leaderboard-table">
          <thead><tr>
            <th scope="col">{t("Rank", "الترتيب")}</th>
            <th scope="col">{t("Full name", "الاسم الكامل")}</th>
            <th scope="col">{t("Grade", "الصف")}</th>
            {cumulative && <th scope="col">{t("Competitions", "المسابقات")}</th>}
            <th scope="col">{cumulative ? t("Total points", "مجموع النقاط") : t("Score", "النتيجة")}</th>
          </tr></thead>
          <tbody>{selected.rows.map((row, index) => {
            const decoration = rankDecorations[row.rank];
            return <tr key={index} data-podium={decoration ? row.rank : undefined}>
              <td><span className="leaderboard-rank">
                {decoration && <span className="leaderboard-rank-decoration"><Icon name={decoration} size={17}/></span>}
                {row.rank}
              </span></td>
              <td className="leaderboard-name"><bdi>{row.name}</bdi></td>
              <td><bdi>{row.grade}</bdi></td>
              {cumulative && <td>{row.competitions}</td>}
              <td className="leaderboard-score"><bdi>{cumulative ? row.score : `${row.score} / ${row.maxScore}`}</bdi></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </div>;
}

function overallTitle(t: Translate) {
  return t("Across-competition leaderboard", "لوحة ترتيب جميع المسابقات");
}

function overallExplanation(t: Translate) {
  return t("Ranks use total points from published results and live competition boards. Shorter total elapsed time breaks ties.", "يعتمد الترتيب على مجموع النقاط من النتائج المنشورة ولوحات المسابقات المباشرة. وعند التعادل يتقدم صاحب أقصر وقت إجمالي.");
}

export function AdminOverallLeaderboard({ t, groupId }: { t: Translate; groupId: string }) {
  const path = "/admin/leaderboards/all";
  const [view, setView] = useState<(PublicBoards & { published: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<PublicBoards & { published: boolean }>(path, { signal: controller.signal }).then(setView).catch(error => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, [path]);

  async function changeVisibility(published: boolean) {
    setBusy(true);
    setError(null);
    setAnnouncement("");
    try {
      setView(await api<PublicBoards & { published: boolean }>(path, json("PUT", { published })));
      setAnnouncement(published ? t("Leaderboard published.", "تم نشر لوحة الترتيب.") : t("Leaderboard unpublished.", "تم إلغاء نشر لوحة الترتيب."));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  return <section className="form-stack" aria-labelledby="overall-leaderboard-heading">
    <h1 id="overall-leaderboard-heading">{overallTitle(t)}</h1>
    <p className="subtle">{overallExplanation(t)}</p>
    {error ? <p role="alert" className="notice error">{errorText(error, t)}</p> : null}
    {!view && !error && <p role="status">{t("Loading standings…", "جارٍ تحميل الترتيب…")}</p>}
    {view && <div className="panel form-stack">
      <BoardView boards={view.boards} t={t} cumulative/>
      <p className="note">{t("The public link shows full names and updates as published standings change.", "يعرض الرابط العام الأسماء الكاملة ويتم تحديثه عند تغيّر الترتيب المنشور.")}</p>
      <div className="record-actions">
        {!view.published ? <button type="button" className="button primary" disabled={busy} onClick={() => changeVisibility(true)}>{t("Publish overall leaderboard", "نشر لوحة ترتيب جميع المسابقات")}</button>
          : <>
            <Link className="button" href={overallBoardPath(groupId)} prefetch={false}>{t("Open public leaderboard", "فتح لوحة الترتيب العامة")}</Link>
            <button type="button" className="button" disabled={busy} onClick={() => changeVisibility(false)}>{t("Unpublish overall leaderboard", "إلغاء نشر لوحة ترتيب جميع المسابقات")}</button>
          </>}
      </div>
      <p role="status">{announcement}</p>
    </div>}
  </section>;
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
  const canPublish = view && ["ACTIVE", "CLOSED", "ARCHIVED"].includes(view.status);
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
      {!canPublish && <p className="note">{t("Open or close the competition before publishing its leaderboard.", "افتح المسابقة أو أغلقها قبل نشر لوحة ترتيبها.")}</p>}
      {!view.overallAvailable && <p className="note">{t("Overall is available when every grade uses the same frozen quiz.", "يتاح الترتيب العام عند استخدام كل الصفوف الاختبار نفسه.")}</p>}
      <BoardView boards={view.boards} t={t}/>
      <form className="form-stack" onSubmit={save}>
        <fieldset disabled={busy || view.published} className="form-stack">
          <legend>{t("Leaderboard settings", "إعدادات لوحة الترتيب")}</legend>
          <label>{t("Tie-breaker", "كسر التعادل")}<select value={tiePolicy} onChange={e => setTiePolicy(e.target.value as TiePolicy)}>
            <option value="SCORE_ONLY">{t("Equal scores share rank", "النتائج المتساوية تشترك في الترتيب")}</option>
            <option value="SCORE_THEN_TIME">{t("Shortest elapsed time", "أقصر مدة")}</option>
          </select></label>
          <div className="grade-choices">{sortBoards(view.boards).map(board => <label key={board.scope} className="field-check">
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
          : <BoardView boards={view.publication.boards} t={t} reveal/>}
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

export function PublicLeaderboard({ id, groupId, language, theme }: { id: string; groupId?: string; language: Language; theme: Theme }) {
  const t: Translate = (en, ar) => language === "ar" ? ar : en;
  const cumulative = id === "all";
  const [boards, setBoards] = useState<PublicBoards | null>(null);
  const [error, setError] = useState<unknown>(null);
  const path = cumulative ? overallBoardPath(groupId) : `/leaderboards/${id}`;
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const standings = await api<PublicBoards>(path, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setBoards(standings);
          setError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          if (error instanceof ApiError && [400, 404].includes(error.status)) setBoards(null);
          setError(error);
        }
      } finally {
        pending = false;
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [path]);
  const christmas = theme === "christmas";
  const { snowRunning } = useChristmasSurface(theme);
  const home = groupHome(groupId);
  const back = <Link href={home} className={christmas ? "utility leaderboard-back" : "link-button"}>
    {t("Back to the competition site", "العودة إلى موقع المسابقة")}
  </Link>;
  return <div className="site" data-theme={theme} data-snow-running={snowRunning} lang={language} dir={language === "ar" ? "rtl" : "ltr"}>
    {christmas && <>
      <a className="skip-link" href="#main-content">{t("Skip to content", "انتقل إلى المحتوى")}</a>
      <header className="site-header">
        <div className="header-inner">
          <SiteBrand href={home} t={t}/>
          <ChristmasLights/>
          <nav aria-label={t("Site", "الموقع")}>{back}</nav>
        </div>
        <ChristmasControls t={t}/>
      </header>
    </>}
    <main id="main-content" className="student-shell form-stack public-leaderboard">
      {!christmas && <div>{back}</div>}
      <div className="leaderboard-heading">
        <h1 dir="auto">{cumulative ? overallTitle(t) : boards?.title ?? t("Leaderboard", "لوحة الترتيب")}</h1>
        {christmas && <div className="leaderboard-art" aria-hidden="true"/>}
      </div>
      {boards ? <div className="panel form-stack">
        {cumulative && <p className="subtle">{overallExplanation(t)}</p>}
        {boards.provisional && <p><span className="status">{t("Provisional", "ترتيب مؤقت")}</span></p>}
        {Boolean(error) && <p className="note" role="status">{t("Live standings could not refresh. Trying again shortly.", "تعذّر تحديث الترتيب المباشر. ستتم المحاولة مجددًا قريبًا.")}</p>}
        <BoardView boards={boards.boards} t={t} cumulative={cumulative} reveal/>
      </div>
        : error ? <p role="alert">{error instanceof ApiError && [400, 404].includes(error.status) ? t("This leaderboard is unavailable.", "لوحة الترتيب غير متاحة.") : errorText(error, t)}</p>
          : <p role="status">{t("Loading standings…", "جارٍ تحميل الترتيب…")}</p>}
    </main>
  </div>;
}
