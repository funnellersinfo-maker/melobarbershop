// Seed de MELO BARBERSHOP.
// Crea: propietario, 3 barberos, catálogo con precios de demostración (editables),
// autorizaciones de servicio y disponibilidad semanal.
// NO crea reglas de comisión ni valores económicos definitivos: el propietario los
// configura desde el panel (requisito C).
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const db = new PrismaClient();

const BOGOTA_TZ = "America/Bogota";

async function main() {
  const ownerEmail = "owner@melo.com";
  const existing = await db.user.findFirst({ where: { role: "OWNER" } });
  if (existing) {
    console.log("Seed ya ejecutado anteriormente (existe OWNER). Nada por hacer.");
    return;
  }

  const pass = hashPassword("melo1234");

  await db.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      name: "Melo (Propietario)",
      phone: "+573001234567",
      passwordHash: pass,
      role: "OWNER",
      permissions: "{}",
    },
  });
  console.log("OK owner@melo.com / melo1234");

  const barbers = [
    { email: "santiago@melo.com", name: "Santiago Ruiz", phone: "+573011111111" },
    { email: "andres@melo.com", name: "Andrés Gómez", phone: "+573012222222" },
    { email: "camilo@melo.com", name: "Camilo Torres", phone: "+573013333333" },
  ];
  for (const b of barbers) {
    await db.user.upsert({
      where: { email: b.email },
      update: {},
      create: {
        email: b.email,
        name: b.name,
        phone: b.phone,
        passwordHash: pass,
        role: "BARBER",
        permissions: "{}", // sin permisos excepcionales por defecto
      },
    });
    console.log(`OK ${b.email} / melo1234`);
  }

  // Catálogo: precios y duraciones de demostración, editables desde el panel del propietario.
  const services = [
    { name: "Corte Clásico", description: "Corte a tijera y máquina, acabado con toalla caliente.", price: 35000, durationMin: 45, sortOrder: 1 },
    { name: "Corte + Barba", description: "Corte completo más arreglo de barba con navaja.", price: 50000, durationMin: 60, sortOrder: 2 },
    { name: "Arreglo de Barba", description: "Perfilado, rasurado y aceites.", price: 20000, durationMin: 25, sortOrder: 3 },
    { name: "Diseño y Afinado", description: "Líneas, diseño personalizado y acabado.", price: 18000, durationMin: 20, sortOrder: 4 },
    { name: "Lavado Capilar", description: "Lavado con masaje y secado.", price: 15000, durationMin: 20, sortOrder: 5 },
    { name: "Corte Infantil", description: "Corte para menores, incluye acabado.", price: 25000, durationMin: 35, sortOrder: 6 },
  ];
  const createdServices = [];
  for (const s of services) {
    const svc = await db.service.upsert({
      where: { id: `svc-${s.sortOrder}` },
      update: {},
      create: { id: `svc-${s.sortOrder}`, ...s },
    });
    createdServices.push(svc);
  }
  console.log(`OK ${createdServices.length} servicios de demostración (editables en Catálogo)`);

  // Autorización: por defecto todos los barberos pueden ofrecer todos los servicios.
  const allBarbers = await db.user.findMany({ where: { role: "BARBER" } });
  for (const b of allBarbers) {
    for (const svc of createdServices) {
      await db.barberService.upsert({
        where: { barberId_serviceId: { barberId: b.id, serviceId: svc.id } },
        update: {},
        create: { barberId: b.id, serviceId: svc.id, authorized: true },
      });
    }
    // Disponibilidad: martes a sábado, 10:00-13:00 y 14:00-19:00 (hora Bogotá)
    for (let day = 2; day <= 6; day++) {
      await db.availability.create({
        data: { barberId: b.id, dayOfWeek: day, startTime: "10:00", endTime: "13:00", active: true },
      });
      await db.availability.create({
        data: { barberId: b.id, dayOfWeek: day, startTime: "14:00", endTime: "19:00", active: true },
      });
    }
    console.log(`OK disponibilidad y servicios autorizados para ${b.name} (${BOGOTA_TZ})`);
  }

  console.log("SEED COMPLETO");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
