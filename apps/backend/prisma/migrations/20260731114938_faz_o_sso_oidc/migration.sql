-- AlterEnum
ALTER TYPE "UserAuthSource" ADD VALUE 'OIDC';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "oidcProviderId" TEXT;

-- CreateTable
CREATE TABLE "OidcProvider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'openid email profile',
    "emailClaim" TEXT NOT NULL DEFAULT 'email',
    "defaultRole" "Role" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OidcProvider_tenantId_idx" ON "OidcProvider"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OidcProvider_tenantId_name_key" ON "OidcProvider"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_oidcProviderId_fkey" FOREIGN KEY ("oidcProviderId") REFERENCES "OidcProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
