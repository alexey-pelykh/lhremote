/**
 * Generates a test fixture SQLite database with the real LinkedHelper
 * schema populated with synthetic (non-personal) mock data.
 *
 * Run: npx tsx src/db/testing/create-fixture.ts
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixture.db");

const db = new Database("");

// ── Schema (matches real LinkedHelper DDL) ──────────────────────────

db.exec(`
  CREATE TABLE disabled_triggers(
    id INTEGER PRIMARY KEY,
    trigger_name TEXT,
    UNIQUE (trigger_name)
  );

  CREATE TABLE people(
    id INTEGER PRIMARY KEY,
    original_id INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
  );
  CREATE INDEX people_original_id_idx ON people(original_id);

  CREATE TABLE person_mini_profile(
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    first_name_uppercase TEXT,
    last_name TEXT,
    last_name_uppercase TEXT,
    headline TEXT,
    headline_uppercase TEXT,
    avatar TEXT,
    first_mutual_full_name TEXT,
    second_mutual_full_name TEXT,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    UNIQUE (person_id),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );

  CREATE TABLE person_external_ids(
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL,
    external_id TEXT NOT NULL,
    external_id_uppercase TEXT NOT NULL,
    type_group TEXT NOT NULL CHECK(type_group IN ('member', 'public', 'hash', 'avatar')),
    is_member_id INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    UNIQUE(external_id, type_group),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );
  CREATE INDEX person_external_ids_person_idx ON person_external_ids(person_id);

  CREATE TABLE person_current_position(
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL,
    company TEXT,
    company_uppercase TEXT,
    position TEXT,
    position_uppercase TEXT,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    UNIQUE(person_id),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );

  CREATE TABLE person_positions(
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    company_name TEXT NOT NULL,
    company_id TEXT,
    start DATETIME,
    start_year INTEGER,
    start_month INTEGER,
    "end" DATETIME,
    end_year INTEGER,
    end_month INTEGER,
    location_name TEXT,
    description TEXT,
    is_default INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    sent_at_to_pas DATETIME,
    actual_at DATETIME NOT NULL,
    UNIQUE(person_id, is_default),
    FOREIGN KEY(person_id) REFERENCES people(id),
    CHECK(is_default IS NULL OR (is_default IS NOT NULL AND "end" IS NULL))
  );

  CREATE TABLE person_education(
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL,
    school_name TEXT NOT NULL,
    degree_name TEXT,
    field_of_study TEXT,
    description TEXT,
    start_year INTEGER,
    start_month INTEGER,
    end_year INTEGER,
    end_month INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    sent_at_to_pas DATETIME,
    actual_at DATETIME NOT NULL,
    FOREIGN KEY(person_id) REFERENCES people(id)
  );
  CREATE INDEX person_education_person_idx ON person_education(person_id);

  CREATE TABLE skills(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) > 0),
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    UNIQUE (name)
  );

  CREATE TABLE person_skill(
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    endorsements_count INTEGER CHECK (endorsements_count IS NULL OR typeof(endorsements_count) = 'integer' AND endorsements_count >= 0),
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    sent_at_to_pas DATETIME,
    actual_at DATETIME NOT NULL,
    UNIQUE (person_id, skill_id),
    FOREIGN KEY(person_id) REFERENCES people(id),
    FOREIGN KEY(skill_id) REFERENCES skills(id)
  );

  CREATE TABLE person_email(
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('personal', 'business')),
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    sent_at_to_pas DATETIME,
    actual_at DATETIME NOT NULL,
    UNIQUE (person_id, email),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );
`);

// ── Mock Data (obviously synthetic, no real PII) ────────────────────

const NOW = "2025-01-15T12:00:00.000Z";

// Person 1: full profile with all fields populated
db.exec(`
  INSERT INTO people (id, original_id, created_at, updated_at)
  VALUES (1, 1, '${NOW}', '${NOW}');

  INSERT INTO person_mini_profile
    (person_id, first_name, first_name_uppercase, last_name, last_name_uppercase,
     headline, headline_uppercase, avatar)
  VALUES
    (1, 'Ada', 'ADA', 'Lovelace', 'LOVELACE',
     'Principal Analytical Engine Programmer',
     'PRINCIPAL ANALYTICAL ENGINE PROGRAMMER',
     'https://example.test/avatars/ada.jpg');

  INSERT INTO person_external_ids
    (person_id, external_id, external_id_uppercase, type_group, is_member_id)
  VALUES
    (1, 'ada-lovelace-test', 'ADA-LOVELACE-TEST', 'public', NULL),
    (1, '100000001', '100000001', 'member', 1),
    (1, 'h4sh-ada-001', 'H4SH-ADA-001', 'hash', NULL);

  INSERT INTO person_current_position
    (person_id, company, company_uppercase, position, position_uppercase)
  VALUES
    (1, 'Babbage Industries', 'BABBAGE INDUSTRIES',
     'Lead Programmer', 'LEAD PROGRAMMER');

  INSERT INTO person_positions
    (person_id, title, company_name, company_id, start_year, start_month,
     is_default, actual_at)
  VALUES
    (1, 'Lead Programmer', 'Babbage Industries', 'C001',
     2020, 3, 1, '${NOW}');

  INSERT INTO person_positions
    (person_id, title, company_name, company_id, start_year, start_month,
     end_year, end_month, actual_at)
  VALUES
    (1, 'Junior Analyst', 'Difference Engine Co', 'C002',
     2015, 9, 2019, 12, '${NOW}');

  INSERT INTO person_education
    (person_id, school_name, degree_name, field_of_study,
     start_year, end_year, actual_at)
  VALUES
    (1, 'University of Mathematica', 'BSc', 'Mathematics',
     2011, 2015, '${NOW}');

  INSERT INTO person_education
    (person_id, school_name, degree_name, field_of_study,
     start_year, end_year, actual_at)
  VALUES
    (1, 'Royal Polytechnic', 'MSc', 'Computational Logic',
     2015, 2017, '${NOW}');

  INSERT INTO skills (id, name) VALUES (1, 'Algorithm Design');
  INSERT INTO skills (id, name) VALUES (2, 'Mechanical Computing');
  INSERT INTO skills (id, name) VALUES (3, 'Technical Writing');

  INSERT INTO person_skill (person_id, skill_id, endorsements_count, actual_at)
  VALUES (1, 1, 42, '${NOW}');
  INSERT INTO person_skill (person_id, skill_id, endorsements_count, actual_at)
  VALUES (1, 2, 17, '${NOW}');

  INSERT INTO person_email (person_id, email, type, actual_at)
  VALUES (1, 'ada@example.test', 'business', '${NOW}');
`);

// Person 2: minimal profile (only required fields)
db.exec(`
  INSERT INTO people (id, original_id, created_at, updated_at)
  VALUES (2, 2, '${NOW}', '${NOW}');

  INSERT INTO person_mini_profile
    (person_id, first_name, first_name_uppercase)
  VALUES (2, 'Charlie', 'CHARLIE');

  INSERT INTO person_external_ids
    (person_id, external_id, external_id_uppercase, type_group)
  VALUES (2, 'charlie-test', 'CHARLIE-TEST', 'public');
`);

// Person 3: another full profile for variety
db.exec(`
  INSERT INTO people (id, original_id, created_at, updated_at)
  VALUES (3, 3, '${NOW}', '${NOW}');

  INSERT INTO person_mini_profile
    (person_id, first_name, first_name_uppercase, last_name, last_name_uppercase,
     headline, headline_uppercase)
  VALUES
    (3, 'Grace', 'GRACE', 'Hopper', 'HOPPER',
     'Compiler Pioneer at COBOL Systems',
     'COMPILER PIONEER AT COBOL SYSTEMS');

  INSERT INTO person_external_ids
    (person_id, external_id, external_id_uppercase, type_group, is_member_id)
  VALUES
    (3, 'grace-hopper-test', 'GRACE-HOPPER-TEST', 'public', NULL),
    (3, '100000003', '100000003', 'member', 1);

  INSERT INTO person_current_position
    (person_id, company, company_uppercase, position, position_uppercase)
  VALUES
    (3, 'COBOL Systems Inc', 'COBOL SYSTEMS INC',
     'Distinguished Engineer', 'DISTINGUISHED ENGINEER');

  INSERT INTO person_positions
    (person_id, title, company_name, start_year, start_month,
     is_default, actual_at)
  VALUES
    (3, 'Distinguished Engineer', 'COBOL Systems Inc',
     2018, 1, 1, '${NOW}');

  INSERT INTO person_education
    (person_id, school_name, degree_name, field_of_study,
     start_year, end_year, actual_at)
  VALUES
    (3, 'Vassar College', 'BA', 'Mathematics and Physics',
     1924, 1928, '${NOW}');

  INSERT INTO person_skill (person_id, skill_id, endorsements_count, actual_at)
  VALUES (3, 3, 99, '${NOW}');

  INSERT INTO person_email (person_id, email, type, actual_at)
  VALUES (3, 'grace@example.test', 'business', '${NOW}');
  INSERT INTO person_email (person_id, email, type, actual_at)
  VALUES (3, 'grace.personal@example.test', 'personal', '${NOW}');
`);

// ── Write to disk ───────────────────────────────────────────────────

writeFileSync(FIXTURE_PATH, db.serialize());
db.close();

console.log(`Fixture written to ${FIXTURE_PATH}`);
