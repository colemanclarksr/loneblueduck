-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "hourlyCostCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Technician_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Technician_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Technician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicianJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "startedAt" DATETIME,
    "stoppedAt" DATETIME,
    "billedHours" REAL NOT NULL DEFAULT 0,
    "actualMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TechnicianJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TechnicianJob_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TechnicianJob_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Technician_tenantId_idx" ON "Technician"("tenantId");

-- CreateIndex
CREATE INDEX "Technician_tenantId_active_idx" ON "Technician"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Technician_userId_idx" ON "Technician"("userId");

-- CreateIndex
CREATE INDEX "TechnicianJob_tenantId_idx" ON "TechnicianJob"("tenantId");

-- CreateIndex
CREATE INDEX "TechnicianJob_tenantId_repairOrderId_idx" ON "TechnicianJob"("tenantId", "repairOrderId");

-- CreateIndex
CREATE INDEX "TechnicianJob_tenantId_technicianId_idx" ON "TechnicianJob"("tenantId", "technicianId");

-- CreateIndex
CREATE INDEX "TechnicianJob_technicianId_startedAt_idx" ON "TechnicianJob"("technicianId", "startedAt");
