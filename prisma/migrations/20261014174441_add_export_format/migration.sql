-- AlterTable
ALTER TABLE "MerchantConfig" ADD COLUMN     "csvColumns" TEXT,
ADD COLUMN     "filenameTemplate" TEXT NOT NULL DEFAULT 'order-{order}.csv';
