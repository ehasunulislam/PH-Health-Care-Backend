/*
  Warnings:

  - You are about to drop the column `qulificaitons` on the `doctor` table. All the data in the column will be lost.
  - Added the required column `qualifications` to the `doctor` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "doctor" DROP COLUMN "qulificaitons",
ADD COLUMN     "qualifications" TEXT NOT NULL;
