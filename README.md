# MELO BARBERSHOP — Sistema de reservas y gestión

**Más que un corte, una experiencia…**

Aplicación completa para la operación de la barbería: reservas públicas web, agenda
interna compartida, pagos, comisiones con copia histórica, liquidaciones, gastos,
reportes financieros, notificaciones internas e integración de WhatsApp Business.

Implementa íntegramente el «Modelo operativo y financiero» definido por el
propietario (secciones A–H de la configuración), incluidas las 10 validaciones de
entrega.

---

## 1. Stack técnico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| UI | Tailwind CSS 4 + shadcn/ui (New York) + Lucide |
| Base de datos | SQLite + Prisma ORM (`db/custom.db`) |
| Autenticación | Sesiones propias (cookie httpOnly + tabla `Session`), contraseñas con scrypt |
| Notificaciones | Internas (BD, siempre operativas) + WhatsApp Cloud API (opcional) |
| Zona horaria | America/Bogotá (UTC-5 fijo, sin DST) en todo el sistema |

## 2. Puesta en marcha

```bash
bun install                 # dependencias
bun run db:push             # (o) bunx prisma migrate dev — aplica las migraciones
bun prisma/seed.ts          # datos iniciales: propietario, 3 barberos, catálogo demo
bun run dev                 # servidor en http://localhost:3000
```

Las **migraciones** están en `prisma/migrations/20261029200912_init/` (esquema
completo). Para regenerar la base desde cero:

```bash
rm -f db/custom.db && bunx prisma migrate dev && bun prisma/seed.ts
```

### Cuentas de demostración (contraseña inicial `melo1234`)

| Rol | Correo | Alcance |
|---|---|---|
| Propietario | `owner@melo.com` | Control total del negocio |
| Barbero | `santiago@melo.com` / `andres@melo.com` / `camilo@melo.com` | Su agenda, sus ventas y sus comisiones |

> Cambie las contraseñas desde **Equipo → Perfil y permisos** antes de uso real.
> Los precios, duraciones y comisiones del seed son de demostración: configúrelos
> desde el panel (Catálogo y Comisiones). El sistema no trae porcentajes inventados.

## 3. Configuración de WhatsApp (opcional)

Credenciales **solo por variables de entorno** (`.env`), nunca en el navegador:

```env
WHATSAPP_TOKEN=EAAG...                        # token permanente (Meta Business)
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_API_URL=https://graph.facebook.com   # proveedor compatible con Cloud API
WHATSAPP_API_VERSION=v22.0
WHATSAPP_MESSAGE_MODE=text                    # o "template" para plantillas aprobadas
```

- **Sin credenciales**: la agenda y las notificaciones internas siguen
  funcionando; la integración aparece como «Pendiente de configuración» y los
  mensajes quedan en estado `PENDING_CONFIG`. Nunca se afirma un envío.
- **Con credenciales**: confirmaciones al cliente al reservar/reprogramar/cancelar,
  recordatorios 2 h antes (programador interno cada 60 s) y alertas al personal.
- Robustez: `dedupKey` por evento (sin duplicados), máx. 3 reintentos con espera
  creciente, identificador de mensaje del proveedor, reintento manual desde el
  panel y fallo controlado si el proveedor responde con error.
- Incluye un **proveedor simulado** (`/api/whatsapp/mock/...`) para pruebas:
  números con `999` fallan siempre, con `888` fallan dos veces y salen a la
  tercera (ver `scripts/e2e-tests.ts`, fase B).

## 4. Modelo operativo y financiero implementado

- **Flujo de cita (B)**: `RESERVADA → CONFIRMADA → EN ATENCIÓN → COMPLETADA`
  (o `CANCELADA` / `AUSENCIA`). Las transiciones se validan en el servidor.
- **Pago separado de la cita (B)**: registrar pago es una acción posterior a
  completar; idempotente por `clientRequestId` y con tope del valor neto —
  nunca se contabiliza dos veces una misma venta (H.5).
- **Comisiones (C)**: reglas por barbero y opcionalmente por servicio;
  `PERCENT` (sobre venta neta = precio − descuento), `FIXED` o `MIXED`.
  Cada operación completada guarda un **snapshot inmutable** (regla, precio,
  descuento, resultado). Cambios de regla crean una versión nueva cerrando la
  anterior con `validTo`; las comisiones históricas jamás se modifican (H.9).
  Las comisiones sin regla vigente quedan «por definir» y el propietario puede
  fijarlas manualmente con motivo y auditoría.
- **Ajustes (C)**: anticipos y devoluciones (restan en la liquidación) y ajustes
  manuales con signo; siempre con motivo y registro de auditoría.
- **Liquidaciones (C)**: borrador → aprobada → pagada. Los totales los calcula
  el servidor (comisiones pendientes + ajustes con signo). El barbero no puede
  aprobar las suyas salvo permiso excepcional `settlements.approveOwn`.
- **Métricas sin doble contabilización (C/D)**: ventas y comisiones por fecha de
  completado; caja por fecha de transacción. Resultado operativo =
  `ventas netas − comisiones generadas − gastos` (cada concepto se descuenta una
  sola vez). Los pagos a barberos afectan el flujo de caja, no el resultado.
- **Permisos (A/E)**: el propietario conserva el control general; los barberos
  solo ven su propia información financiera. Permisos excepcionales
  (`finance.viewOthers`, `schedule.manageOwn`, `settlements.approveOwn`)
  configurables por el propietario y **validados en el servidor** en cada
  petición (H.7).
- **Reservas (F)**: la página pública comparte base de datos, validaciones e
  historial con la agenda interna. Opción «cualquier barbero» con reparto
  equilibrado. Ni público ni manual pueden ocupar el mismo barbero en
  intervalos incompatibles (mutex de proceso + re-chequeo transaccional) (H.1–H.3).
- **Auditoría (D)**: todo cambio relevante (citas, pagos, reglas, liquidaciones,
  ajustes, gastos, catálogo, equipo, disponibilidad) queda con antes/después y
  autor en **Historial**.

## 5. Estructura relevante

```
prisma/schema.prisma           # modelo de datos completo
prisma/migrations/…            # migración inicial
prisma/seed.ts                 # datos iniciales (propietario, barberos, catálogo)
src/lib/                       # núcleo: auth, rbac, booking, commission, finance,
                               #        whatsapp, notify, scheduler, audit, time, money
src/app/api/…                  # API: auth, public (catálogo/slots/book), appointments,
                               #        payments (+refund), commissions (+config, +manual),
                               #        settlements (+approve, +pay), adjustments, expenses,
                               #        services, workers (+services, +availability),
                               #        reports (summary, breakdown), cash, dashboard,
                               #        notifications, whatsapp (status/test/retry/mock), audit
src/components/melo/           # vistas: pública, login, shell, agenda, dashboards,
                               #        pagos, comisiones, liquidaciones, ajustes/gastos,
                               #        equipo/catálogo, reportes, notificaciones/config
scripts/e2e-tests.ts           # validación real de los 10 escenarios (requisito H)
```

## 6. Pruebas ejecutadas (requisito H)

Contra el sistema real en marcha (`bun scripts/e2e-tests.ts all`):

| # | Escenario | Resultado |
|---|---|---|
| 1 | Reserva pública visible en el calendario interno | ✅ PASS |
| 2 | Cita manual respeta disponibilidad (domingo y 13:30 rechazados; ventana válida aceptada) | ✅ PASS |
| 3 | El mismo horario no se reserva dos veces (público↔manual, solape parcial) | ✅ PASS |
| 4 | Servicio completado genera pago + comisión con snapshot histórico | ✅ PASS |
| 5 | Un pago no se contabiliza dos veces (idempotencia + tope del neto) | ✅ PASS |
| 6 | Propietario ve consolidado (ventas, caja, comisiones, resultado; desglose por barbero/servicio) | ✅ PASS |
| 7 | Barbero sin permiso no accede a finanzas ajenas (403 en reportes, reglas, gastos; alcance forzado en servidor; permiso excepcional concede y revoca) | ✅ PASS |
| 8 | Liquidación refleja comisiones y pagos (totales de servidor, aprobar/pagar, comisiones PAID, egreso en caja) | ✅ PASS |
| 9 | Cambios de tarifas/reglas no alteran operaciones históricas (comisión, base, snapshot y priceSnapshot intactos) | ✅ PASS |
| 10 | WhatsApp: sin configurar falla de forma controlada (PENDING_CONFIG, agenda operativa); con proveedor simulado envía con id `wamid`, reintenta transitorios (3.er intento), falla controlado tras 3 intentos, sin duplicados | ✅ PASS |

**Total: 68/68 verificaciones PASS** (salida completa en
`download/validacion-e2e-salida.txt`). Incluye además verificación end-to-end en
navegador real del flujo: reserva web (wizard 4 pasos) → calendario → confirmar →
en atención → completar con descuento → registrar pago → comisiones/reportes/caja,
paneles de ambos roles y diseño responsivo.

Reproducir las pruebas:

```bash
bun scripts/e2e-tests.ts smoke    # humo rápido
bun scripts/e2e-tests.ts all      # las 10 validaciones + reinicios de WhatsApp simulado
```

## 7. Notas de operación

- **Dinero**: enteros en COP sin decimales; formato `$ 35.000` en la interfaz.
- **Programador**: los recordatorios y reintentos de WhatsApp corren dentro del
  proceso de Next.js (`src/instrumentation.ts`), sin servicios externos.
- **Cambio de precio en Catálogo**: solo afecta reservas futuras; las citas
  guardan su propia copia (`priceSnapshot`) y las comisiones su snapshot.
- **Devoluciones de pagos**: reducen el cobrado; no tocan automáticamente la
  comisión del barbero (use Ajustes con motivo, como exige el modelo).
