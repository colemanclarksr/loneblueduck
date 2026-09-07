-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "phoneDigits" TEXT;

-- CreateIndex
CREATE INDEX "Customer_tenantId_phoneDigits_idx" ON "Customer"("tenantId", "phoneDigits");
