-- =============================================================================
-- ONE-TIME production baseline for the TypeORM migrations table.
--
-- The production DB was originally built by `synchronize`, so it has no
-- `migrations` tracking table. Running `migration:run` as-is would try to run
-- InitialSchema first and fail (tables already exist).
--
-- This script creates the tracking table and marks each migration whose result
-- is ALREADY present in the DB as "applied" — so `migration:run` afterwards
-- applies only the migrations that are genuinely missing.
--
-- Safe to re-run: every insert is guarded (won't duplicate), and each migration
-- is baselined ONLY IF its signature table already exists.
--
-- Run once against the production database (phpMyAdmin → SQL, or mysql CLI).
-- Then run:  npm run migration:run:prod
-- =============================================================================

CREATE TABLE IF NOT EXISTS `migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `timestamp` bigint NOT NULL,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- InitialSchema — baseline if the core schema already exists.
INSERT INTO `migrations` (`timestamp`, `name`)
SELECT 1786999727522, 'InitialSchema1786999727522' FROM DUAL
WHERE EXISTS (SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_accounts')
  AND NOT EXISTS (SELECT 1 FROM `migrations` WHERE `name` = 'InitialSchema1786999727522');

-- SalesDeliveryReservationAndRbac — baseline if its tables already exist.
INSERT INTO `migrations` (`timestamp`, `name`)
SELECT 1788400000000, 'SalesDeliveryReservationAndRbac1788400000000' FROM DUAL
WHERE EXISTS (SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_deliveries')
  AND NOT EXISTS (SELECT 1 FROM `migrations` WHERE `name` = 'SalesDeliveryReservationAndRbac1788400000000');

-- CreateCodeSettings — baseline if the table already exists (added manually).
INSERT INTO `migrations` (`timestamp`, `name`)
SELECT 1788500000000, 'CreateCodeSettings1788500000000' FROM DUAL
WHERE EXISTS (SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'code_settings')
  AND NOT EXISTS (SELECT 1 FROM `migrations` WHERE `name` = 'CreateCodeSettings1788500000000');

-- BankAccountMultiBranch — baseline ONLY if it was already applied manually.
-- Normally the join table does NOT exist yet, so this inserts nothing and
-- `migration:run` will apply it for you.
INSERT INTO `migrations` (`timestamp`, `name`)
SELECT 1788600000000, 'BankAccountMultiBranch1788600000000' FROM DUAL
WHERE EXISTS (SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_account_branches')
  AND NOT EXISTS (SELECT 1 FROM `migrations` WHERE `name` = 'BankAccountMultiBranch1788600000000');

-- Review what was baselined:
SELECT `timestamp`, `name` FROM `migrations` ORDER BY `timestamp`;
