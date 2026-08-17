-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "characterId" INTEGER NOT NULL,
    "simcText" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "addonVersion" TEXT,
    "wowVersion" TEXT,
    "exportedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submission_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "roster_character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_submission" ("addonVersion", "characterId", "createdAt", "exportedAt", "id", "simcText", "spec", "userId", "wowVersion") SELECT "addonVersion", "characterId", "createdAt", "exportedAt", "id", "simcText", "spec", "userId", "wowVersion" FROM "submission";
DROP TABLE "submission";
ALTER TABLE "new_submission" RENAME TO "submission";
CREATE INDEX "submission_characterId_createdAt_idx" ON "submission"("characterId", "createdAt");
CREATE INDEX "submission_characterId_contentHash_idx" ON "submission"("characterId", "contentHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
