import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("SEED_ADMIN_PASSWORD env değişkeni tanımlı olmalı (.env)");
  }

  await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: { id: DEFAULT_TENANT_ID, name: "AHK Talaşlı İmalat" },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      name: "Sistem Yöneticisi",
      role: "ADMIN",
    },
  });

  // Makine kaynaklı (source=MACHINE) ProductionRun kayıtları için sistem hesabı —
  // normal login akışına kapalı (rastgele, bilinmeyen şifre).
  const connectorEmail = "machine-connector@ahkmes.local";
  await prisma.user.upsert({
    where: { email: connectorEmail },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      email: connectorEmail,
      passwordHash: await bcrypt.hash(randomUUID(), 10),
      name: "Makine Bağlantısı",
      role: "OPERATOR",
    },
  });

  // Saha hiyerarşisi (Plant > Area > Workplace > Unit) — Hiyerarşi sayfası ve
  // Digital Twin'in üzerine kurulacağı varsayılan iskelet.
  const plant = await prisma.plant.upsert({
    where: { tenantId_name: { tenantId: DEFAULT_TENANT_ID, name: "AHK Fabrika" } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, name: "AHK Fabrika" },
  });
  const area = await prisma.area.upsert({
    where: { plantId_name: { plantId: plant.id, name: "Talaşlı İmalat" } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, plantId: plant.id, name: "Talaşlı İmalat" },
  });
  const workplace = await prisma.workplace.upsert({
    where: { areaId_name: { areaId: area.id, name: "CNC Hattı" } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, areaId: area.id, name: "CNC Hattı" },
  });

  const machines = [
    { name: "Tezgah 1", model: "SMEC 5500", controller: "Mitsubishi M80" },
    { name: "Tezgah 2", model: "SMEC 5500", controller: "Mitsubishi M80" },
  ];
  for (const [i, m] of machines.entries()) {
    const unit = await prisma.unit.upsert({
      where: { workplaceId_name: { workplaceId: workplace.id, name: m.name } },
      update: {},
      create: { tenantId: DEFAULT_TENANT_ID, workplaceId: workplace.id, name: m.name },
    });
    const existing = await prisma.machine.findFirst({
      where: { tenantId: DEFAULT_TENANT_ID, name: m.name },
    });
    // Digital Twin'de varsayılan bir yerleşim görülsün diye — kullanıcı sürükleyip
    // taşıdıktan sonra existing.posX dolu olacağından tekrar ezilmez.
    const defaultPos = { posX: 80 + i * 160, posY: 80 };
    if (!existing) {
      await prisma.machine.create({ data: { tenantId: DEFAULT_TENANT_ID, unitId: unit.id, ...m, ...defaultPos } });
    } else {
      // Model/controller güncel bilgiyle düzeltilir; unitId/posX-Y sadece boşsa doldurulur
      // (kullanıcının hiyerarşi/dijital ikiz sayfasından yaptığı manuel değişiklik ezilmez).
      await prisma.machine.update({
        where: { id: existing.id },
        data: {
          model: m.model,
          controller: m.controller,
          ...(existing.unitId ? {} : { unitId: unit.id }),
          ...(existing.posX === null ? defaultPos : {}),
        },
      });
    }
  }

  console.log("Seed tamam: tenant + admin + hiyerarşi (AHK Fabrika > Talaşlı İmalat > CNC Hattı) + 2 tezgah");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
