"use client";

import React, { useEffect, useMemo, useState } from "react";

type RoleKey = "ADULT_TEACHER" | "CHILDRENS_TEACHER" | "SONG_LEADER" | "MODERATOR" | "ATTENDER";

type AdminAssignment = {
  id: string;
  serviceDate: string;
  role: RoleKey;
  slotIndex: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  remindBy: "EMAIL" | "SMS" | "BOTH" | "NONE";
};

type RoleDef = {
  key: RoleKey;
  label: string;
  description: string;
  slots: number;
};

type SummaryMap = Record<string, number>;

const ROLE_LABELS: Record<RoleKey, string> = {
  ADULT_TEACHER: "Adult Teacher",
  CHILDRENS_TEACHER: "Children's Teacher",
  SONG_LEADER: "Song Leader",
  MODERATOR: "Moderator",
  ATTENDER: "Attenders",
};

const ROLE_ORDER: RoleKey[] = ["ADULT_TEACHER", "CHILDRENS_TEACHER", "SONG_LEADER", "MODERATOR", "ATTENDER"];

function pad2(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fromYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function niceDate(s: string) {
  const d = fromYmd(s);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function buildMonthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export default function AdminPage() {
  const PRIMARY = (process.env.NEXT_PUBLIC_PRIMARY_COLOR || "#568da2").trim();

  useEffect(() => {
    document.documentElement.style.setProperty("--primary", PRIMARY);
  }, [PRIMARY]);

  const [month, setMonth] = useState(() => new Date());
  const gridDays = useMemo(() => buildMonthGrid(month), [month]);
  const [summary, setSummary] = useState<SummaryMap>({});

  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AdminAssignment[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Assign form state (admin assigning someone)
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRole, setAssignRole] = useState<RoleKey | null>(null);
  const [assignSlotIndex, setAssignSlotIndex] = useState<number | null>(null);
  const [aFullName, setAFullName] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aPhone, setAPhone] = useState("");
  const [aRemindBy, setARemindBy] = useState<"EMAIL" | "SMS" | "BOTH" | "NONE">("EMAIL");
  const [aSubmitting, setASubmitting] = useState(false);

  const monthLabel = useMemo(() => {
    return month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [month]);

  function prevMonth() { setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1)); }
  function nextMonth() { setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1)); }

  async function refreshSummary() {
    try {
      const key = monthKey(month);
      const res = await fetch(`/api/signups/summary?month=${encodeURIComponent(key)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setSummary(data?.summary || {});
    } catch {
      // ignore
    }
  }

  async function loadRoles() {
    try {
      const res = await fetch(`/api/signups?date=${encodeURIComponent(ymd(new Date()))}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.roles)) setRoles(data.roles);
    } catch {
      // ignore
    }
  }

  // Auto-unlock if cookie still valid
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/signups`, { cache: "no-store" });
        if (res.ok) {
          setAuthed(true);
          await refreshSummary();
          await loadRoles();
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, month]);

  async function login() {
    setPwError(null);
    const v = pw.trim();
    if (!v) return setPwError("Enter the admin password.");
    setPwLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: v }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(data?.error || "Incorrect password.");
        return;
      }
      setAuthed(true);
      setPw("");
      setPwError(null);
      await refreshSummary();
      await loadRoles();
    } finally {
      setPwLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      setAuthed(false);
      setPw("");
      setPwError(null);
      setDrawerOpen(false);
      setSelectedDate("");
      setRows([]);
      setError(null);
    }
  }

  async function openDate(s: string) {
    setSelectedDate(s);
    setDrawerOpen(true);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/signups?date=${encodeURIComponent(s)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setAuthed(false);
          setDrawerOpen(false);
          setPwError("Session expired. Please log in again.");
          return;
        }
        setError(data?.error || "Failed to load.");
        setRows([]);
        return;
      }
      setRows(Array.isArray(data?.assignments) ? data.assignments : []);
      const r2 = await fetch(`/api/signups?date=${encodeURIComponent(s)}`, { cache: "no-store" });
      const d2 = await r2.json().catch(() => ({}));
      if (Array.isArray(d2?.roles)) setRoles(d2.roles);
    } finally {
      setLoading(false);
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setSelectedDate("");
    setRows([]);
    setError(null);
    setAssignOpen(false);
  }

  function startAssign(role: RoleKey, slotIndex: number | null) {
    setAssignRole(role);
    setAssignSlotIndex(slotIndex);
    setAssignOpen(true);
    setAFullName("");
    setAEmail("");
    setAPhone("");
    setARemindBy("EMAIL");
    setError(null);
  }

  function cancelAssign() {
    setAssignOpen(false);
    setAssignRole(null);
    setAssignSlotIndex(null);
  }

  async function submitAssign() {
    if (!assignRole || !selectedDate) return;
    setError(null);
    const name = aFullName.trim();
    if (name.length < 2) { setError("Name is too short."); return; }

    setASubmitting(true);
    try {
      const res = await fetch("/api/admin/signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceDate: selectedDate,
          role: assignRole,
          slotIndex: assignSlotIndex,
          fullName: name,
          email: aEmail.trim() || undefined,
          phone: aPhone.trim() || undefined,
          remindBy: aRemindBy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to assign.");
        return;
      }
      cancelAssign();
      await openDate(selectedDate);
      await refreshSummary();
    } finally {
      setASubmitting(false);
    }
  }

  async function deleteAssignment(id: string) {
    if (!confirm("Remove this person from the slot?")) return;
    try {
      const res = await fetch(`/api/admin/signups?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setAuthed(false);
          closeDrawer();
          setPwError("Session expired. Please log in again.");
          return;
        }
        setError(data?.error || "Delete failed.");
        return;
      }
      await openDate(selectedDate);
      await refreshSummary();
    } catch {
      setError("Delete failed.");
    }
  }

  const rowsByRole = useMemo(() => {
    const map: Record<string, AdminAssignment[]> = {};
    for (const r of rows) {
      if (!map[r.role]) map[r.role] = [];
      map[r.role].push(r);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.slotIndex - b.slotIndex);
    }
    return map;
  }, [rows]);

  function findRow(role: RoleKey, slotIndex: number) {
    return rowsByRole[role]?.find((a) => a.slotIndex === slotIndex) || null;
  }

  return (
    <div className="adminPage">
      {!authed ? (
        <div className="adminGate">
          <div className="adminGateCard">
            <div className="adminGateTitle">Admin</div>
            <div className="adminGateSub">Enter password to manage signups</div>
            <input
              className="adminGateInput"
              type="password"
              placeholder="Admin password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") login(); }}
              autoFocus
            />
            {pwError && <div className="adminGateError">{pwError}</div>}
            <button className="adminGateBtn" onClick={login} disabled={pwLoading}>
              {pwLoading ? "Checking…" : "Enter"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="adminTop">
        <div>
          <div className="adminTitle">Admin</div>
          <div className="adminSub">Click a Sunday to manage role signups</div>
        </div>
        <button className="adminBtn" onClick={logout}>Logout</button>
      </div>

      <div className="adminCard">
        <div className="adminMonthNav">
          <button className="adminIconBtn" onClick={prevMonth} aria-label="Previous month">‹</button>
          <div className="adminMonthPill">{monthLabel}</div>
          <button className="adminIconBtn" onClick={nextMonth} aria-label="Next month">›</button>
        </div>

        <div className="adminDow">
          {["S","M","T","W","T","F","S"].map((d, i) => (
            <div key={i} className="adminDowCell">{d}</div>
          ))}
        </div>

        <div className="adminGrid">
          {gridDays.map((d) => {
            const dayYmd = ymd(d);
            const inMonth = d.getMonth() === month.getMonth();
            const isSunday = d.getDay() === 0;
            const count = summary[dayYmd] || 0;

            return (
              <button
                key={dayYmd}
                className={[
                  "adminDay",
                  inMonth ? "" : "muted",
                  selectedDate === dayYmd && drawerOpen ? "selected" : "",
                  !isSunday ? "muted" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => isSunday && openDate(dayYmd)}
                disabled={!isSunday}
                type="button"
              >
                <div className="adminDayNum">{d.getDate()}</div>
                {count > 0 && isSunday ? <div className="adminBadge">{count}</div> : null}
              </button>
            );
          })}
        </div>

        <div className="adminHint">Badges show how many slots are filled. Click any Sunday to manage.</div>
      </div>

      {/* Drawer */}
      <div className={["drawerOverlay", drawerOpen ? "open" : ""].join(" ")} onClick={closeDrawer} />

      <div className={["drawer", drawerOpen ? "open" : ""].join(" ")}>
        <div className="drawerHeader">
          <div>
            <div className="drawerTitle">{selectedDate ? niceDate(selectedDate) : "Manage"}</div>
            <div className="drawerSub">
              {loading ? "Loading…" : `${rows.length} slot(s) filled`}
            </div>
          </div>
          <button className="iconBtn" onClick={closeDrawer} aria-label="Close">✕</button>
        </div>

        <div className="drawerBody">
          {error && <div className="formError" style={{ marginBottom: 12 }}>{error}</div>}

          {assignOpen ? (
            <div className="signupForm">
              <div className="sectionLabel">
                Assign someone to {assignRole ? ROLE_LABELS[assignRole] : ""}
                {assignSlotIndex ? ` · slot ${assignSlotIndex}` : ""}
              </div>

              <div className="formField">
                <label className="formLabel">Full name</label>
                <input className="formInput" value={aFullName} onChange={(e) => setAFullName(e.target.value)} />
              </div>
              <div className="formField">
                <label className="formLabel">Email</label>
                <input className="formInput" type="email" value={aEmail} onChange={(e) => setAEmail(e.target.value)} />
              </div>
              <div className="formField">
                <label className="formLabel">Phone</label>
                <input className="formInput" type="tel" value={aPhone} onChange={(e) => setAPhone(e.target.value)} placeholder="+1 555 555 5555" />
              </div>
              <div className="formField">
                <label className="formLabel">Reminders</label>
                <div className="radioGroup">
                  {(["EMAIL","SMS","BOTH","NONE"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={["radioOption", aRemindBy === opt ? "selected" : ""].filter(Boolean).join(" ")}
                      onClick={() => setARemindBy(opt)}
                    >
                      {opt === "EMAIL" ? "Email" : opt === "SMS" ? "Text" : opt === "BOTH" ? "Both" : "None"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="formActions">
                <button className="btn" onClick={cancelAssign} disabled={aSubmitting}>Cancel</button>
                <button className="btnPrimary" onClick={submitAssign} disabled={aSubmitting}>
                  {aSubmitting ? "Saving…" : "Assign"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {ROLE_ORDER.map((roleKey) => {
                const def = roles.find((r) => r.key === roleKey);
                if (!def) return null;
                const filled = rowsByRole[roleKey] || [];

                return (
                  <div key={roleKey} className="roleSection">
                    <div className="roleHeader">
                      <div className="roleHeaderLeft">
                        <div className="roleTitle">{def.label}</div>
                        <div className="roleDesc">{def.description}</div>
                      </div>
                      <div className={["roleCount", filled.length >= def.slots ? "full" : ""].filter(Boolean).join(" ")}>
                        {filled.length}/{def.slots}
                      </div>
                    </div>

                    <div className="slotList">
                      {Array.from({ length: def.slots }).map((_, i) => {
                        const slotIndex = def.slots === 1 ? 0 : i + 1;
                        const a = findRow(roleKey, slotIndex);
                        return (
                          <div key={`${roleKey}-${slotIndex}`} className={["slot", a ? "filled" : "empty"].join(" ")}>
                            {def.slots > 1 && <div className="slotIndex">{slotIndex}</div>}
                            <div className="slotMain">
                              {a ? (
                                <>
                                  <div className="slotName">{a.fullName}</div>
                                  <div className="slotMeta">
                                    {a.email || ""}{a.email && a.phone ? " · " : ""}{a.phone || ""}
                                    {a.remindBy !== "EMAIL" ? ` · ${a.remindBy.toLowerCase()}` : ""}
                                  </div>
                                </>
                              ) : (
                                <div className="slotEmpty">Open</div>
                              )}
                            </div>
                            <div className="slotActions">
                              {a ? (
                                <button className="slotBtn danger" onClick={() => deleteAssignment(a.id)}>Remove</button>
                              ) : (
                                <button
                                  className="slotBtn primary"
                                  onClick={() => startAssign(roleKey, def.slots === 1 ? null : slotIndex)}
                                >
                                  Assign
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
