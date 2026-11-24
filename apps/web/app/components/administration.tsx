"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, json, errorText, type Grade, type Language, type Translate } from "../api";
import { displayDate } from "../competition";
import { DeleteConfirmation } from "./delete-confirmation";

type Servant = {id: string; fullName: string; username: string; status: "ACTIVE" | "SUSPENDED"; gradeIds: string[]};

type Staff = Omit<Servant, "gradeIds"> & {role: "SUPER_ADMIN" | "SERVANT"};
type SetupCode = {username: string; setupCode: string; expiresAt: string};

export function Administration({ t, language, currentStaffId }: { t: Translate; language: Language; currentStaffId: string }) {
  const [accounts, setAccounts] = useState<Staff[]>([]);
  const [deleting, setDeleting] = useState<Staff | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [staff, setStaff] = useState<Servant[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<SetupCode | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  async function refresh() {
    const [gradeRows, staffRows, allStaff] = await Promise.all([api<Grade[]>("/admin/grades"), api<Servant[]>("/admin/servants"), api<Staff[]>("/admin/staff")]);
    setGrades(gradeRows);
    setStaff(staffRows);
    setAccounts(allStaff);
  }
  useEffect(() => {refresh().catch(setError);}, []);
  const grade = grades.find(row => row.id === gradeId);
  const servant = staff.find(row => row.id === staffId);
  async function save(event: FormEvent<HTMLFormElement>, section: "grades" | "servants") {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const id = section === "grades" ? gradeId : staffId;
    const data = section === "grades" ? {name: values.get("name")} : {
      fullName: values.get("fullName"), username: values.get("username"),
      gradeIds: values.getAll("gradeIds"),
      ...(id ? {status: values.get("status")} : {})
    };
    setError(undefined);
    setNotice(false);
    setBusy(true);
    try {
      const result = await api<SetupCode | Servant | Grade>("/admin/" + section + (id ? "/" + id : ""), json(id ? "PATCH" : "POST", data));
      if ("setupCode" in result) {
        setCode(result);
        setCopyStatus("");
      }
      await refresh();
      form.reset();
      if (section === "grades") setGradeId(""); else setStaffId("");
      setNotice(true);
    } catch (err) {setError(err);} finally {setBusy(false);}
  }

  async function resetCredential() {
    if (!servant) return;
    setError(undefined);
    setNotice(false);
    setBusy(true);
    try {
      setCode(await api<SetupCode>(`/admin/servants/${servant.id}/reset-credential`, json("POST")));
      setCopyStatus("");
      setConfirmReset(false);
    } catch (err) {setError(err);} finally {setBusy(false);}
  }

  async function copySetupCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.setupCode);
      setCopyStatus(t("Code copied.", "تم نسخ الرمز."));
    } catch {
      setCopyStatus(t("Select the code to copy it.", "حدّد الرمز لنسخه."));
    }
  }
  return <section>
    <h1>{t("Staff and grades","الخدام والصفوف")}</h1>
    {error ? <p role="alert" className="notice error">{errorText(error,t)}</p> : null}
    {notice && <p role="status">{t("Changes saved.","تم حفظ التغييرات.")}</p>}
    <h2>{t("Grades","الصفوف")}</h2>
    <form className="form-stack" onSubmit={e=>save(e,"grades")}>
      <label>{t("Grade to manage","الصف المطلوب تعديله")}<select value={gradeId} onChange={e=>setGradeId(e.target.value)}><option value="">{t("New grade","صف جديد")}</option>{grades.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label>{t("Grade name","اسم الصف")}<input key={gradeId} name="name" required defaultValue={grade?.name} /></label>
      <button disabled={busy} className="button primary">{t("Save grade","حفظ الصف")}</button>
    </form>
    <h2>{t("Servants","الخدام")}</h2>
    <label>{t("Servant to manage","الخادم المطلوب تعديله")}
      <select value={staffId} disabled={busy} onChange={event => {
        setStaffId(event.target.value);
        setConfirmReset(false);
      }}>
        <option value="">{t("New servant","خادم جديد")}</option>
        {staff.map(s => <option key={s.id} value={s.id}>{s.fullName} ({s.username})</option>)}
      </select>
    </label>
    <form key={staffId} className="form-stack" onSubmit={e=>save(e,"servants")}>
      <label>{t("Full name","الاسم بالكامل")}<input name="fullName" required defaultValue={servant?.fullName}/></label>
      <label>{t("Username","اسم المستخدم")}<input name="username" required defaultValue={servant?.username} dir="auto" autoComplete="off" aria-describedby="servant-username-note"/></label>
      <p id="servant-username-note" className="note">{t("Use 3–64 characters. Arabic and English names with spaces are accepted.", "استخدم من ٣ إلى ٦٤ حرفًا. يمكن استخدام الأسماء العربية والإنجليزية مع المسافات.")}</p>
      <fieldset><legend>{t("Assigned grades","الصفوف المسندة")}</legend>{grades.map(g=><label key={g.id} style={{display:"flex",alignItems:"center",gap:8}}><input style={{width:"auto"}} type="checkbox" name="gradeIds" value={g.id} defaultChecked={servant?.gradeIds.includes(g.id)}/>{g.name}</label>)}</fieldset>
      {servant && <label>{t("Account status","حالة الحساب")}<select name="status" defaultValue={servant.status}><option value="ACTIVE">{t("Active","نشط")}</option><option value="SUSPENDED">{t("Suspended","موقوف")}</option></select></label>}
      <button disabled={busy} className="button primary">{staffId ? t("Save servant","حفظ الخادم") : t("Create servant and generate code","إنشاء حساب الخادم وإصدار رمز")}</button>
    </form>
    {servant?.status === "ACTIVE" && <div className="panel form-stack">
      {confirmReset ? <>
        <p>{t("Generate a new code? This invalidates the current PIN or password and signs the servant out.", "إصدار رمز جديد؟ سيؤدي ذلك إلى إلغاء الرمز أو كلمة المرور الحالية وتسجيل خروج الخادم.")}</p>
        <div className="record-actions">
          <button type="button" className="button primary" disabled={busy} onClick={resetCredential}>{t("Confirm and generate code", "تأكيد وإصدار الرمز")}</button>
          <button type="button" className="button" disabled={busy} onClick={() => setConfirmReset(false)}>{t("Cancel", "إلغاء")}</button>
        </div>
      </> : <div><button type="button" className="button" disabled={busy} onClick={() => setConfirmReset(true)}>{t("Reset PIN or password", "إعادة ضبط الرمز أو كلمة المرور")}</button></div>}
    </div>}
    {code && <section className="panel form-stack" aria-labelledby="servant-setup-code-heading">
      <h2 id="servant-setup-code-heading">{t("One-time setup code", "رمز إعداد لمرة واحدة")}</h2>
      <p>{t("Send this code privately to", "أرسل هذا الرمز بشكل خاص إلى")} <bdi>{code.username}</bdi>. {t("Ask them to choose Set up or reset on the staff sign-in page.", "اطلب منه اختيار إعداد أو إعادة ضبط في صفحة دخول الخدام.")}</p>
      <label>{t("Setup code", "رمز الإعداد")}<input dir="ltr" readOnly value={code.setupCode} onFocus={event => event.currentTarget.select()}/></label>
      <p className="note">{t("Expires", "ينتهي في")} <bdi>{displayDate(code.expiresAt, language)}</bdi></p>
      <div className="record-actions">
        <button type="button" className="button primary" onClick={copySetupCode}>{t("Copy code", "نسخ الرمز")}</button>
        <button type="button" className="button" onClick={() => setCode(null)}>{t("Done", "تم")}</button>
        {copyStatus && <span role="status">{copyStatus}</span>}
      </div>
    </section>}
    <section className="panel form-stack" aria-labelledby="staff-accounts">
      <h2 id="staff-accounts">{t("Staff accounts", "حسابات الخدام والمديرين")}</h2>
      {deleted && <p className="notice success" role="status">{t("Staff account deleted.", "تم حذف الحساب.")}</p>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Staff accounts", "حسابات الخدام والمديرين")}>
        <table className="roster-table data-table"><thead><tr>
          <th scope="col">{t("Name", "الاسم")}</th><th scope="col">{t("Role", "الدور")}</th><th scope="col">{t("Actions", "الإجراءات")}</th>
        </tr></thead><tbody>{accounts.map(account => <tr key={account.id}>
          <td><bdi>{account.fullName} ({account.username})</bdi></td>
          <td>{account.role === "SUPER_ADMIN" ? t("Super admin", "مدير النظام") : t("Servant", "خادم")}</td>
          <td>{account.id === currentStaffId ? t("Current account", "الحساب الحالي") :
            <button type="button" className="link-button danger-text" disabled={busy} onClick={() => { setDeleted(false); setDeleting(account); }}>{t("Delete staff account", "حذف الحساب")}</button>}</td>
        </tr>)}</tbody></table>
      </div>
    </section>
    {deleting && <DeleteConfirmation title={t("Delete staff account", "حذف الحساب")} name={deleting.username}
      consequence={t("This permanently removes the staff account, revokes its sessions, and removes its grade assignments.", "سيُحذف الحساب نهائيًا، وتُلغى جلساته والصفوف المسندة إليه.")}
      path={`/admin/staff/${deleting.id}`} t={t} onCancel={() => setDeleting(null)} onDeleted={() => {
        setDeleting(null);
        setAccounts(rows => rows.filter(row => row.id !== deleting.id));
        setStaff(rows => rows.filter(row => row.id !== deleting.id));
        if (staffId === deleting.id) setStaffId("");
        if (code?.username === deleting.username) setCode(null);
        setConfirmReset(false);
        setDeleted(true);

      }}/>}
  </section>;
}
