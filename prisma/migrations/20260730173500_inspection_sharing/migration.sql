-- AlterTable
ALTER TABLE "InspectionItem" ADD COLUMN "section" TEXT;

-- AlterTable
ALTER TABLE "InspectionResult" ADD COLUMN "sentAt" DATETIME;
ALTER TABLE "InspectionResult" ADD COLUMN "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InspectionResult_shareToken_key" ON "InspectionResult"("shareToken");
