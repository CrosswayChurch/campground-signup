"use client";

import React, { useEffect, useMemo, useState } from "react";

type RoleKey = "ADULT_TEACHER" | "CHILDRENS_TEACHER" | "SONG_LEADER" | "MODERATOR" | "ATTENDER";

type RoleDef = {
  key: RoleKey;
  label: string;
  description: string;
  slots: number;
  multipleEntries?: boolean;
};

type PublicAssignment = {
  id: string;
  role: RoleKey;
  slotIndex: number;
  fullName: string;
  partySize: number;
};

function pad2(n: number) { return String(n).padStart(2, "0"); }

function fromYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function niceDate(s: string) {
  const d = fromYmd(s);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function PublicSignupPage() {
  const PRIMARY = (process.env.NEXT_PUBLIC_PRIMARY_COLOR || "#568da2").trim();

  useEffect(() => {
    document.documentElement.style.setProperty("--primary", PRIMARY);
  }, [PRIMARY]);

  const [sundays, setSundays] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [assignments, setAssignments] = useState<PublicAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formRole, setFormRole] = useState<RoleKey | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [remindBy, setRemindBy] = useState<"EMAIL" | "SMS" | "BOTH" | "NONE">("EMAIL");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/schedule", { cache: "no-store" });
        const data = await res.json();
        const list: string[] = Array.isArray(data?.sundays) ? data.sundays : [];
        setSundays(list);
        if (list.length > 0 && !selectedDate) {
          setSelectedDate(list[0]);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/signups?date=${encodeURIComponent(selectedDate)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        setAssignments(Array.isArray(data?.assignments) ? data.assignments : []);
        if (Array.isArray(data?.roles)) setRoles(data.roles);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDate]);

  function openForm(role: RoleKey) {
    setFormRole(role);
    setFormOpen(true);
    setFormError(null);
    setSuccessMsg(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setPartySize(1);
    setRemindBy("EMAIL");
  }

  function closeForm() {
    setFormOpen(false);
    setFormRole(null);
    setFormError(null);
  }

  async function submitSignup() {
    if (!formRole || !selectedDate) return;
    setFormError(null);

    const name = fullName.trim();
    const e = email.trim();
    const p = phone.trim();

    if (name.length < 2) { setFormError("Please enter your full name."); return; }
    if (!e && !p) { setFormError("Please enter an email or phone number."); return; }
    if ((remindBy === "EMAIL" || remindBy === "BOTH") && !e) {
      setFormError("Email is required for email reminders.");
      return;
    }
    if ((remindBy === "SMS" || remindBy === "BOTH") && !p) {
      setFormError("Phone is required for text reminders.");
      return;
    }

    const isAttender = formRole === "ATTENDER";
    if (isAttender && (!Number.isFinite(partySize) || partySize < 1)) {
      setFormError("Please enter how many people are attending.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceDate: selectedDate,
          role: formRole,
          fullName: name,
          email: e || undefined,
          phone: p || undefined,
          partySize: isAttender ? partySize : 1,
          remindBy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data?.error || "Signup failed.");
        return;
      }

      setSuccessMsg(`Thanks, ${name.split(" ")[0]}! You're signed up.`);
      const r = await fetch(`/api/signups?date=${encodeURIComponent(selectedDate)}`, { cache: "no-store" });
      const d = await r.json();
      setAssignments(Array.isArray(d?.assignments) ? d.assignments : []);
      setTimeout(() => closeForm(), 1400);
    } finally {
      setSubmitting(false);
    }
  }

  const assignmentsByRole = useMemo(() => {
    const map: Record<string, PublicAssignment[]> = {};
    for (const a of assignments) {
      if (!map[a.role]) map[a.role] = [];
      map[a.role].push(a);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((x, y) => x.slotIndex - y.slotIndex);
    }
    return map;
  }, [assignments]);

  function findAssignment(role: RoleKey, slotIndex: number) {
    return assignmentsByRole[role]?.find((a) => a.slotIndex === slotIndex) || null;
  }

  function attenderSeatsUsed(): number {
    return (assignmentsByRole["ATTENDER"] || []).reduce((s, a) => s + (a.partySize || 1), 0);
  }

  const attenderRoleDef = roles.find((r) => r.key === "ATTENDER");
  const attenderUsed = attenderSeatsUsed();
  const attenderCap = attenderRoleDef?.slots || 20;
  const attenderRemaining = Math.max(0, attenderCap - attenderUsed);
  const attenderFull = attenderRemaining <= 0;

  return (
    <div className="publicPage">
      <div className="publicHero">
        <h1 className="publicHeroTitle">Sunday Service Signup</h1>
        <p className="publicHeroSub">
          Pick a Sunday and sign up to fill a role or attend.
        </p>
      </div>

      <div className="sundayPicker">
        <div className="sundayPickerInner">
          <div className="sectionLabel" style={{ paddingLeft: 6, marginBottom: 8 }}>
            Choose a Sunday
          </div>
          <div className="sundayList">
            {sundays.slice(0, 12).map((s) => {
              const d = fromYmd(s);
              const monthShort = d.toLocaleDateString(undefined, { month: "short" });
              const isSel = s === selectedDate;
              return (
                <button
                  key={s}
                  className={["sundayPill", isSel ? "selected" : ""].filter(Boolean).join(" ")}
                  onClick={() => setSelectedDate(s)}
                  type="button"
                >
                  <div className="sundayPillTop">Sun</div>
                  <div className="sundayPillDay">{d.getDate()}</div>
                  <div className="sundayPillMonth">{monthShort} {d.getFullYear()}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="publicCard">
        <div className="publicCardInner">
          <div style={{ marginBottom: 6 }}>
            <div className="sectionLabel">Service date</div>
            <div style={{ fontWeight: 1100, fontSize: 18, marginTop: 2 }}>
              {selectedDate ? niceDate(selectedDate) : "—"}
            </div>
          </div>

          {loading ? (
            <div className="emptyState" style={{ marginTop: 14 }}>Loading…</div>
          ) : (
            roles.map((role) => {
              if (role.multipleEntries) {
                const families = assignmentsByRole[role.key] || [];
                return (
                  <div key={role.key} className="roleSection">
                    <div className="roleHeader">
                      <div className="roleHeaderLeft">
                        <div className="roleTitle">{role.label}</div>
                        <div className="roleDesc">{role.description}</div>
                      </div>
                      <div className="roleCount">
                        {attenderUsed} attending
                      </div>
                    </div>

                    <div className="slotList">
                      {families.length === 0 ? (
                        <div className="slot empty">
                          <div className="slotMain">
                            <div className="slotEmpty">No one signed up yet — be the first!</div>
                          </div>
                        </div>
                      ) : (
                        families.map((a) => (
                          <div key={a.id} className="slot filled">
                            <div className="slotMain">
                              <div className="slotName">{a.fullName}</div>
                              <div className="slotMeta">
                                {a.partySize} {a.partySize === 1 ? "person" : "people"}
                              </div>
                            </div>
                          </div>
                        ))
                      )}

                      <div className="slot empty">
                        <div className="slotMain">
                          <div className="slotEmpty">
                            {attenderFull
                              ? "Signups are closed for this Sunday"
                              : "Add your name to attend"}
                          </div>
                        </div>
                        <div className="slotActions">
                          <button
                            className="slotBtn primary"
                            disabled={attenderFull}
                            onClick={() => openForm(role.key)}
                          >
                            Sign up to attend
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              const a = findAssignment(role.key, 0);
              const isFilled = !!a;

              return (
                <div key={role.key} className="roleSection">
                  <div className="roleHeader">
                    <div className="roleHeaderLeft">
                      <div className="roleTitle">{role.label}</div>
                      <div className="roleDesc">{role.description}</div>
                    </div>
                    <div className={["roleCount", isFilled ? "full" : ""].filter(Boolean).join(" ")}>
                      {isFilled ? "1/1 filled" : "0/1 filled"}
                    </div>
                  </div>

                  <div className="slotList">
                    <div className={["slot", isFilled ? "filled" : "empty"].join(" ")}>
                      <div className="slotMain">
                        {a ? (
                          <div className="slotName">{a.fullName}</div>
                        ) : (
                          <div className="slotEmpty">Open</div>
                        )}
                      </div>
                      <div className="slotActions">
                        {!a && (
                          <button
                            className="slotBtn primary"
                            onClick={() => openForm(role.key)}
                          >
                            Sign up
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div
        className={["drawerOverlay", formOpen ? "open" : ""].join(" ")}
        onClick={closeForm}
      />
      <div className={["drawer", formOpen ? "open" : ""].join(" ")}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">
              {formRole ? (roles.find(r => r.key === formRole)?.label || "Sign up") : "Sign up"}
            </div>
            <div className="drawerSub">
              {selectedDate ? niceDate(selectedDate) : ""}
            </div>
          </div>
          <button className="iconBtn" onClick={closeForm} aria-label="Close">✕</button>
        </div>

        <div className="drawerBody">
          <div className="signupForm">
            {formError && <div className="formError">{formError}</div>}
            {successMsg && <div className="formSuccess">{successMsg}</div>}

            <div className="formField">
              <label className="formLabel">Full name</label>
              <input
                className="formInput"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>

            {formRole === "ATTENDER" && (
              <div className="formField">
                <label className="formLabel">How many people are attending?</label>
                <input
                  className="formInput"
                  type="number"
                  min={1}
                  max={attenderRemaining || 1}
                  value={partySize}
                  onChange={(e) => setPartySize(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                />
                <div className="formHelp">
                  Include yourself in the count.
                </div>
              </div>
            )}

            <div className="formField">
              <label className="formLabel">Email</label>
              <input
                className="formInput"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <div className="formHelp">Used for email reminders.</div>
            </div>

            <div className="formField">
              <label className="formLabel">Phone (for text reminders)</label>
              <input
                className="formInput"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 555 5555"
              />
              <div className="formHelp">Optional. Include country code (e.g. +1).</div>
            </div>

            <div className="formField">
              <label className="formLabel">How would you like reminders?</label>
              <div className="radioGroup">
                {(["EMAIL", "SMS", "BOTH", "NONE"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={["radioOption", remindBy === opt ? "selected" : ""].filter(Boolean).join(" ")}
                    onClick={() => setRemindBy(opt)}
                  >
                    {opt === "EMAIL" ? "Email" : opt === "SMS" ? "Text" : opt === "BOTH" ? "Both" : "None"}
                  </button>
                ))}
              </div>
              <div className="formHelp">We send reminders 3 days before and the day before.</div>
            </div>

            <div className="formActions">
              <button className="btn" onClick={closeForm} disabled={submitting}>Cancel</button>
              <button className="btnPrimary" onClick={submitSignup} disabled={submitting}>
                {submitting ? "Signing up…" : "Sign me up"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
