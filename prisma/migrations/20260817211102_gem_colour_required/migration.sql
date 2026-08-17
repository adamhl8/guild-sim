/*
  Warnings:

  - Added the required column `sortIndex` to the `gem` table without a default value. This is not possible if the table is not empty.
  - Made the column `color` on table `gem` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_gem" (
    "itemId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "displayName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    "syncedAt" DATETIME NOT NULL
);
-- Deliberately not copied. The old rows include colourless gems Raidbots never offered and have no sortIndex, and this
-- table is a cache of Raidbots' enchantment data that the boot and daily syncs repopulate.
DROP TABLE "gem";
ALTER TABLE "new_gem" RENAME TO "gem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
