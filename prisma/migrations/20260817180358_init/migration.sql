-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "roster_character" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "blizzardId" TEXT NOT NULL,
    "unsupportedSpec" TEXT,
    "syncedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "character_claim" (
    "userId" TEXT NOT NULL,
    "characterId" INTEGER NOT NULL,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "characterId"),
    CONSTRAINT "character_claim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "character_claim_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "roster_character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "characterId" INTEGER NOT NULL,
    "simcText" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "addonVersion" TEXT,
    "wowVersion" TEXT,
    "exportedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submission_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "roster_character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sim_job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "sourceName" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "simId" TEXT,
    "error" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "sim_job_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "source" (
    "raidbotsId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "seasonNumber" INTEGER,
    "syncedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "settings" (
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "quota_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "submits" TEXT NOT NULL DEFAULT '',
    "quotaResetAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "roster_character_blizzardId_key" ON "roster_character"("blizzardId");

-- CreateIndex
CREATE INDEX "character_claim_characterId_idx" ON "character_claim"("characterId");

-- CreateIndex
CREATE INDEX "submission_characterId_createdAt_idx" ON "submission"("characterId", "createdAt");

-- CreateIndex
CREATE INDEX "sim_job_status_queuedAt_idx" ON "sim_job"("status", "queuedAt");
