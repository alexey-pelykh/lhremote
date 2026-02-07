/**
 * Generates a test fixture SQLite database with the real LinkedHelper
 * schema populated with synthetic (non-personal) mock data.
 *
 * Run: npx tsx src/db/testing/create-fixture.ts
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixture.db");

const db = new DatabaseSync(":memory:");

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

db.exec(`
  CREATE TABLE chats(
    id INTEGER PRIMARY KEY,
    original_id INTEGER,
    type TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
  );

  CREATE TABLE messages(
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    subject TEXT,
    message_text TEXT NOT NULL,
    attachments_count INTEGER NOT NULL DEFAULT 0,
    send_at TEXT NOT NULL,
    original_message_id INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
  );

  CREATE TABLE chat_participants(
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    UNIQUE(chat_id, person_id),
    FOREIGN KEY(chat_id) REFERENCES chats(id),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );

  CREATE TABLE participant_messages(
    id INTEGER PRIMARY KEY,
    chat_participant_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    UNIQUE(chat_participant_id, message_id),
    FOREIGN KEY(chat_participant_id) REFERENCES chat_participants(id),
    FOREIGN KEY(message_id) REFERENCES messages(id)
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

// ── Messaging Data (chats between Ada, Charlie, Grace) ──────────────

// Chat 1: Ada ↔ Grace (3 messages)
db.exec(`
  INSERT INTO chats (id, original_id, type, platform, created_at, updated_at)
  VALUES (1, 1001, 'MEMBER_TO_MEMBER', 'LINKEDIN', '${NOW}', '${NOW}');

  INSERT INTO chat_participants (id, chat_id, person_id)
  VALUES (1, 1, 1), (2, 1, 3);

  INSERT INTO messages (id, type, message_text, attachments_count, send_at, created_at, updated_at)
  VALUES
    (1, 'MEMBER_TO_MEMBER', 'Hello Grace, I enjoyed your talk on compilers.', 0,
     '2025-01-10T09:00:00.000Z', '${NOW}', '${NOW}'),
    (2, 'MEMBER_TO_MEMBER', 'Thank you Ada! Would love to discuss analytical engines sometime.', 0,
     '2025-01-10T09:15:00.000Z', '${NOW}', '${NOW}'),
    (3, 'MEMBER_TO_MEMBER', 'Let us schedule a meeting next week.', 1,
     '2025-01-11T14:30:00.000Z', '${NOW}', '${NOW}');

  INSERT INTO participant_messages (id, chat_participant_id, message_id)
  VALUES (1, 1, 1), (2, 2, 2), (3, 1, 3);
`);

// Chat 2: Ada ↔ Charlie (1 message, InMail with subject)
db.exec(`
  INSERT INTO chats (id, original_id, type, platform, created_at, updated_at)
  VALUES (2, 1002, 'MEMBER_TO_MEMBER', 'LINKEDIN', '${NOW}', '${NOW}');

  INSERT INTO chat_participants (id, chat_id, person_id)
  VALUES (3, 2, 1), (4, 2, 2);

  INSERT INTO messages (id, type, subject, message_text, attachments_count, send_at, created_at, updated_at)
  VALUES
    (4, 'DEFAULT', 'Job Opportunity', 'Hi Charlie, we have an opening on our team.', 0,
     '2025-01-12T10:00:00.000Z', '${NOW}', '${NOW}');

  INSERT INTO participant_messages (id, chat_participant_id, message_id)
  VALUES (4, 3, 4);
`);

// Chat 3: Grace ↔ Charlie (2 messages)
db.exec(`
  INSERT INTO chats (id, original_id, type, platform, created_at, updated_at)
  VALUES (3, 1003, 'MEMBER_TO_MEMBER', 'LINKEDIN', '${NOW}', '${NOW}');

  INSERT INTO chat_participants (id, chat_id, person_id)
  VALUES (5, 3, 3), (6, 3, 2);

  INSERT INTO messages (id, type, message_text, attachments_count, send_at, created_at, updated_at)
  VALUES
    (5, 'MEMBER_TO_MEMBER', 'Charlie, have you tried the new COBOL compiler?', 0,
     '2025-01-13T08:00:00.000Z', '${NOW}', '${NOW}'),
    (6, 'MEMBER_TO_MEMBER', 'Not yet, but I will check it out!', 0,
     '2025-01-13T08:30:00.000Z', '${NOW}', '${NOW}');

  INSERT INTO participant_messages (id, chat_participant_id, message_id)
  VALUES (5, 5, 5), (6, 6, 6);
`);

// ── Campaign Schema ──────────────────────────────────────────────────

db.exec(`
  CREATE TABLE campaigns(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type INTEGER NOT NULL DEFAULT 1,
    is_paused INTEGER,
    is_archived INTEGER,
    is_valid INTEGER,
    li_account_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
  );

  CREATE TABLE actions(
    id INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    startAt DATETIME,
    postpone_reason TEXT,
    postpone_reason_data TEXT,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
  );
  CREATE INDEX actions_campaign_idx ON actions(campaign_id);

  CREATE TABLE action_configs(
    id INTEGER PRIMARY KEY,
    actionType TEXT NOT NULL,
    actionSettings TEXT NOT NULL DEFAULT '{}',
    coolDown INTEGER NOT NULL DEFAULT 60000,
    maxActionResultsPerIteration INTEGER NOT NULL DEFAULT 10,
    isDraft INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
  );

  CREATE TABLE action_versions(
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL,
    config_id INTEGER NOT NULL,
    exclude_list_id INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    FOREIGN KEY(action_id) REFERENCES actions(id),
    FOREIGN KEY(config_id) REFERENCES action_configs(id)
  );
  CREATE INDEX action_versions_action_idx ON action_versions(action_id);

  CREATE TABLE action_target_people(
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL,
    action_version_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    state INTEGER NOT NULL DEFAULT 1,
    li_account_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    FOREIGN KEY(action_id) REFERENCES actions(id),
    FOREIGN KEY(action_version_id) REFERENCES action_versions(id),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );
  CREATE INDEX action_target_people_action_idx ON action_target_people(action_id);
  CREATE INDEX action_target_people_person_idx ON action_target_people(person_id);

  CREATE TABLE person_in_campaigns_history(
    id INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    action_target_people_id INTEGER,
    result_status INTEGER,
    result_id INTEGER,
    result_action_version_id INTEGER,
    result_action_iteration_id INTEGER,
    result_created_at DATETIME,
    result_data TEXT,
    result_data_message TEXT,
    result_code TEXT,
    result_is_exception INTEGER,
    result_who_to_blame TEXT,
    result_is_retryable INTEGER,
    result_flag_recipient_replied INTEGER,
    result_flag_sender_messaged INTEGER,
    result_invited_platform TEXT,
    result_messaged_platform TEXT,
    add_to_target_date DATETIME,
    add_to_target_or_result_saved_date DATETIME,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );
  CREATE INDEX person_in_campaigns_history_campaign_idx ON person_in_campaigns_history(campaign_id);
  CREATE INDEX person_in_campaigns_history_person_idx ON person_in_campaigns_history(person_id);

  CREATE TABLE action_results(
    id INTEGER PRIMARY KEY,
    action_version_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    result INTEGER NOT NULL,
    platform TEXT,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    UNIQUE(action_version_id, person_id),
    FOREIGN KEY(action_version_id) REFERENCES action_versions(id),
    FOREIGN KEY(person_id) REFERENCES people(id)
  );
  CREATE INDEX action_results_version_idx ON action_results(action_version_id);
  CREATE INDEX action_results_person_idx ON action_results(person_id);

  CREATE TABLE action_result_flags(
    id INTEGER PRIMARY KEY,
    action_result_id INTEGER NOT NULL,
    flag_name TEXT NOT NULL,
    flag_value INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    FOREIGN KEY(action_result_id) REFERENCES action_results(id)
  );
  CREATE INDEX action_result_flags_result_idx ON action_result_flags(action_result_id);

  CREATE TABLE action_result_messages(
    id INTEGER PRIMARY KEY,
    action_result_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message_id INTEGER,
    created_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    updated_at DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
    FOREIGN KEY(action_result_id) REFERENCES action_results(id)
  );
  CREATE INDEX action_result_messages_result_idx ON action_result_messages(action_result_id);
`);

// ── Campaign Mock Data ───────────────────────────────────────────────

// Campaign 1: Active campaign with MessageToPerson action
db.exec(`
  INSERT INTO campaigns (id, name, description, type, is_paused, is_archived, is_valid, li_account_id, created_at, updated_at)
  VALUES (1, 'Outreach Campaign', 'Test outreach campaign', 1, 0, 0, 1, 1, '${NOW}', '${NOW}');

  INSERT INTO action_configs (id, actionType, actionSettings, coolDown, maxActionResultsPerIteration, isDraft)
  VALUES (1, 'MessageToPerson', '{"messageTemplate":{"type":"variants","variants":[{"type":"variant","child":{"type":"group","children":[{"type":"text","value":"Hello "},{"type":"var","name":"firstName"}]}}]},"rejectIfReplied":false}', 60000, 10, 0);

  INSERT INTO actions (id, campaign_id, name, description, created_at, updated_at)
  VALUES (1, 1, 'Send Welcome Message', 'First touch message', '${NOW}', '${NOW}');

  INSERT INTO action_versions (id, action_id, config_id, created_at, updated_at)
  VALUES (1, 1, 1, '${NOW}', '${NOW}');

  INSERT INTO action_target_people (id, action_id, action_version_id, person_id, state, li_account_id, created_at, updated_at)
  VALUES
    (1, 1, 1, 1, 2, 1, '${NOW}', '${NOW}'),
    (2, 1, 1, 3, 1, 1, '${NOW}', '${NOW}');

  INSERT INTO person_in_campaigns_history (id, campaign_id, person_id, action_target_people_id, result_status, result_id, result_action_version_id, add_to_target_date, add_to_target_or_result_saved_date, created_at, updated_at)
  VALUES
    (1, 1, 1, 1, 1, 1, 1, '${NOW}', '${NOW}', '${NOW}', '${NOW}'),
    (2, 1, 3, 2, -999, NULL, NULL, '${NOW}', '${NOW}', '${NOW}', '${NOW}');

  INSERT INTO action_results (id, action_version_id, person_id, result, platform, created_at, updated_at)
  VALUES (1, 1, 1, 1, 'LINKEDIN', '2025-01-15T12:30:00.000Z', '${NOW}');

  INSERT INTO action_result_flags (id, action_result_id, flag_name, flag_value)
  VALUES (1, 1, 'message_sent', 1);

  INSERT INTO action_result_messages (id, action_result_id, type, message_id)
  VALUES (1, 1, 'Sent', 1);
`);

// Campaign 2: Paused campaign
db.exec(`
  INSERT INTO campaigns (id, name, description, type, is_paused, is_archived, is_valid, li_account_id, created_at, updated_at)
  VALUES (2, 'Follow-up Campaign', 'Paused follow-up', 1, 1, 0, 1, 1, '2025-01-14T10:00:00.000Z', '${NOW}');

  INSERT INTO action_configs (id, actionType, actionSettings, coolDown, maxActionResultsPerIteration, isDraft)
  VALUES (2, 'VisitAndExtract', '{"extractProfile":true}', 30000, 20, 0);

  INSERT INTO actions (id, campaign_id, name, description, created_at, updated_at)
  VALUES (2, 2, 'Visit Profile', 'Extract profile data', '${NOW}', '${NOW}');

  INSERT INTO action_versions (id, action_id, config_id, created_at, updated_at)
  VALUES (2, 2, 2, '${NOW}', '${NOW}');
`);

// Campaign 3: Archived campaign
db.exec(`
  INSERT INTO campaigns (id, name, description, type, is_paused, is_archived, is_valid, li_account_id, created_at, updated_at)
  VALUES (3, 'Old Campaign', 'Archived old campaign', 1, 0, 1, 1, 1, '2025-01-01T10:00:00.000Z', '${NOW}');
`);

// Campaign 4: Invalid campaign
db.exec(`
  INSERT INTO campaigns (id, name, description, type, is_paused, is_archived, is_valid, li_account_id, created_at, updated_at)
  VALUES (4, 'Invalid Campaign', 'Invalid configuration', 1, 0, 0, 0, 1, '2025-01-13T10:00:00.000Z', '${NOW}');
`);

// ── Write to disk ───────────────────────────────────────────────────

await backup(db, FIXTURE_PATH);
db.close();

console.log(`Fixture written to ${FIXTURE_PATH}`);
