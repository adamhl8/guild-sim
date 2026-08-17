-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "wowauditConfigurationName" TEXT NOT NULL DEFAULT 'Default',
    "replaceManualEdits" BOOLEAN NOT NULL DEFAULT true,
    "ranks" TEXT NOT NULL DEFAULT 'GM,Officer,Raider',
    "adminRanks" TEXT NOT NULL DEFAULT 'GM,Officer',
    "source" TEXT NOT NULL DEFAULT 'season',
    "difficulties" TEXT NOT NULL DEFAULT 'mythic',
    "simcVersion" TEXT NOT NULL DEFAULT 'weekly',
    "iterations" TEXT NOT NULL DEFAULT 'smart',
    "fightStyle" TEXT NOT NULL DEFAULT 'Patchwerk',
    "fightLength" INTEGER NOT NULL DEFAULT 300,
    "enemyCount" INTEGER NOT NULL DEFAULT 1,
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "submitsPerHour" INTEGER NOT NULL DEFAULT 40,
    "pollIntervalMs" INTEGER NOT NULL DEFAULT 7000,
    "buildCheck" TEXT NOT NULL DEFAULT 'exact',
    "maxPasteAgeDays" INTEGER NOT NULL DEFAULT 3,
    "liveWowBuild" TEXT,
    "region" TEXT NOT NULL DEFAULT 'us',
    "currentSeasonNumber" INTEGER,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_settings" ("adminRanks", "buildCheck", "concurrency", "difficulties", "enemyCount", "fightLength", "fightStyle", "id", "iterations", "liveWowBuild", "maxPasteAgeDays", "pollIntervalMs", "ranks", "replaceManualEdits", "simcVersion", "source", "submitsPerHour", "updatedAt", "wowauditConfigurationName") SELECT "adminRanks", "buildCheck", "concurrency", "difficulties", "enemyCount", "fightLength", "fightStyle", "id", "iterations", "liveWowBuild", "maxPasteAgeDays", "pollIntervalMs", "ranks", "replaceManualEdits", "simcVersion", "source", "submitsPerHour", "updatedAt", "wowauditConfigurationName" FROM "settings";
DROP TABLE "settings";
ALTER TABLE "new_settings" RENAME TO "settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
