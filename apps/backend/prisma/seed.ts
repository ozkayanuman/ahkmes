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

  const machines = [
    { name: "Tezgah 1", model: "SMEC MCV-5500", controller: "Fanuc (seri teyit edilecek)" },
    { name: "Tezgah 2", model: "SMEC MCV-5500", controller: "Fanuc (seri teyit edilecek)" },
  ];
  for (const m of machines) {
    const existing = await prisma.machine.findFirst({
      where: { tenantId: DEFAULT_TENANT_ID, name: m.name },
    });
    if (!existing) {
      await prisma.machine.create({ data: { tenantId: DEFAULT_TENANT_ID, ...m } });
    }
  }

  console.log("Seed tamam: tenant + admin + 2 tezgah");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
