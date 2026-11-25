"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorText, json, type Grade, type Principal, type Theme, type Translate } from "../api";
import { Icon } from "./ui-icon";

type Name = { id: string; displayLabel: string };
type Mode = "login" | "activate";

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)));
}

export function SignIn({ staff, theme, t, onSignIn }: {
  staff: boolean; theme: Theme; t: Translate; onSignIn: (principal: Principal) => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [grades, setGrades] = useState<Grade[]>([]);
  const [names, setNames] = useState<Name[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [lookup, setLookup] = useState<"loading" | "ready" | "error">("loading");
  const [nameLookup, setNameLookup] = useState<"loading" | "ready" | "error">("ready");
  const [retry, setRetry] = useState(0);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [credential, setCredential] = useState("");
  const [confirm, setConfirm] = useState("");
  const [credentialChecked, setCredentialChecked] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const activating = mode === "activate";
  const validPin = /^[0-9]{6}$/.test(credential);
  const validStaffCredential = credential.length === 6 || (!activating && credential.length >= 12);
  const credentialInvalid = staff ? !validStaffCredential : !validPin;
  const confirmationInvalid = activating && confirm !== credential;

  function normalizeCredential(value: string) {
    return !staff || /^[0-9٠-٩۰-۹]{6}$/.test(value) ? normalizeDigits(value) : value;
  }

  useEffect(() => {
    if (staff) return;
    const controller = new AbortController();
    api<Grade[]>("/auth/grades", { signal: controller.signal }).then((grades) => {
      setGrades(grades);
      setLookup("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setLookup("error");
    });
    return () => controller.abort();
  }, [staff, retry]);

  useEffect(() => {
    if (!gradeId) return;
    const controller = new AbortController();
    api<Name[]>(`/auth/grades/${gradeId}/students`, { signal: controller.signal }).then((names) => {
      setNames(names);
      setNameLookup("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setNameLookup("error");
    });
    return () => controller.abort();
  }, [gradeId, retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCredentialChecked(true);
    setConfirmationChecked(activating);
    if (credentialInvalid || confirmationInvalid) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const request = staff
      ? { username: String(form.get("username")).trim(), password: normalizeCredential(credential),
          ...(activating ? { setupCode: String(form.get("activationCode")).trim() } : {}) }
      : { gradeId, studentId, pin: credential, ...(activating ? { activationCode: String(form.get("activationCode")).trim() } : {}) };
    try {
      const principal = await api<Principal>(`/auth/${staff ? (activating ? "staff-setup" : "staff-login") : mode}`, json("POST", request));
      onSignIn(principal);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  const action = activating
    ? staff ? t("Save and sign in", "حفظ وتسجيل الدخول") : t("Activate account", "تفعيل الحساب")
    : t("Sign in", "تسجيل الدخول");
  const credentialHint = staff
    ? activating ? t("Enter exactly six characters, or six digits for a PIN.", "أدخل ستة أحرف بالضبط، أو ستة أرقام للرمز.")
      : t("Enter your password or six-digit PIN.", "أدخل كلمة المرور أو الرمز المكوّن من ستة أرقام.")
    : t("Enter exactly six digits.", "أدخل ستة أرقام بالضبط.");
  return <main id="main-content" className="entry">
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-copy">
        <h1 id="welcome-title">{t("Sunday School", "مسابقة مدارس") }<br/><em>{t("Competition", "الأحد")}</em></h1>
        <p>{theme === "christmas"
          ? t("Celebrate the Nativity with your Sunday School community.", "احتفل بعيد الميلاد مع أسرة مدارس الأحد.")
          : t("Join your Sunday School community for this year’s competition.", "شارك أسرة مدارس الأحد في مسابقة هذا العام.")}</p>
      </div>
      <div className="welcome-art" aria-hidden="true"/>
    </section>

    <section className="entry-card" aria-labelledby="entry-heading">
      <div className="entry-modes" aria-label={staff ? t("Staff account", "حساب الخادم") : t("Student account", "حساب الطالب")}>
        {(["login", "activate"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => {
          setMode(value);
          setShow(false);
          setError(null);
          setCredential("");
          setConfirm("");
          setCredentialChecked(false);
          setConfirmationChecked(false);
        }}>{value === "login" ? t("Sign in", "تسجيل الدخول") : staff ? t("Set up or reset", "إعداد أو إعادة ضبط") : t("First time?", "أول مرة؟")}</button>)}
      </div>
      <h2 id="entry-heading">{staff ? (activating ? t("Set your PIN or password", "اضبط الرمز أو كلمة المرور") : t("Staff sign in", "دخول الخدام")) : activating ? t("Activate your account", "فعّل حسابك") : t("Welcome back", "مرحبًا بعودتك")}</h2>
      <p className="entry-description">{staff
        ? activating ? t("Enter the one-time setup code from your Super Admin.", "أدخل رمز الإعداد الذي أرسله مدير النظام.")
          : t("Use your staff username and PIN or password.", "استخدم اسم المستخدم والرمز أو كلمة المرور.")
        : activating
          ? t("Use the one-time password given to you by your servant.", "استخدم كلمة المرور لمرة واحدة التي أعطاها لك خادمك.")
          : t("Choose your grade and name, then enter your six-digit PIN.", "اختر صفك واسمك، ثم أدخل رمزك المكوّن من ستة أرقام.")}</p>
      <form className="form-stack" key={mode} onSubmit={submit}>
        {staff ? <label>{t("Username", "اسم المستخدم")}<input name="username" autoComplete="username" autoCapitalize="none" dir="auto" required disabled={busy} /></label> : <>
          <label>{t("Grade", "الصف الدراسي")}
            <div className="select-wrap"><select value={gradeId} onChange={(event) => {
              const value = event.target.value;
              setGradeId(value);
              setStudentId("");
              setNames([]);
              setError(null);
              setNameLookup(value ? "loading" : "ready");
            }} required disabled={lookup !== "ready" || busy}>
              <option value="">{lookup === "loading" ? t("Loading grades…", "جارٍ تحميل الصفوف…") : t("Choose your grade", "اختر صفك الدراسي")}</option>
              {grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
            </select><Icon name="down" size={17}/></div>
          </label>
          <label>{t("Your name", "اسمك")}
            <div className="select-wrap"><select value={studentId} onChange={(event) => { setStudentId(event.target.value); setError(null); }} required disabled={!gradeId || nameLookup !== "ready" || busy}>
              <option value="">{nameLookup === "loading" ? t("Loading names…", "جارٍ تحميل الأسماء…") : t("Choose your name", "اختر اسمك")}</option>
              {names.map((name) => <option key={name.id} value={name.id}>{name.displayLabel}</option>)}
            </select><Icon name="down" size={17}/></div>
          </label>
          {(lookup === "error" || nameLookup === "error") && <div role="alert" className="notice error">
            {t("Could not load the school roster.", "تعذر تحميل قائمة الطلاب.")}{" "}
            <button className="link-button" type="button" onClick={() => {
              if (lookup === "error") setLookup("loading");
              if (nameLookup === "error") setNameLookup("loading");
              setRetry((value) => value + 1);
            }}>{t("Try again", "حاول مجددًا")}</button>
          </div>}
          {gradeId && nameLookup === "ready" && names.length === 0 && <p className="note">{t("This grade has no names to display. Check with your servant.", "لا توجد أسماء في هذا الصف. تواصل مع خادمك.")}</p>}
        </>}
        {activating && <label>{staff ? t("One-time setup code", "رمز الإعداد لمرة واحدة") : t("One-time password", "كلمة المرور لمرة واحدة")}<input name="activationCode" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} required disabled={busy} dir="ltr" /></label>}
        <label htmlFor="entry-password">{staff ? t("PIN or password", "الرمز أو كلمة المرور") : activating ? t("Choose a 6-digit PIN", "اختر رمزًا من ٦ أرقام") : t("6-digit PIN", "الرمز المكوّن من ٦ أرقام")}</label>
        <div className="password-wrap">
          <input id="entry-password" name={staff ? "password" : "pin"} type={show ? "text" : "password"} inputMode={staff ? undefined : "numeric"}
            maxLength={128} autoComplete={activating ? "new-password" : "current-password"}
            value={credential} onChange={event => {
              setCredential(staff && !activating ? event.target.value : normalizeCredential(event.target.value));
              setError(null);
            }}
            onBlur={() => setCredentialChecked(true)} aria-invalid={credentialChecked && credentialInvalid}
            aria-describedby={credentialChecked && credentialInvalid ? "credential-error" : undefined}
            required disabled={busy} dir="ltr" />
          <button type="button" aria-label={show ? t("Hide password", "أخفِ كلمة المرور") : t("Show password", "أظهر كلمة المرور")} onClick={() => setShow(!show)}><Icon name={show ? "hide" : "eye"} size={19}/></button>
        </div>
        {credentialChecked && credentialInvalid && <p id="credential-error" className="notice error" role="alert">{credentialHint}</p>}
        {activating && <label>{staff ? t("Confirm PIN or password", "أكّد الرمز أو كلمة المرور") : t("Confirm PIN", "أكّد الرمز")}
          <input name="confirmCredential" type={show ? "text" : "password"} inputMode={staff ? undefined : "numeric"} maxLength={128}
            autoComplete="new-password" dir="ltr" value={confirm}
            onChange={event => setConfirm(normalizeCredential(event.target.value))}
            onBlur={() => setConfirmationChecked(true)} aria-invalid={confirmationChecked && confirmationInvalid}
            aria-describedby={confirmationChecked && confirmationInvalid ? "credential-mismatch" : undefined} required disabled={busy}/>
        </label>}
        {confirmationChecked && confirmationInvalid && <p id="credential-mismatch" className="notice error" role="alert">{t("The two entries don’t match.", "القيمتان غير متطابقتين.")}</p>}
        {error ? <p role="alert" className="notice error">{errorText(error, t, true)}</p> : null}
        <button className="button primary entry-submit" disabled={busy || (!staff && !studentId)}>
          {busy ? t("Please wait…", "يرجى الانتظار…") : action}<span className="directional"><Icon name="arrow" size={19}/></span>
        </button>
      </form>
      {!staff && <p className="entry-help">{activating ? t("Need a one-time password? Ask your servant.", "تحتاج كلمة مرور لمرة واحدة؟ اسأل خادمك.") : t("Forgot your PIN? Ask your servant to reset it.", "نسيت الرمز؟ اطلب من خادمك إعادة ضبطه.")}</p>}
      {staff && <p className="entry-help">{activating ? t("Need a new setup code? Ask your Super Admin.", "تحتاج رمز إعداد جديدًا؟ اطلبه من مدير النظام.") : t("Forgot your PIN or password? Ask your Super Admin for a setup code.", "نسيت الرمز أو كلمة المرور؟ اطلب رمز إعداد من مدير النظام.")}</p>}
      {staff && <Link className="entry-help" href="/">{t("Back to student sign in", "العودة إلى دخول الطلاب")}</Link>}
    </section>
  </main>;
}
