-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "filed" BOOLEAN NOT NULL DEFAULT false,
    "filedAt" TIMESTAMP(3),
    "market" JSONB NOT NULL DEFAULT '[]',
    "supplier" JSONB NOT NULL DEFAULT '{}',
    "compliance" JSONB NOT NULL DEFAULT '{}',
    "costing" JSONB NOT NULL DEFAULT '{}',
    "po" JSONB NOT NULL DEFAULT '{}',
    "payments" JSONB NOT NULL DEFAULT '[]',
    "production" JSONB NOT NULL DEFAULT '{}',
    "qc" JSONB NOT NULL DEFAULT '{}',
    "logistics" JSONB NOT NULL DEFAULT '{}',
    "working" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FACTORY',
    "verification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "city" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "productLines" TEXT NOT NULL DEFAULT '',
    "certNumber" TEXT NOT NULL DEFAULT '',
    "certImage" TEXT NOT NULL DEFAULT '',
    "repName" TEXT NOT NULL DEFAULT '',
    "repNumber" TEXT NOT NULL DEFAULT '',
    "repWechat" TEXT NOT NULL DEFAULT '',
    "repWechatQr" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "moq" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "catalogs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_filed_idx" ON "Product"("filed");

-- CreateIndex
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt");

-- CreateIndex
CREATE INDEX "Manufacturer_type_idx" ON "Manufacturer"("type");

-- CreateIndex
CREATE INDEX "Manufacturer_createdAt_idx" ON "Manufacturer"("createdAt");
