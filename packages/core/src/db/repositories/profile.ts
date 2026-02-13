// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type {
  CurrentPosition,
  Education,
  ExternalId,
  ExternalIdTypeGroup,
  MiniProfile,
  Position,
  Profile,
  ProfileSearchOptions,
  ProfileSearchResult,
  ProfileSummary,
  Skill,
} from "../../types/index.js";
import type { DatabaseClient } from "../client.js";
import { ProfileNotFoundError } from "../errors.js";
import { escapeLike } from "../escape-like.js";

interface ProfileSearchRow {
  id: number;
  first_name: string;
  last_name: string | null;
  headline: string | null;
  company: string | null;
  title: string | null;
  total: number;
}

interface MiniProfileRow {
  first_name: string;
  last_name: string | null;
  headline: string | null;
  avatar: string | null;
}

interface ExternalIdRow {
  external_id: string;
  type_group: string;
  is_member_id: number | null;
}

interface CurrentPositionRow {
  company: string | null;
  position: string | null;
}

interface PositionRow {
  company_name: string;
  title: string;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_default: number | null;
}

interface EducationRow {
  school_name: string;
  degree_name: string | null;
  field_of_study: string | null;
  start_year: number | null;
  end_year: number | null;
}

interface SkillRow {
  name: string;
}

interface EmailRow {
  email: string;
}

function formatDate(
  year: number | null,
  month: number | null,
): string | null {
  if (year == null) return null;
  if (month == null) return String(year);
  return `${String(year)}-${String(month).padStart(2, "0")}`;
}

/**
 * Read-only repository for assembling {@link Profile} objects from
 * LinkedHelper's SQLite database.
 */
export class ProfileRepository {
  private readonly stmtPersonById;
  private readonly stmtPersonByPublicId;
  private readonly stmtMiniProfile;
  private readonly stmtExternalIds;
  private readonly stmtCurrentPosition;
  private readonly stmtPositions;
  private readonly stmtEducation;
  private readonly stmtSkills;
  private readonly stmtEmails;
  private readonly stmtSearch;

  constructor(client: DatabaseClient) {
    const { db } = client;

    this.stmtPersonById = db.prepare(
      "SELECT id FROM people WHERE id = ?",
    );

    this.stmtPersonByPublicId = db.prepare(
      `SELECT p.id
       FROM people p
       JOIN person_external_ids pei ON p.id = pei.person_id
       WHERE pei.type_group = 'public' AND pei.external_id = ?`,
    );

    this.stmtMiniProfile = db.prepare(
      `SELECT first_name, last_name, headline, avatar
       FROM person_mini_profile WHERE person_id = ?`,
    );

    this.stmtExternalIds = db.prepare(
      `SELECT external_id, type_group, is_member_id
       FROM person_external_ids WHERE person_id = ?`,
    );

    this.stmtCurrentPosition = db.prepare(
      `SELECT company, position
       FROM person_current_position WHERE person_id = ?`,
    );

    this.stmtPositions = db.prepare(
      `SELECT company_name, title, start_year, start_month,
              end_year, end_month, is_default
       FROM person_positions WHERE person_id = ?`,
    );

    this.stmtEducation = db.prepare(
      `SELECT school_name, degree_name, field_of_study, start_year, end_year
       FROM person_education WHERE person_id = ?`,
    );

    this.stmtSkills = db.prepare(
      `SELECT s.name
       FROM person_skill ps
       JOIN skills s ON ps.skill_id = s.id
       WHERE ps.person_id = ?`,
    );

    this.stmtEmails = db.prepare(
      `SELECT email FROM person_email WHERE person_id = ?`,
    );

    this.stmtSearch = db.prepare(
      `SELECT
         p.id,
         mp.first_name,
         mp.last_name,
         mp.headline,
         cp.company,
         cp.position AS title,
         COUNT(*) OVER() AS total
       FROM people p
       LEFT JOIN person_mini_profile mp ON p.id = mp.person_id
       LEFT JOIN person_current_position cp ON p.id = cp.person_id
       WHERE (? IS NULL OR mp.first_name LIKE ? ESCAPE '\\' OR mp.last_name LIKE ? ESCAPE '\\' OR mp.headline LIKE ? ESCAPE '\\')
         AND (? IS NULL OR cp.company LIKE ? ESCAPE '\\')
       ORDER BY mp.first_name, mp.last_name
       LIMIT ? OFFSET ?`,
    );
  }

  /**
   * Looks up a profile by its internal database ID.
   *
   * @throws {ProfileNotFoundError} if no person exists with the given ID.
   */
  findById(id: number): Profile {
    const row = this.stmtPersonById.get(id) as { id: number } | undefined;
    if (!row) throw new ProfileNotFoundError(id);
    return this.assembleProfile(row.id);
  }

  /**
   * Looks up a profile by LinkedIn public ID (the slug from a profile URL).
   *
   * @throws {ProfileNotFoundError} if no person matches the public ID.
   */
  findByPublicId(slug: string): Profile {
    const row = this.stmtPersonByPublicId.get(slug) as
      | { id: number }
      | undefined;
    if (!row) throw new ProfileNotFoundError(slug);
    return this.assembleProfile(row.id);
  }

  /**
   * Search for profiles by name, headline, or company.
   */
  search(options: ProfileSearchOptions = {}): ProfileSearchResult {
    const { query, company, limit = 20, offset = 0 } = options;

    const queryPattern = query ? `%${escapeLike(query)}%` : null;
    const companyPattern = company ? `%${escapeLike(company)}%` : null;

    const rows = this.stmtSearch.all(
      queryPattern,
      queryPattern,
      queryPattern,
      queryPattern,
      companyPattern,
      companyPattern,
      limit,
      offset,
    ) as unknown as ProfileSearchRow[];

    const total = rows.length > 0 ? (rows[0] as ProfileSearchRow).total : 0;

    const profiles: ProfileSummary[] = rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      headline: r.headline,
      company: r.company,
      title: r.title,
    }));

    return { profiles, total };
  }

  private assembleProfile(personId: number): Profile {
    const miniRow = this.stmtMiniProfile.get(personId) as
      | MiniProfileRow
      | undefined;
    const miniProfile: MiniProfile = miniRow
      ? {
          firstName: miniRow.first_name,
          lastName: miniRow.last_name,
          headline: miniRow.headline,
          avatar: miniRow.avatar,
        }
      : { firstName: "", lastName: null, headline: null, avatar: null };

    const externalIds: ExternalId[] = (
      this.stmtExternalIds.all(personId) as unknown as ExternalIdRow[]
    ).map((r) => ({
      externalId: r.external_id,
      typeGroup: r.type_group as ExternalIdTypeGroup,
      isMemberId: r.is_member_id === 1,
    }));

    const cpRow = this.stmtCurrentPosition.get(personId) as
      | CurrentPositionRow
      | undefined;
    const currentPosition: CurrentPosition | null = cpRow
      ? { company: cpRow.company, title: cpRow.position }
      : null;

    const positions: Position[] = (
      this.stmtPositions.all(personId) as unknown as PositionRow[]
    ).map((r) => ({
      company: r.company_name,
      title: r.title,
      startDate: formatDate(r.start_year, r.start_month),
      endDate: formatDate(r.end_year, r.end_month),
      isCurrent: r.is_default != null,
    }));

    const education: Education[] = (
      this.stmtEducation.all(personId) as unknown as EducationRow[]
    ).map((r) => ({
      school: r.school_name,
      degree: r.degree_name,
      field: r.field_of_study,
      startDate: formatDate(r.start_year, null),
      endDate: formatDate(r.end_year, null),
    }));

    const skills: Skill[] = (
      this.stmtSkills.all(personId) as unknown as SkillRow[]
    ).map((r) => ({ name: r.name }));

    const emails: string[] = (
      this.stmtEmails.all(personId) as unknown as EmailRow[]
    ).map((r) => r.email);

    return {
      id: personId,
      miniProfile,
      externalIds,
      currentPosition,
      positions,
      education,
      skills,
      emails,
    };
  }
}
