/*
  Warnings:

  - The `additionalFiles` column on the `doctor` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "doctor" ADD COLUMN     "resumePublicid" TEXT,
DROP COLUMN "additionalFiles",
ADD COLUMN     "additionalFiles" JSONB;
