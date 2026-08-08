-- Product.qrGen and the CachedProduct table were added to schema.prisma but never
-- got a migration, so any DB brought up with `prisma migrate deploy` is missing
-- them and every product create/update fails. IF NOT EXISTS keeps this safe on
-- databases that already got them via `prisma db push`.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "qrGen" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE IF NOT EXISTS "CachedProduct" (
    "id" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "imageHash" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "supplierName" TEXT NOT NULL DEFAULT '',
    "priceUsd" DOUBLE PRECISION,
    "priceInr" DOUBLE PRECISION,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "country" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "dedupeKey" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CachedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CachedProduct_dedupeKey_key" ON "CachedProduct"("dedupeKey");
CREATE INDEX IF NOT EXISTS "CachedProduct_queryHash_idx" ON "CachedProduct"("queryHash");
CREATE INDEX IF NOT EXISTS "CachedProduct_imageHash_idx" ON "CachedProduct"("imageHash");
CREATE INDEX IF NOT EXISTS "CachedProduct_platform_idx" ON "CachedProduct"("platform");
CREATE INDEX IF NOT EXISTS "CachedProduct_createdAt_idx" ON "CachedProduct"("createdAt");
