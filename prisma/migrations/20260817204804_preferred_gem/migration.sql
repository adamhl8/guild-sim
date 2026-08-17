-- AlterTable
ALTER TABLE "roster_character" ADD COLUMN "preferredGemId" INTEGER;

-- AlterTable
ALTER TABLE "submission" ADD COLUMN "gemId" INTEGER;

-- CreateTable
CREATE TABLE "gem" (
    "itemId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "displayName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "color" TEXT,
    "syncedAt" DATETIME NOT NULL
);
