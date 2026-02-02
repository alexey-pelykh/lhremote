/**
 * Core people/profile types derived from LinkedHelper's SQLite schema.
 *
 * Root entity: `people` table (1:1 with mini-profile, 1:N with positions,
 * education, skills, emails, external IDs).
 */

export interface MiniProfile {
  firstName: string;
  lastName: string | null;
  headline: string | null;
  avatar: string | null;
}

export type ExternalIdTypeGroup = "member" | "public" | "hash" | "avatar";

export interface ExternalId {
  externalId: string;
  typeGroup: ExternalIdTypeGroup;
  isMemberId: boolean;
}

export interface Position {
  company: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface CurrentPosition {
  company: string | null;
  title: string | null;
}

export interface Education {
  school: string | null;
  degree: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface Skill {
  name: string;
}

export interface Profile {
  id: number;
  miniProfile: MiniProfile;
  externalIds: ExternalId[];
  currentPosition: CurrentPosition | null;
  positions: Position[];
  education: Education[];
  skills: Skill[];
  emails: string[];
}
