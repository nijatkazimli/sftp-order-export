-- AlterTable
ALTER TABLE "MerchantConfig" ADD COLUMN     "authMethod" TEXT NOT NULL DEFAULT 'password',
ADD COLUMN     "sftpKeyIv" TEXT,
ADD COLUMN     "sftpPrivateKeyEncrypted" TEXT,
ALTER COLUMN "sftpPasswordEncrypted" DROP NOT NULL,
ALTER COLUMN "sftpIv" DROP NOT NULL;
