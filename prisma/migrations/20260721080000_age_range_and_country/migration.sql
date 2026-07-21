-- CreateEnum
CREATE TYPE "AgeRange" AS ENUM (
  'AGE_18_24',
  'AGE_25_28',
  'AGE_29_34',
  'AGE_35_39',
  'AGE_40_44',
  'AGE_45_49',
  'AGE_50_54',
  'AGE_55_59',
  'AGE_60_64',
  'AGE_65_70'
);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "ageRange" "AgeRange";
ALTER TABLE "users" ADD COLUMN "country" VARCHAR(80);

-- Backfill ageRange from dateOfBirth
UPDATE "users"
SET "ageRange" = CASE
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 24 THEN 'AGE_18_24'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 28 THEN 'AGE_25_28'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 34 THEN 'AGE_29_34'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 39 THEN 'AGE_35_39'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 44 THEN 'AGE_40_44'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 49 THEN 'AGE_45_49'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 54 THEN 'AGE_50_54'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 59 THEN 'AGE_55_59'::"AgeRange"
  WHEN EXTRACT(YEAR FROM age("dateOfBirth"))::int <= 64 THEN 'AGE_60_64'::"AgeRange"
  ELSE 'AGE_65_70'::"AgeRange"
END
WHERE "ageRange" IS NULL;

-- Backfill country from countryCode (fallback India)
UPDATE "users"
SET "country" = CASE UPPER(TRIM("countryCode"))
  WHEN 'AF' THEN 'Afghanistan'
  WHEN 'AL' THEN 'Albania'
  WHEN 'DZ' THEN 'Algeria'
  WHEN 'AD' THEN 'Andorra'
  WHEN 'AO' THEN 'Angola'
  WHEN 'AG' THEN 'Antigua and Barbuda'
  WHEN 'AR' THEN 'Argentina'
  WHEN 'AM' THEN 'Armenia'
  WHEN 'AU' THEN 'Australia'
  WHEN 'AT' THEN 'Austria'
  WHEN 'AZ' THEN 'Azerbaijan'
  WHEN 'BS' THEN 'Bahamas'
  WHEN 'BH' THEN 'Bahrain'
  WHEN 'BD' THEN 'Bangladesh'
  WHEN 'BB' THEN 'Barbados'
  WHEN 'BY' THEN 'Belarus'
  WHEN 'BE' THEN 'Belgium'
  WHEN 'BZ' THEN 'Belize'
  WHEN 'BJ' THEN 'Benin'
  WHEN 'BT' THEN 'Bhutan'
  WHEN 'BO' THEN 'Bolivia'
  WHEN 'BA' THEN 'Bosnia and Herzegovina'
  WHEN 'BW' THEN 'Botswana'
  WHEN 'BR' THEN 'Brazil'
  WHEN 'BN' THEN 'Brunei'
  WHEN 'BG' THEN 'Bulgaria'
  WHEN 'BF' THEN 'Burkina Faso'
  WHEN 'BI' THEN 'Burundi'
  WHEN 'KH' THEN 'Cambodia'
  WHEN 'CM' THEN 'Cameroon'
  WHEN 'CA' THEN 'Canada'
  WHEN 'CV' THEN 'Cape Verde'
  WHEN 'CF' THEN 'Central African Republic'
  WHEN 'TD' THEN 'Chad'
  WHEN 'CL' THEN 'Chile'
  WHEN 'CN' THEN 'China'
  WHEN 'CO' THEN 'Colombia'
  WHEN 'KM' THEN 'Comoros'
  WHEN 'CG' THEN 'Congo'
  WHEN 'CR' THEN 'Costa Rica'
  WHEN 'HR' THEN 'Croatia'
  WHEN 'CU' THEN 'Cuba'
  WHEN 'CY' THEN 'Cyprus'
  WHEN 'CZ' THEN 'Czech Republic'
  WHEN 'DK' THEN 'Denmark'
  WHEN 'DJ' THEN 'Djibouti'
  WHEN 'DM' THEN 'Dominica'
  WHEN 'DO' THEN 'Dominican Republic'
  WHEN 'EC' THEN 'Ecuador'
  WHEN 'EG' THEN 'Egypt'
  WHEN 'SV' THEN 'El Salvador'
  WHEN 'GQ' THEN 'Equatorial Guinea'
  WHEN 'ER' THEN 'Eritrea'
  WHEN 'EE' THEN 'Estonia'
  WHEN 'SZ' THEN 'Eswatini'
  WHEN 'ET' THEN 'Ethiopia'
  WHEN 'FJ' THEN 'Fiji'
  WHEN 'FI' THEN 'Finland'
  WHEN 'FR' THEN 'France'
  WHEN 'GA' THEN 'Gabon'
  WHEN 'GM' THEN 'Gambia'
  WHEN 'GE' THEN 'Georgia'
  WHEN 'DE' THEN 'Germany'
  WHEN 'GH' THEN 'Ghana'
  WHEN 'GR' THEN 'Greece'
  WHEN 'GD' THEN 'Grenada'
  WHEN 'GT' THEN 'Guatemala'
  WHEN 'GN' THEN 'Guinea'
  WHEN 'GW' THEN 'Guinea-Bissau'
  WHEN 'GY' THEN 'Guyana'
  WHEN 'HT' THEN 'Haiti'
  WHEN 'HN' THEN 'Honduras'
  WHEN 'HU' THEN 'Hungary'
  WHEN 'IS' THEN 'Iceland'
  WHEN 'IN' THEN 'India'
  WHEN 'ID' THEN 'Indonesia'
  WHEN 'IR' THEN 'Iran'
  WHEN 'IQ' THEN 'Iraq'
  WHEN 'IE' THEN 'Ireland'
  WHEN 'IL' THEN 'Israel'
  WHEN 'IT' THEN 'Italy'
  WHEN 'JM' THEN 'Jamaica'
  WHEN 'JP' THEN 'Japan'
  WHEN 'JO' THEN 'Jordan'
  WHEN 'KZ' THEN 'Kazakhstan'
  WHEN 'KE' THEN 'Kenya'
  WHEN 'KI' THEN 'Kiribati'
  WHEN 'KW' THEN 'Kuwait'
  WHEN 'KG' THEN 'Kyrgyzstan'
  WHEN 'LA' THEN 'Laos'
  WHEN 'LV' THEN 'Latvia'
  WHEN 'LB' THEN 'Lebanon'
  WHEN 'LS' THEN 'Lesotho'
  WHEN 'LR' THEN 'Liberia'
  WHEN 'LY' THEN 'Libya'
  WHEN 'LI' THEN 'Liechtenstein'
  WHEN 'LT' THEN 'Lithuania'
  WHEN 'LU' THEN 'Luxembourg'
  WHEN 'MG' THEN 'Madagascar'
  WHEN 'MW' THEN 'Malawi'
  WHEN 'MY' THEN 'Malaysia'
  WHEN 'MV' THEN 'Maldives'
  WHEN 'ML' THEN 'Mali'
  WHEN 'MT' THEN 'Malta'
  WHEN 'MH' THEN 'Marshall Islands'
  WHEN 'MR' THEN 'Mauritania'
  WHEN 'MU' THEN 'Mauritius'
  WHEN 'MX' THEN 'Mexico'
  WHEN 'FM' THEN 'Micronesia'
  WHEN 'MD' THEN 'Moldova'
  WHEN 'MC' THEN 'Monaco'
  WHEN 'MN' THEN 'Mongolia'
  WHEN 'ME' THEN 'Montenegro'
  WHEN 'MA' THEN 'Morocco'
  WHEN 'MZ' THEN 'Mozambique'
  WHEN 'MM' THEN 'Myanmar'
  WHEN 'NA' THEN 'Namibia'
  WHEN 'NR' THEN 'Nauru'
  WHEN 'NP' THEN 'Nepal'
  WHEN 'NL' THEN 'Netherlands'
  WHEN 'NZ' THEN 'New Zealand'
  WHEN 'NI' THEN 'Nicaragua'
  WHEN 'NE' THEN 'Niger'
  WHEN 'NG' THEN 'Nigeria'
  WHEN 'KP' THEN 'North Korea'
  WHEN 'MK' THEN 'North Macedonia'
  WHEN 'NO' THEN 'Norway'
  WHEN 'OM' THEN 'Oman'
  WHEN 'PK' THEN 'Pakistan'
  WHEN 'PW' THEN 'Palau'
  WHEN 'PS' THEN 'Palestine'
  WHEN 'PA' THEN 'Panama'
  WHEN 'PG' THEN 'Papua New Guinea'
  WHEN 'PY' THEN 'Paraguay'
  WHEN 'PE' THEN 'Peru'
  WHEN 'PH' THEN 'Philippines'
  WHEN 'PL' THEN 'Poland'
  WHEN 'PT' THEN 'Portugal'
  WHEN 'QA' THEN 'Qatar'
  WHEN 'RO' THEN 'Romania'
  WHEN 'RU' THEN 'Russia'
  WHEN 'RW' THEN 'Rwanda'
  WHEN 'KN' THEN 'Saint Kitts and Nevis'
  WHEN 'LC' THEN 'Saint Lucia'
  WHEN 'VC' THEN 'Saint Vincent and the Grenadines'
  WHEN 'WS' THEN 'Samoa'
  WHEN 'SM' THEN 'San Marino'
  WHEN 'ST' THEN 'Sao Tome and Principe'
  WHEN 'SA' THEN 'Saudi Arabia'
  WHEN 'SN' THEN 'Senegal'
  WHEN 'RS' THEN 'Serbia'
  WHEN 'SC' THEN 'Seychelles'
  WHEN 'SL' THEN 'Sierra Leone'
  WHEN 'SG' THEN 'Singapore'
  WHEN 'SK' THEN 'Slovakia'
  WHEN 'SI' THEN 'Slovenia'
  WHEN 'SB' THEN 'Solomon Islands'
  WHEN 'SO' THEN 'Somalia'
  WHEN 'ZA' THEN 'South Africa'
  WHEN 'KR' THEN 'South Korea'
  WHEN 'SS' THEN 'South Sudan'
  WHEN 'ES' THEN 'Spain'
  WHEN 'LK' THEN 'Sri Lanka'
  WHEN 'SD' THEN 'Sudan'
  WHEN 'SR' THEN 'Suriname'
  WHEN 'SE' THEN 'Sweden'
  WHEN 'CH' THEN 'Switzerland'
  WHEN 'SY' THEN 'Syria'
  WHEN 'TW' THEN 'Taiwan'
  WHEN 'TJ' THEN 'Tajikistan'
  WHEN 'TZ' THEN 'Tanzania'
  WHEN 'TH' THEN 'Thailand'
  WHEN 'TL' THEN 'Timor-Leste'
  WHEN 'TG' THEN 'Togo'
  WHEN 'TO' THEN 'Tonga'
  WHEN 'TT' THEN 'Trinidad and Tobago'
  WHEN 'TN' THEN 'Tunisia'
  WHEN 'TR' THEN 'Turkey'
  WHEN 'TM' THEN 'Turkmenistan'
  WHEN 'TV' THEN 'Tuvalu'
  WHEN 'UG' THEN 'Uganda'
  WHEN 'UA' THEN 'Ukraine'
  WHEN 'AE' THEN 'United Arab Emirates'
  WHEN 'GB' THEN 'United Kingdom'
  WHEN 'US' THEN 'United States'
  WHEN 'UY' THEN 'Uruguay'
  WHEN 'UZ' THEN 'Uzbekistan'
  WHEN 'VU' THEN 'Vanuatu'
  WHEN 'VA' THEN 'Vatican City'
  WHEN 'VE' THEN 'Venezuela'
  WHEN 'VN' THEN 'Vietnam'
  WHEN 'YE' THEN 'Yemen'
  WHEN 'ZM' THEN 'Zambia'
  WHEN 'ZW' THEN 'Zimbabwe'
  ELSE 'India'
END
WHERE "country" IS NULL;

UPDATE "users" SET "country" = 'India' WHERE "country" IS NULL;

ALTER TABLE "users" ALTER COLUMN "ageRange" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "country" SET NOT NULL;

ALTER TABLE "users" DROP COLUMN "dateOfBirth";
ALTER TABLE "users" DROP COLUMN "countryCode";

DROP INDEX IF EXISTS "users_countryCode_gender_status_idx";
CREATE INDEX "users_country_gender_status_idx" ON "users"("country", "gender", "status");
