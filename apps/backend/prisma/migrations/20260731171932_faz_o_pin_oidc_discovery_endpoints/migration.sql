/*
  Warnings:

  - Added the required column `authorizationEndpoint` to the `OidcProvider` table without a default value. This is not possible if the table is not empty.
  - Added the required column `jwksUri` to the `OidcProvider` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tokenEndpoint` to the `OidcProvider` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OidcProvider" ADD COLUMN     "authorizationEndpoint" TEXT NOT NULL,
ADD COLUMN     "jwksUri" TEXT NOT NULL,
ADD COLUMN     "tokenEndpoint" TEXT NOT NULL;
