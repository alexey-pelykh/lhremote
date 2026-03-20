// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type {
  CompanySizeEntry,
  ConnectionDegreeEntry,
  FunctionEntry,
  IndustryEntry,
  ProfileLanguageEntry,
  ReferenceDataType,
  SeniorityEntry,
} from "../types/linkedin-url.js";

/**
 * LinkedIn industry taxonomy (~148 entries).
 *
 * IDs from the LinkedIn Marketing API documentation.
 */
const INDUSTRIES: readonly IndustryEntry[] = [
  { id: 1, name: "Defense & Space" },
  { id: 3, name: "Computer Hardware" },
  { id: 4, name: "Computer Software" },
  { id: 5, name: "Computer Networking" },
  { id: 6, name: "Internet" },
  { id: 7, name: "Semiconductors" },
  { id: 8, name: "Telecommunications" },
  { id: 9, name: "Law Practice" },
  { id: 10, name: "Legal Services" },
  { id: 11, name: "Management Consulting" },
  { id: 12, name: "Biotechnology" },
  { id: 13, name: "Medical Practice" },
  { id: 14, name: "Hospital & Health Care" },
  { id: 15, name: "Pharmaceuticals" },
  { id: 16, name: "Veterinary" },
  { id: 17, name: "Medical Devices" },
  { id: 18, name: "Cosmetics" },
  { id: 19, name: "Apparel & Fashion" },
  { id: 20, name: "Sporting Goods" },
  { id: 21, name: "Tobacco" },
  { id: 22, name: "Supermarkets" },
  { id: 23, name: "Food Production" },
  { id: 24, name: "Consumer Electronics" },
  { id: 25, name: "Consumer Goods" },
  { id: 26, name: "Furniture" },
  { id: 27, name: "Retail" },
  { id: 28, name: "Entertainment" },
  { id: 29, name: "Gambling & Casinos" },
  { id: 30, name: "Leisure, Travel & Tourism" },
  { id: 31, name: "Hospitality" },
  { id: 32, name: "Restaurants" },
  { id: 33, name: "Sports" },
  { id: 34, name: "Food & Beverages" },
  { id: 35, name: "Motion Pictures and Film" },
  { id: 36, name: "Broadcast Media" },
  { id: 37, name: "Museums and Institutions" },
  { id: 38, name: "Fine Art" },
  { id: 39, name: "Performing Arts" },
  { id: 40, name: "Recreational Facilities and Services" },
  { id: 41, name: "Banking" },
  { id: 42, name: "Insurance" },
  { id: 43, name: "Financial Services" },
  { id: 44, name: "Real Estate" },
  { id: 45, name: "Investment Banking" },
  { id: 46, name: "Investment Management" },
  { id: 47, name: "Accounting" },
  { id: 48, name: "Construction" },
  { id: 49, name: "Building Materials" },
  { id: 50, name: "Architecture & Planning" },
  { id: 51, name: "Civil Engineering" },
  { id: 52, name: "Aviation & Aerospace" },
  { id: 53, name: "Automotive" },
  { id: 54, name: "Chemicals" },
  { id: 55, name: "Machinery" },
  { id: 56, name: "Mining & Metals" },
  { id: 57, name: "Oil & Energy" },
  { id: 58, name: "Shipbuilding" },
  { id: 59, name: "Utilities" },
  { id: 60, name: "Textiles" },
  { id: 61, name: "Paper & Forest Products" },
  { id: 62, name: "Railroad Manufacture" },
  { id: 63, name: "Farming" },
  { id: 64, name: "Ranching" },
  { id: 65, name: "Dairy" },
  { id: 66, name: "Fishery" },
  { id: 67, name: "Primary/Secondary Education" },
  { id: 68, name: "Higher Education" },
  { id: 69, name: "Education Management" },
  { id: 70, name: "Research" },
  { id: 71, name: "Military" },
  { id: 72, name: "Legislative Office" },
  { id: 73, name: "Judiciary" },
  { id: 74, name: "International Affairs" },
  { id: 75, name: "Government Administration" },
  { id: 76, name: "Executive Office" },
  { id: 77, name: "Law Enforcement" },
  { id: 78, name: "Public Safety" },
  { id: 79, name: "Public Policy" },
  { id: 80, name: "Marketing and Advertising" },
  { id: 81, name: "Newspapers" },
  { id: 82, name: "Publishing" },
  { id: 83, name: "Printing" },
  { id: 84, name: "Information Services" },
  { id: 85, name: "Libraries" },
  { id: 86, name: "Environmental Services" },
  { id: 87, name: "Package/Freight Delivery" },
  { id: 88, name: "Individual & Family Services" },
  { id: 89, name: "Religious Institutions" },
  { id: 90, name: "Civic & Social Organization" },
  { id: 91, name: "Consumer Services" },
  { id: 92, name: "Transportation/Trucking/Railroad" },
  { id: 93, name: "Warehousing" },
  { id: 94, name: "Airlines/Aviation" },
  { id: 95, name: "Maritime" },
  { id: 96, name: "Information Technology and Services" },
  { id: 97, name: "Market Research" },
  { id: 98, name: "Public Relations and Communications" },
  { id: 99, name: "Design" },
  { id: 100, name: "Nonprofit Organization Management" },
  { id: 101, name: "Fund-Raising" },
  { id: 102, name: "Program Development" },
  { id: 103, name: "Writing and Editing" },
  { id: 104, name: "Staffing and Recruiting" },
  { id: 105, name: "Professional Training & Coaching" },
  { id: 106, name: "Venture Capital & Private Equity" },
  { id: 107, name: "Political Organization" },
  { id: 108, name: "Translation and Localization" },
  { id: 109, name: "Computer Games" },
  { id: 110, name: "Events Services" },
  { id: 111, name: "Arts and Crafts" },
  { id: 112, name: "Electrical/Electronic Manufacturing" },
  { id: 113, name: "Online Media" },
  { id: 114, name: "Nanotechnology" },
  { id: 115, name: "Music" },
  { id: 116, name: "Logistics and Supply Chain" },
  { id: 117, name: "Plastics" },
  { id: 118, name: "Computer & Network Security" },
  { id: 119, name: "Wireless" },
  { id: 120, name: "Alternative Dispute Resolution" },
  { id: 121, name: "Security and Investigations" },
  { id: 122, name: "Facilities Services" },
  { id: 123, name: "Outsourcing/Offshoring" },
  { id: 124, name: "Health, Wellness and Fitness" },
  { id: 125, name: "Alternative Medicine" },
  { id: 126, name: "Media Production" },
  { id: 127, name: "Animation" },
  { id: 128, name: "Commercial Real Estate" },
  { id: 129, name: "Capital Markets" },
  { id: 130, name: "Think Tanks" },
  { id: 131, name: "Philanthropy" },
  { id: 132, name: "E-Learning" },
  { id: 133, name: "Wholesale" },
  { id: 134, name: "Import and Export" },
  { id: 135, name: "Mechanical or Industrial Engineering" },
  { id: 136, name: "Photography" },
  { id: 137, name: "Human Resources" },
  { id: 138, name: "Business Supplies and Equipment" },
  { id: 139, name: "Mental Health Care" },
  { id: 140, name: "Graphic Design" },
  { id: 141, name: "International Trade and Development" },
  { id: 142, name: "Wine and Spirits" },
  { id: 143, name: "Luxury Goods & Jewelry" },
  { id: 144, name: "Renewables & Environment" },
  { id: 145, name: "Glass, Ceramics & Concrete" },
  { id: 146, name: "Packaging and Containers" },
  { id: 147, name: "Industrial Automation" },
  { id: 148, name: "Government Relations" },
] as const;

/**
 * LinkedIn seniority levels (~10 entries).
 */
const SENIORITY_LEVELS: readonly SeniorityEntry[] = [
  { id: 1, name: "Unpaid" },
  { id: 2, name: "Training" },
  { id: 3, name: "Entry" },
  { id: 4, name: "Senior" },
  { id: 5, name: "Manager" },
  { id: 6, name: "Director" },
  { id: 7, name: "VP" },
  { id: 8, name: "CXO" },
  { id: 9, name: "Partner" },
  { id: 10, name: "Owner" },
] as const;

/**
 * LinkedIn job functions / departments (~26 entries).
 */
const FUNCTIONS: readonly FunctionEntry[] = [
  { id: 1, name: "Accounting" },
  { id: 2, name: "Administrative" },
  { id: 3, name: "Arts and Design" },
  { id: 4, name: "Business Development" },
  { id: 5, name: "Community and Social Services" },
  { id: 6, name: "Consulting" },
  { id: 7, name: "Education" },
  { id: 8, name: "Engineering" },
  { id: 9, name: "Entrepreneurship" },
  { id: 10, name: "Finance" },
  { id: 11, name: "Healthcare Services" },
  { id: 12, name: "Human Resources" },
  { id: 13, name: "Information Technology" },
  { id: 14, name: "Legal" },
  { id: 15, name: "Marketing" },
  { id: 16, name: "Media and Communication" },
  { id: 17, name: "Military and Protective Services" },
  { id: 18, name: "Operations" },
  { id: 19, name: "Product Management" },
  { id: 20, name: "Program and Project Management" },
  { id: 21, name: "Purchasing" },
  { id: 22, name: "Quality Assurance" },
  { id: 23, name: "Real Estate" },
  { id: 24, name: "Research" },
  { id: 25, name: "Sales" },
  { id: 26, name: "Support" },
] as const;

/**
 * LinkedIn company size ranges (~9 entries).
 *
 * IDs are single-letter codes used in search URL encoding.
 */
const COMPANY_SIZES: readonly CompanySizeEntry[] = [
  { id: "A", label: "Self-employed" },
  { id: "B", label: "1-10 employees" },
  { id: "C", label: "11-50 employees" },
  { id: "D", label: "51-200 employees" },
  { id: "E", label: "201-500 employees" },
  { id: "F", label: "501-1,000 employees" },
  { id: "G", label: "1,001-5,000 employees" },
  { id: "H", label: "5,001-10,000 employees" },
  { id: "I", label: "10,001+ employees" },
] as const;

/**
 * LinkedIn connection degrees.
 */
const CONNECTION_DEGREES: readonly ConnectionDegreeEntry[] = [
  { code: "F", label: "1st degree" },
  { code: "S", label: "2nd degree" },
  { code: "O", label: "3rd+ degree" },
] as const;

/**
 * LinkedIn profile languages (ISO 639-1 codes supported by LinkedIn search).
 */
const PROFILE_LANGUAGES: readonly ProfileLanguageEntry[] = [
  { code: "ar", name: "Arabic" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "de", name: "German" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ms", name: "Malay" },
  { code: "nl", name: "Dutch" },
  { code: "no", name: "Norwegian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sv", name: "Swedish" },
  { code: "th", name: "Thai" },
  { code: "tl", name: "Tagalog" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "vi", name: "Vietnamese" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
] as const;

/** Map of data type → static array. */
type ReferenceDataMap = {
  INDUSTRY: readonly IndustryEntry[];
  SENIORITY: readonly SeniorityEntry[];
  FUNCTION: readonly FunctionEntry[];
  COMPANY_SIZE: readonly CompanySizeEntry[];
  CONNECTION_DEGREE: readonly ConnectionDegreeEntry[];
  PROFILE_LANGUAGE: readonly ProfileLanguageEntry[];
};

const REFERENCE_DATA: ReferenceDataMap = {
  INDUSTRY: INDUSTRIES,
  SENIORITY: SENIORITY_LEVELS,
  FUNCTION: FUNCTIONS,
  COMPANY_SIZE: COMPANY_SIZES,
  CONNECTION_DEGREE: CONNECTION_DEGREES,
  PROFILE_LANGUAGE: PROFILE_LANGUAGES,
};

/** Pre-built lookup maps for ID-based access. */
const INDUSTRY_BY_ID = new Map(INDUSTRIES.map((e) => [e.id, e]));
const SENIORITY_BY_ID = new Map(SENIORITY_LEVELS.map((e) => [e.id, e]));
const FUNCTION_BY_ID = new Map(FUNCTIONS.map((e) => [e.id, e]));

/**
 * Get all reference data entries for a given data type.
 *
 * @param dataType - The reference data type to retrieve
 * @returns Array of entries for the requested type
 */
export function getLinkedInReferenceData<T extends ReferenceDataType>(
  dataType: T,
): ReferenceDataMap[T] {
  return REFERENCE_DATA[dataType];
}

/**
 * Look up an industry by ID.
 *
 * @param id - Industry numeric ID
 * @returns The matching industry entry, or `undefined`
 */
export function getIndustryById(id: number): IndustryEntry | undefined {
  return INDUSTRY_BY_ID.get(id);
}

/**
 * Look up a seniority level by ID.
 *
 * @param id - Seniority numeric ID
 * @returns The matching seniority entry, or `undefined`
 */
export function getSeniorityById(id: number): SeniorityEntry | undefined {
  return SENIORITY_BY_ID.get(id);
}

/**
 * Look up a function/department by ID.
 *
 * @param id - Function numeric ID
 * @returns The matching function entry, or `undefined`
 */
export function getFunctionById(id: number): FunctionEntry | undefined {
  return FUNCTION_BY_ID.get(id);
}

/**
 * Validate whether a string is a known reference data type.
 */
export function isReferenceDataType(value: string): value is ReferenceDataType {
  return Object.hasOwn(REFERENCE_DATA, value);
}
