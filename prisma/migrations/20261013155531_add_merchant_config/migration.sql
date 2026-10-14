-- CreateTable
CREATE TABLE "MerchantConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "sftpHost" TEXT NOT NULL,
    "sftpPort" INTEGER NOT NULL DEFAULT 22,
    "sftpUsername" TEXT NOT NULL,
    "sftpPasswordEncrypted" TEXT NOT NULL,
    "sftpIv" TEXT NOT NULL,
    "targetDirectory" TEXT NOT NULL DEFAULT '/upload',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantConfig_shop_key" ON "MerchantConfig"("shop");
