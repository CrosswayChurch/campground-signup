// lib/roles.ts
// Source of truth for the role structure.

export type RoleKey =
  | "ADULT_TEACHER"
  | "CHILDRENS_TEACHER"
  | "SONG_LEADER"
  | "MODERATOR"
  | "ATTENDER";

export type RoleDef = {
  key: RoleKey;
  label: string;
  description: string;
  slots: number;
};

// Attender cap is 20 — the form will encourage 10–12 but allow up to 20.
export const ATTENDER_CAP = 20;
export const ATTENDER_TARGET_MIN = 10;
export const ATTENDER_TARGET_MAX = 12;

export const ROLES: RoleDef[] = [
  {
    key: "ADULT_TEACHER",
    label: "Adult Teacher",
    description: "Teaches the topic for the adult class",
    slots: 1,
  },
  {
    key: "CHILDRENS_TEACHER",
    label: "Children's Teacher",
    description: "Tells the children's story",
    slots: 1,
  },
  {
    key: "SONG_LEADER",
    label: "Song Leader",
    description: "Leads the singing",
    slots: 1,
  },
  {
    key: "MODERATOR",
    label: "Moderator",
    description: "Moderates the service",
    slots: 1,
  },
  {
    key: "ATTENDER",
    label: "Attenders",
    description: `Plans to attend (aiming for ${ATTENDER_TARGET_MIN}–${ATTENDER_TARGET_MAX})`,
    slots: ATTENDER_CAP,
  },
];

export function totalSlots() {
  return ROLES.reduce((sum, r) => sum + r.slots, 0);
}

export function roleByKey(key: string): RoleDef | undefined {
  return ROLES.find((r) => r.key === key);
}
