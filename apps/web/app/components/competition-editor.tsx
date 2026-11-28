"use client";

import { useState, type FormEvent } from "react";
import { api, errorText, json, type Grade, type Translate } from "../api";
import { difficultyText, questionType, type CompetitionQuestion, type StaffCompetition } from "../competition";
import { QuestionEditor } from "./question-editor";
import { Icon } from "./ui-icon";

function asLocal(value?: string) {
  if (!value) return undefined;
  const time = new Date(value);
  const local = new Date(time.getTime() - time.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CompetitionEditor({ competition, grades, t, onSave, onCancel }: {
  competition: StaffCompetition | null; grades: Grade[]; t: Translate;
  onSave: (competition: StaffCompetition) => void; onCancel: () => void;
}) {
  const locked = competition?.quizLocked === true;
  const closed = competition?.status === "CLOSED" || competition?.status === "ARCHIVED";
  const [timerEnabled, setTimerEnabled] = useState(competition?.timerEnabled !== false);
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  const [selected, setSelected] = useState(competition?.grades.map(row => row.gradeId) ?? []);
  const [questions, setQuestions] = useState(competition?.questions ?? []);
  const [editing, setEditing] = useState<CompetitionQuestion | "new" | null>(null);
  const needsConversion = Boolean(competition?.legacyDraftSets);
  const [legacyGrade, setLegacyGrade] = useState("");
  const [converted, setConverted] = useState(!needsConversion);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const originalQuestions = new Map((competition?.questions ?? []).map(question => [question.id, question]));
  const answerKeys = locked ? questions.filter(question => {
    const previous = originalQuestions.get(question.id)?.correctOrder;
    return previous && question.correctOrder.some((id, index) => id !== previous[index]);
  }).map(({ id, correctOrder }) => ({ questionId: id, correctOrder })) : [];

  function move(index: number, to: number) {
    const next = [...questions];
    [next[index], next[to]] = [next[to], next[index]];
    setQuestions(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || editing || !converted) return;
    setError(null);
    setInvalid(false);
    const form = new FormData(event.currentTarget);
    const openingInput = String(form.get("opensAt") ?? "");
    const closingInput = String(form.get("closesAt") ?? "");
    const opens = new Date(competition && (locked || openingInput === asLocal(competition.opensAt)) ? competition.opensAt : openingInput);
    const closes = new Date(competition && (closed || closingInput === asLocal(competition.closesAt)) ? competition.closesAt : closingInput);
    if (opens >= closes || (!locked && selected.length === 0)) {
      setInvalid(true);
      return;
    }
    if (answerKeys.length && !confirmCorrection) {
      setConfirmCorrection(true);
      return;
    }
    setBusy(true);
    try {
      const data = {
        title: String(form.get("title")).trim(),
        instructions: String(form.get("instructions")).trim(),
        description: String(form.get("description")).trim(),
        ...(!closed && { timerEnabled, durationMinutes: Number(form.get("durationMinutes") ?? competition?.durationMinutes ?? 30) }),
        ...(!closed && (!locked || closes.getTime() !== Date.parse(competition!.closesAt)) && { closesAt: closes.toISOString() }),
        ...(locked ? (answerKeys.length ? { answerKeys } : {}) : {
          tiePolicy: form.get("tiePolicy"), opensAt: opens.toISOString(), gradeIds: selected, questions,
        }),
      };
      const saved = await api<StaffCompetition>(competition ? `/admin/competitions/${competition.id}` : "/admin/competitions", json(competition ? "PATCH" : "POST", data));
      onSave(saved);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  return <div className="form-stack">
    <form id="competition-draft" className="panel form-stack" onSubmit={save}>
    <h2>{competition ? t("Edit competition", "تعديل المسابقة") : t("Create competition", "إنشاء مسابقة")}</h2>
    <label>{t("Title", "العنوان")}<input name="title" dir="auto" defaultValue={competition?.title} disabled={busy} required maxLength={160}/></label>
    <label>{t("Description", "الوصف")}<textarea name="description" dir="auto" rows={2} maxLength={4000} defaultValue={competition?.description ?? ""} disabled={busy}/></label>
    <label>{t("Student instructions", "تعليمات الطلاب")}<textarea name="instructions" dir="auto" rows={3} maxLength={8000} defaultValue={competition?.instructions} disabled={busy}/></label>
    <div className="form-grid">
      <label>{t("Opening time", "وقت الفتح")}<input type="datetime-local" name="opensAt" defaultValue={asLocal(competition?.opensAt)} disabled={busy || locked} required/></label>
      <label>{t("Closing time", "وقت الإغلاق")}<input type="datetime-local" name="closesAt" defaultValue={asLocal(competition?.closesAt)} disabled={busy || closed} required/></label>
      <label className="field-check"><input type="checkbox" checked={timerEnabled} disabled={busy || closed} onChange={event => setTimerEnabled(event.target.checked)}/>{t("Attempt timer", "مؤقت المحاولة")}</label>
      <label>{t("Duration in minutes", "المدة بالدقائق")}<input type="number" name="durationMinutes" min="1" max="1440" defaultValue={competition?.durationMinutes ?? 30} disabled={busy || closed || !timerEnabled} required/></label>
      <label>{t("Tie policy", "سياسة التعادل")}<select name="tiePolicy" defaultValue={competition?.tiePolicy ?? "SCORE_THEN_TIME"} disabled={busy || locked}>
        <option value="SCORE_THEN_TIME">{t("Score, then shortest elapsed time", "النتيجة، ثم أقصر مدة")}</option>
        <option value="SCORE_ONLY">{t("Equal scores share rank", "النتائج المتساوية تشترك في الترتيب")}</option>
      </select></label>
      <p className="note">{t("Times use your device’s local time zone.", "تُعرض الأوقات بحسب المنطقة الزمنية لجهازك.")}{" "}
        {t("Timer changes apply to future starts. Every attempt still ends by its stored deadline.", "تُطبّق تغييرات المؤقت على المحاولات الجديدة. تنتهي كل محاولة في موعدها المحفوظ.")}</p>
    </div>
    <fieldset className="form-stack" disabled={busy || locked}>
      <legend>{t("Eligible grades", "الصفوف المؤهلة")}</legend>
      <div className="grade-choices">{grades.map((grade) => <label key={grade.id} className="field-check">
        <input type="checkbox" checked={selected.includes(grade.id)} onChange={(event) => {
          const checked = event.target.checked;
          setInvalid(false);
          setSelected((current) => checked ? [...current, grade.id] : current.filter(id => id !== grade.id));
        }}/>
        <bdi>{grade.name}</bdi>
      </label>)}</div>
    </fieldset>
    </form>
    {locked ? <section className="panel form-stack" aria-labelledby="answer-key-heading">
      <h2 id="answer-key-heading">{t("Answer-key corrections", "تصحيح مفاتيح الإجابات")}</h2>
      <p className="note">{t("Question text and options are locked. Correct the answer key here to rescore completed attempts.", "نصوص الأسئلة والخيارات مقفلة. صحّح مفتاح الإجابة هنا لإعادة احتساب المحاولات المكتملة.")}</p>
      {questions.map(question => <AnswerKeyFields key={question.id} question={question} t={t} disabled={busy || confirmCorrection} onChange={correctOrder => {
        setQuestions(current => current.map(row => row.id === question.id ? { ...row, correctOrder } : row));
      }}/>)}
    </section> : <section className="panel form-stack" aria-labelledby="draft-questions">
      <h2 id="draft-questions">{t("Questions", "الأسئلة")}</h2>
      <p className="note">{t("All eligible grades receive these questions.", "تتلقى جميع الصفوف المؤهلة هذه الأسئلة.")}</p>
      {!converted ? <div className="form-stack">
        <p>{t("Choose a previous grade set to copy into this draft.", "اختر مجموعة أسئلة صف سابق لنسخها إلى هذه المسودة.")}</p>
        <label>{t("Grade set to copy", "مجموعة الصف المراد نسخها")}<select value={legacyGrade} onChange={e => setLegacyGrade(e.target.value)}>
          <option value="">{t("Choose a grade", "اختر الصف")}</option>
          {competition?.legacyDraftSets?.map(set => <option key={set.gradeId} value={set.gradeId}>{grades.find(grade => grade.id === set.gradeId)?.name}</option>)}
        </select></label>
        <button type="button" className="button" disabled={!legacyGrade} onClick={() => {
          const source = competition?.legacyDraftSets?.find(set => set.gradeId === legacyGrade);
          if (!source) return;
          setQuestions(source.questions.map(q => ({ ...q, id: crypto.randomUUID() })));
          setConverted(true);
        }}>{t("Copy questions", "نسخ الأسئلة")}</button>
      </div> : <>
        <p>{t(`${questions.length} questions · ${questions.reduce((total, question) => total + question.points, 0)} points`,
          `${questions.length} سؤال · ${questions.reduce((total, question) => total + question.points, 0)} نقطة`)}</p>
        {questions.length > 0 && <ol className="form-stack">{questions.map((question, index) => <li key={question.id}>
          <p dir="auto"><strong>{question.text}</strong></p>
          <p className="note">{questionType(question.type, t)} · {difficultyText(question.difficulty, t)} · {question.points}</p>
          <div className="record-actions">
            <button className="button" type="button" disabled={busy || !!editing || index === 0} onClick={() => move(index, index - 1)}>{t("Move up", "حرّك لأعلى")}</button>
            <button className="button" type="button" disabled={busy || !!editing || index === questions.length - 1} onClick={() => move(index, index + 1)}>{t("Move down", "حرّك لأسفل")}</button>
            <button className="button" type="button" disabled={busy || !!editing} onClick={() => setEditing(question)}>{t("Edit", "تعديل")}</button>
            <button className="link-button" type="button" disabled={busy || !!editing} onClick={() => setQuestions(list => list.filter(row => row.id !== question.id))}>{t("Remove", "إزالة")}</button>
          </div>
        </li>)}</ol>}
        {!editing && <div><button type="button" className="button" disabled={busy || questions.length >= 100} onClick={() => setEditing("new")}>{t("Add question", "إضافة سؤال")}</button></div>}
      </>}
    </section>}
    {editing && <QuestionEditor key={editing === "new" ? "new" : editing.id} t={t} question={editing === "new" ? null : editing}
      onCancel={() => setEditing(null)} onSave={question => {
        setQuestions(list => editing === "new" ? [...list, question] : list.map(row => row.id === question.id ? question : row));
        setEditing(null);
      }}/>}
    {invalid && <p className="notice error" role="alert">{t("Choose at least one grade and set an opening time before closing.", "اختر صفًا واحدًا على الأقل وحدد وقت فتح يسبق وقت الإغلاق.")}</p>}
    {error ? <p className="notice error" role="alert">{errorText(error, t)}</p> : null}
    {confirmCorrection && <div className="notice" role="status">{t(
      `This correction will rescore ${competition?.completedAttempts ?? 0} completed attempts, plus any that finish before you confirm.`,
      `سيعيد هذا التصحيح احتساب ${competition?.completedAttempts ?? 0} محاولة مكتملة، وأي محاولات تنتهي قبل التأكيد.`
    )}</div>}
    <div className="record-actions">
      <button className="button primary" type="submit" form="competition-draft" disabled={busy || !!editing || !converted}>{busy ? t("Saving…", "جارٍ الحفظ…")
        : confirmCorrection ? t("Confirm and rescore", "تأكيد وإعادة الاحتساب") : competition?.status === "DRAFT" || !competition
          ? t("Save draft", "حفظ المسودة") : t("Save competition", "حفظ المسابقة")}</button>
      <button className="button" type="button" disabled={busy} onClick={confirmCorrection ? () => setConfirmCorrection(false) : onCancel}>{confirmCorrection ? t("Back to editing", "العودة للتعديل") : t("Cancel", "إلغاء")}</button>
    </div>
  </div>;
}


function AnswerKeyFields({ question, t, disabled, onChange }: {
  question: CompetitionQuestion; t: Translate; disabled: boolean; onChange: (correctOrder: string[]) => void;
}) {
  function move(index: number, next: number) {
    const correctOrder = [...question.correctOrder];
    [correctOrder[index], correctOrder[next]] = [correctOrder[next], correctOrder[index]];
    onChange(correctOrder);
  }

  return <details className="question-details">
    <summary dir="auto">{question.text}</summary>
    <fieldset className="form-stack" disabled={disabled}>
      <legend>{t("Correct answer", "الإجابة الصحيحة")}</legend>
      {question.type === "MCQ" ? question.items.map(item => <label className="field-check" key={item.id}>
        <input type="radio" name={`answer-key-${question.id}`} checked={question.correctOrder[0] === item.id} onChange={() => onChange([item.id])}/>
        <bdi>{item.text}</bdi>
      </label>) : <ol className="sorting-list">{question.correctOrder.map((id, index) => {
        const item = question.items.find(candidate => candidate.id === id);
        if (!item) return null;
        return <li key={id}><span className="sort-position">{index + 1}</span><bdi>{item.text}</bdi>
          <div className="sort-moves">
            <button className="button" type="button" disabled={index === 0} aria-label={t(`Move ${item.text} up`, `حرّك ${item.text} لأعلى`)} onClick={() => move(index, index - 1)}><Icon name="up" size={17}/></button>
            <button className="button" type="button" disabled={index === question.correctOrder.length - 1} aria-label={t(`Move ${item.text} down`, `حرّك ${item.text} لأسفل`)} onClick={() => move(index, index + 1)}><Icon name="down" size={17}/></button>
          </div>
        </li>;
      })}</ol>}
    </fieldset>
  </details>;
}
