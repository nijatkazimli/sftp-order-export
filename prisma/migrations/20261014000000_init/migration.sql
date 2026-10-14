-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sftpHost" TEXT NOT NULL,
    "sftpPort" INTEGER NOT NULL DEFAULT 22,
    "sftpUsername" TEXT NOT NULL,
    "sftpPasswordEncrypted" TEXT NOT NULL,
    "sftpIv" TEXT NOT NULL,
    "targetDirectory" TEXT NOT NULL DEFAULT '/upload',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantConfig_shop_key" ON "MerchantConfig"("shop");

-- CreateIndex
CREATE INDEX "ExportLog_shop_createdAt_idx" ON "ExportLog"("shop", "createdAt");

