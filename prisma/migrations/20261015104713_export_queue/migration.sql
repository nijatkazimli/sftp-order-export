/*
  Warnings:

  - You are about to drop the `ExportLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "MerchantConfig" ADD COLUMN     "exportTrigger" TEXT NOT NULL DEFAULT 'created';

-- DropTable
DROP TABLE "ExportLog";

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "payloadEncrypted" TEXT,
    "payloadIv" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_status_nextAttemptAt_idx" ON "ExportJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ExportJob_shop_createdAt_idx" ON "ExportJob"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_shop_orderId_key" ON "ExportJob"("shop", "orderId");
