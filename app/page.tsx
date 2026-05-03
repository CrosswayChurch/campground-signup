"use client";

import React, { useEffect, useMemo, useState } from "react";

type RoleKey = "ADULT_TEACHER" | "CHILDRENS_TEACHER" | "SONG_LEADER" | "MODERATOR" | "ATTENDER";

type RoleDef = {
  key: RoleKey;
  label: string;
  description: string;
  slots: number;
};

type PublicAssignment = {
  id: string;
  role: RoleKey;
  slotIndex: number;
  fullName: string;
};

function pad2(n: number) { return String(n).padStart(2, "0"); }

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

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

  // Signup form state
  const [formOpen, setFormOpen] = useState(false);
  const [formRole, setFormRole] = useState<RoleKey | null>(null);
  const [formSlotIndex, setFormSlotIndex] = useState<number | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [remindBy, setRemindBy] = useState<"EMAIL" | "SMS" | "BOTH" | "NONE">("EMAIL");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load Sundays
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
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load assignments for selected date
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

  function openForm(role: RoleKey, slotIndex: number | null) {
    setFormRole(role);
    setFormSlotIndex(slotIndex);
    setFormOpen(true);
    setFormError(null);
    setSuccessMsg(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setRemindBy("EMAIL");
  }

  function closeForm() {
    setFormOpen(false);
    setFormRole(null);
    setFormSlotIndex(null);
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

    setSubmitting(true);
    try {
      const res = await fetch("/api/signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceDate: selectedDate,
          role: formRole,
          slotIndex: formSlotIndex,
          fullName: name,
          email: e || undefined,
          phone: p || undefined,
          remindBy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data?.error || "Signup failed.");
        return;
      }

      setSuccessMsg(`Thanks, ${name.split(" ")[0]}! You're signed up.`);
      // Refresh
      const r = await fetch(`/api/signups?date=${encodeURIComponent(selectedDate)}`, { cache: "no-store" });
      const d = await r.json();
      setAssignments(Array.isArray(d?.assignments) ? d.assignments : []);
      // Auto-close after a moment
      setTimeout(() => closeForm(), 1400);
    } finally {
      setSubmitting(false);
    }
  }

  // Group assignments by role for rendering
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

  return (
    <div className="publicPage">
      <div className="publicHero">
        <h1 className="publicHeroTitle">Sunday Service Signup</h1>
        <p className="publicHeroSub">
          Pick a Sunday and sign up to fill a role or attend.
        </p>
      </div>

      {/* Sunday picker */}
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

      {/* Roles for selected Sunday */}
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
              const filledList = assignmentsByRole[role.key] || [];
              const filledCount = filledList.length;
              const isFull = filledCount >= role.slots;

              return (
                <div key={role.key} className="roleSection">
                  <div className="roleHeader">
                    <div className="roleHeaderLeft">
                      <div className="roleTitle">{role.label}</div>
                      <div className="roleDesc">{role.description}</div>
                    </div>
                    <div className={["roleCount", isFull ? "full" : ""].filter(Boolean).join(" ")}>
                      {filledCount}/{role.slots} filled
                    </div>
                  </div>

                  <div className="slotList">
                    {Array.from({ length: role.slots }).map((_, i) => {
                      const slotIndex = role.slots === 1 ? 0 : i + 1;
                      const a = findAssignment(role.key, slotIndex);

                      return (
                        <div
                          key={`${role.key}-${slotIndex}`}
                          className={["slot", a ? "filled" : "empty"].join(" ")}
                        >
                          {role.slots > 1 && (
                            <div className="slotIndex">{slotIndex}</div>
                          )}
                          <div className="slotMain">
                            {a ? (
                              <>
                                <div className="slotName">{a.fullName}</div>
                              </>
                            ) : (
                              <div className="slotEmpty">Open</div>
                            )}
                          </div>
                          <div className="slotActions">
                            {!a && (
                              <button
                                className="slotBtn primary"
                                onClick={() =>
                                  openForm(role.key, role.slots === 1 ? null : slotIndex)
                                }
                              >
                                Sign up
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Signup form drawer */}
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
