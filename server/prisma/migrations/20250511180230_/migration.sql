/*
  Warnings:

  - You are about to drop the column `description` on the `File` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `File` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "File" DROP COLUMN "description",
DROP COLUMN "tags",
ALTER COLUMN "fileType" DROP NOT NULL;
