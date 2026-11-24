"use client";

import { useMemo, useState, type FormEvent } from "react";
import { api, errorText, json, type Grade, type Translate } from "../api";
import { difficultyText, questionType, type BankQuestion, type Blueprint, type CompetitionGrade, type StaffCompetition } from "../competition";
import { difficulties, questionTypes } from "./question-bank";

const blueprintTypes = questionTypes.flatMap((type) => difficulties.map((difficulty) => ({ type, difficulty, count: 0 })));
const blueprintKey = (rule: Blueprint) => `${rule.type}-${rule.difficulty}`;

function asLocal(value?: string) {
  if (!value) return undefined;
  const time = new Date(value);
  const local = new Date(time.getTime() - time.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CompetitionEditor({ competition, grades, questions, t, onSave, onCancel }: {
  competition: StaffCompetition | null; grades: Grade[]; questions: BankQuestion[]; t: Translate;
  onSave: (competition: StaffCompetition) => void; onCancel: () => void;
}) {
  const [selected, setSelected] = useState<CompetitionGrade[]>(competition?.grades ?? []);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);

  function setGrade(grade: CompetitionGrade) {
    setSelected((current) => current.map((value) => value.gradeId === grade.gradeId ? grade : value));
    setInvalid(false);
  }

  function valid(grade: CompetitionGrade) {
    const chosen = grade.questionIds.flatMap((id) => byId.get(id) ?? []);
    if (!chosen.length || chosen.length !== grade.questionIds.length || chosen.some((row) => row.archived)) return false;
    return blueprintTypes.every(({ type, difficulty }) => {
      const target = grade.blueprint.find((row) => row.type === type && row.difficulty === difficulty)?.count ?? 0;
      return chosen.filter((row) => row.type === type && row.difficulty === difficulty).length === target;
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInvalid(false);
    const form = new FormData(event.currentTarget);
    const opens = new Date(String(form.get("opensAt")));
    const closes = new Date(String(form.get("closesAt")));
    if (opens >= closes || selected.length === 0) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      const data = {
        title: String(form.get("title")).trim(),
        instructions: String(form.get("instructions")).trim(),
        description: String(form.get("description")).trim(),
        tiePolicy: form.get("tiePolicy"),
        opensAt: opens.toISOString(),
        closesAt: closes.toISOString(),
        durationMinutes: Number(form.get("durationMinutes")),
        grades: selected.map((grade) => ({ ...grade, blueprint: grade.blueprint.filter((rule) => rule.count > 0) })),
      };
      const saved = await api<StaffCompetition>(competition ? `/admin/competitions/${competition.id}` : "/admin/competitions", json(competition ? "PATCH" : "POST", data));
      onSave(saved);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  return <form className="panel form-stack" onSubmit={save}>
    <h2>{competition ? t("Edit draft", "تعديل المسودة") : t("Create competition", "إنشاء مسابقة")}</h2>
    <label>{t("Title", "العنوان")}<input name="title" dir="auto" defaultValue={competition?.title} disabled={busy} required maxLength={160}/></label>
    <label>{t("Description", "الوصف")}<textarea name="description" dir="auto" rows={2} maxLength={4000} defaultValue={competition?.description ?? ""} disabled={busy}/></label>
    <label>{t("Student instructions", "تعليمات الطلاب")}<textarea name="instructions" dir="auto" rows={3} maxLength={8000} defaultValue={competition?.instructions} disabled={busy}/></label>
    <div className="form-grid">
      <label>{t("Opening time", "وقت الفتح")}<input type="datetime-local" name="opensAt" defaultValue={asLocal(competition?.opensAt)} disabled={busy} required/></label>
      <label>{t("Closing time", "وقت الإغلاق")}<input type="datetime-local" name="closesAt" defaultValue={asLocal(competition?.closesAt)} disabled={busy} required/></label>
      <label>{t("Duration in minutes", "المدة بالدقائق")}<input type="number" name="durationMinutes" min="1" max="1440" defaultValue={competition?.durationMinutes ?? 30} disabled={busy} required/></label>
      <label>{t("Tie policy", "سياسة التعادل")}<select name="tiePolicy" defaultValue={competition?.tiePolicy ?? "SCORE_THEN_TIME"} disabled={busy}>
        <option value="SCORE_THEN_TIME">{t("Score, then shortest elapsed time", "النتيجة، ثم أقصر مدة")}</option>
        <option value="SCORE_ONLY">{t("Equal scores share rank", "النتائج المتساوية تشترك في الترتيب")}</option>
      </select></label>
      <p className="note">{t("Times use your device’s local time zone.", "تُعرض الأوقات بحسب المنطقة الزمنية لجهازك.")}</p>
    </div>
    <fieldset className="form-stack" disabled={busy}>
      <legend>{t("Eligible grades", "الصفوف المؤهلة")}</legend>
      <div className="grade-choices">{grades.map((grade) => <label key={grade.id} className="field-check">
        <input type="checkbox" checked={selected.some((row) => row.gradeId === grade.id)} onChange={(event) => {
          const checked = event.target.checked;
          setInvalid(false);
          setSelected((current) => checked ? [...current, { gradeId: grade.id, questionIds: [], blueprint: [] }] : current.filter((row) => row.gradeId !== grade.id));
        }}/>
        <bdi>{grade.name}</bdi>
      </label>)}</div>
    </fieldset>
    {selected.map((grade) => {
      const gradeName = grades.find(({ id }) => id === grade.gradeId)?.name;
      const available = questions.filter((row) => row.gradeId === grade.gradeId && !row.archived);
      const chosen = grade.questionIds.flatMap((id) => byId.get(id) ?? []);
      const maximum = chosen.reduce((sum, row) => sum + Number(row.points), 0);
      return <fieldset key={grade.gradeId} className="grade-builder form-stack" disabled={busy}>
        <legend><bdi>{gradeName}</bdi></legend>
        <p>{t("Set the required count for each question category, then choose matching questions.", "حدد عدد الأسئلة المطلوب من كل فئة، ثم اختر أسئلة مطابقة.")}</p>
        {available.length === 0 ? <p className="note">{t("Add active questions for this grade in the question bank.", "أضف أسئلة نشطة لهذا الصف في بنك الأسئلة.")}</p> : <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Question counts", "أعداد الأسئلة")}>
            <table className="roster-table data-table"><thead><tr>
              <th scope="col">{t("Category", "الفئة")}</th><th scope="col">{t("Required", "المطلوب")}</th><th scope="col">{t("Selected", "المحدد")}</th>
            </tr></thead><tbody>
              {blueprintTypes.map((rule) => {
                const key = blueprintKey(rule);
                const required = grade.blueprint.find((row) => blueprintKey(row) === key)?.count ?? 0;
                const count = chosen.filter((row) => blueprintKey({ ...row, count: 0 }) === key).length;
                const label = `${questionType(rule.type, t)} · ${difficultyText(rule.difficulty, t)}`;
                return <tr key={key}><td>{label}</td><td><input className="count-input" aria-label={t(`${label} required count`, `العدد المطلوب لفئة ${label}`)} type="number" value={required} min={0} max={100} onChange={(event) => {
                  const count = Number(event.target.value);
                  setGrade({ ...grade, blueprint: [...grade.blueprint.filter((row) => blueprintKey(row) !== key), { ...rule, count }] });
                }}/></td><td><span className={required !== count ? "count-mismatch" : ""}>{count}</span></td></tr>;
              })}
            </tbody></table>
          </div>
          <div className="question-pick">
            {available.map((row) => <label className="field-check" key={row.id}>
              <input type="checkbox" disabled={grade.questionIds.length >= 100 && !grade.questionIds.includes(row.id)} checked={grade.questionIds.includes(row.id)} onChange={(event) => {
                setGrade({ ...grade, questionIds: event.target.checked ? [...grade.questionIds, row.id] : grade.questionIds.filter((id) => id !== row.id) });
              }}/>
              <span><span dir="auto">{row.text}</span><small>{questionType(row.type, t)} · {difficultyText(row.difficulty, t)} · {t(`${row.points} pts`, `${row.points} نقطة`)}</small></span>
            </label>)}
          </div>
          {chosen.some((row) => row.archived) && <div className="notice error form-stack">
            <p>{t("Remove archived questions before saving this draft.", "أزل الأسئلة المؤرشفة قبل حفظ المسودة.")}</p>
            {chosen.filter((row) => row.archived).map((row) => <button className="button" type="button" key={row.id} onClick={() => setGrade({ ...grade, questionIds: grade.questionIds.filter((id) => id !== row.id) })}>
              {t("Remove", "إزالة")} <bdi>{row.text}</bdi>
            </button>)}
          </div>}
          <p className="note">{t(`${chosen.length} questions selected · Maximum ${maximum} points`, `تم تحديد ${chosen.length} سؤال · الحد الأقصى ${maximum} نقطة`)}</p>
          {!valid(grade) && <p className="note count-mismatch">{t("Match all required counts before activating this draft.", "طابق جميع الأعداد المطلوبة قبل تفعيل هذه المسودة.")}</p>}
        </>}
      </fieldset>;
    })}
    {invalid && <p className="notice error" role="alert">{t("Choose at least one grade and set an opening time before closing.", "اختر صفًا واحدًا على الأقل وحدد وقت فتح يسبق وقت الإغلاق.")}</p>}
    {error ? <p className="notice error" role="alert">{errorText(error, t)}</p> : null}
    <div className="record-actions">
      <button className="button primary" disabled={busy}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Save draft", "حفظ المسودة")}</button>
      <button className="button" type="button" disabled={busy} onClick={onCancel}>{t("Cancel", "إلغاء")}</button>
    </div>
  </form>;
}
