-- CreateEnum
CREATE TYPE "UserAuthSource" AS ENUM ('LOCAL', 'LDAP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authSource" "UserAuthSource" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "externalDn" TEXT;

-- CreateTable
CREATE TABLE "PermissionGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pages" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "UserPermissionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LdapConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 389,
    "useTls" BOOLEAN NOT NULL DEFAULT false,
    "bindDn" TEXT NOT NULL,
    "bindPasswordEnc" TEXT NOT NULL,
    "baseDn" TEXT NOT NULL,
    "userFilter" TEXT NOT NULL DEFAULT '(objectClass=person)',
    "attrEmail" TEXT NOT NULL DEFAULT 'mail',
    "attrName" TEXT NOT NULL DEFAULT 'displayName',
    "defaultRole" "Role" NOT NULL DEFAULT 'OPERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LdapConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionGroup_tenantId_idx" ON "PermissionGroup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGroup_tenantId_name_key" ON "PermissionGroup"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionGroup_userId_groupId_key" ON "UserPermissionGroup"("userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "LdapConfig_tenantId_key" ON "LdapConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "UserPermissionGroup" ADD CONSTRAINT "UserPermissionGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionGroup" ADD CONSTRAINT "UserPermissionGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PermissionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
