# Helpdesk Exámenes — examenes@centicsas.com.co

Bandeja tipo osTicket construida con Next.js 16 y desplegada en Vercel, sobre Supabase. El buzón vive en el cPanel de Hostinger.

- **Lectura:** IMAP de cPanel (INBOX + Enviados) **y de Gmail** (histórico y respuestas dadas desde Gmail), mediante polling desde el cron de cPanel cada 5 minutos.
- **Envío:** SMTP con `In-Reply-To`/`References`, para que la respuesta quede en el mismo hilo. Se guarda una copia en Enviados vía IMAP, así también se ve en el webmail.
- **SLA:** cuando se cumplen 10 días hábiles (Colombia, festivos con Ley Emiliani) sin entrega, se envía la plantilla `espera`.
- **IA vía Claude Code (MCP):** la app **no necesita API de IA**. Claude Code se conecta a `/api/mcp`, lee los correos, los clasifica (sentimiento, intención, urgencia), revisa el histórico (entregado, en espera o sin responder) y guarda 2-3 opciones de respuesta según las pautas de *Ajustes*. **No puede enviar correos:** un agente elige, edita y envía desde la app.
- **IA dentro de la app (opcional, futuro):** con `AI_PROVIDER=deepseek` (o `anthropic`), el cron hace ese trabajo solo, sin intervención.

```
Hostinger (correo) ──IMAP──► Next.js (Vercel) ◄──► Supabase (Postgres + Auth + Storage)
        ▲                        │   │
        └──────────SMTP──────────┘   ├──► /api/mcp  ◄── Claude Code (clasifica, triage, opciones)
                                     └──► DeepSeek API (opcional, AI_PROVIDER=deepseek)
cPanel cron ─curl─► /api/cron/sync (cada 5 min)
cPanel cron ─curl─► /api/cron/sla  (diario, 8:00 a.m. Bogotá)
```

## 1. Supabase

1. Aplique `supabase/migrations/20261124000000_init.sql`, ya sea por MCP, con `supabase db push` o desde el SQL Editor. La migración crea las tablas, RLS, el bucket privado `attachments`, las plantillas y las pautas por defecto.
2. Cree el primer usuario en **Authentication → Users → Add user**, con correo y contraseña.
3. Agréguelo a la allowlist como admin:
   ```sql
   insert into public.allowed_users (email, name, role)
   values ('su-correo@centicsas.com.co', 'Su Nombre', 'admin');
   ```
   Los demás usuarios se agregan desde **Ajustes** en la app, pero también deben existir en Supabase Auth.

## 2. Variables de entorno (Vercel)

Copie `.env.example`. Los datos IMAP y SMTP están en cPanel → **Cuentas de correo → Connect Devices**. Genere los secretos con `openssl rand -hex 32`.

`AI_PROVIDER=none` es el valor por defecto: la IA la pone Claude Code por MCP. Para que el cron trabaje solo en el futuro, use `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`.

## 3. Cron en cPanel (opción A)

1. Suba `cpanel/cron.sh` a `~/helpdesk/cron.sh`, edite `APP_URL` y `CRON_SECRET`, y ejecute `chmod 700 ~/helpdesk/cron.sh`.
2. En cPanel → **Trabajos de Cron**, cree estos dos trabajos:

| Frecuencia | Comando |
|---|---|
| `*/5 * * * *` | `/bin/bash $HOME/helpdesk/cron.sh sync` |
| `0 13 * * 1-5` | `/bin/bash $HOME/helpdesk/cron.sh sla` |

> `0 13 * * *` equivale a las 8:00 a.m. de Bogotá **si el servidor está en UTC**. Verifique la hora del servidor en cPanel y ajuste. El SLA también toma los vencidos de días anteriores, así que si un día no corre, se recupera al siguiente.

Los logs quedan en `~/helpdesk/cron-sync.log` y `~/helpdesk/cron-sla.log`.

## 4. Importación del histórico (Gmail + cPanel)

El equipo ha gestionado el buzón desde **Gmail**. Por eso muchas respuestas existen **solo en Gmail** y no en cPanel. La app lee tres fuentes y elimina los duplicados por `Message-ID`:

| Fuente | Qué aporta |
|---|---|
| Gmail → "Todos" (`\All`), filtrado a examenes@ | Recibidos y respondidos desde Gmail (lo principal del histórico) |
| cPanel INBOX | Lo que siga en el servidor (si Gmail usa POP y borra, puede estar incompleto) |
| cPanel Enviados | Enviados desde la app o el webmail |

Un correo es "nuestro" (salida) si lo envía `MAIL_ADDRESS`, `GMAIL_USER` u `OWN_ADDRESSES`.

**Preparar Gmail:**
1. Activar IMAP en Gmail → Configuración → Reenvío y correo POP/IMAP.
2. Activar la verificación en 2 pasos y crear una **contraseña de aplicación**.
3. Definir `GMAIL_USER` y `GMAIL_APP_PASSWORD`.

**Importar desde su computador** (sin el límite de 60 s de Vercel; se puede interrumpir y relanzar):
```bash
cp .env.example .env.local    # mismas variables que en Vercel
npm run backfill              # descarga todo (y hace triage solo si hay AI_PROVIDER)
npm run backfill -- --sync    # solo descarga
npm run backfill -- --triage  # solo triage
```

Luego, en Claude Code ejecute **`/mcp__helpdesk__triage`** (ver sección 5). Claude revisa los tickets en lotes de 10 y guarda el resultado.

**Qué hace el triage:** Claude (o DeepSeek, si está configurado) lee cada hilo importado (incluidos los nombres de los adjuntos) y decide:
- `entregado` → estado Entregado, con fecha y evidencia (por ejemplo "adjunto resultados.pdf").
- `pendiente_respuesta` → Abierto y en *Necesitan atención*.
- `en_espera` → En proceso. Si ya se había enviado un correo de espera, queda registrado y no se repite.
- `sin_accion` → Cerrado (spam, agradecimientos, etc.).

Mientras no se haga el triage, se usa una heurística: si el último mensaje es del cliente, el ticket queda como sin responder. La vista **Importados sin revisar** lista los pendientes de triage.

**Protección contra correos masivos:** el SLA **solo** actúa sobre tickets que vencen desde la fecha `sla_start_date` (en Ajustes, por defecto la fecha de la migración). En los tickets importados, actúa solo después del triage. Así el histórico nunca recibe el correo de espera automático.

Recomendación: durante la importación desactive "Enviar automáticamente" en Ajustes. Reactívelo después de revisar los resultados.

## 5. Claude Code por MCP (motor de IA)

**Conectar.** El repo trae `.mcp.json`. Abra Claude Code en esta carpeta con:
```bash
export HELPDESK_URL=https://TU-APP.vercel.app
export HELPDESK_MCP_TOKEN=<el MCP_TOKEN de Vercel>
claude
```
O regístrelo globalmente para usarlo desde cualquier carpeta:
```bash
claude mcp add --transport http --scope user helpdesk https://TU-APP.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

**Comandos (prompts MCP):**

| Comando | Qué hace |
|---|---|
| `/mcp__helpdesk__resumen` | Estado del buzón: vencidos, sin responder, por vencer |
| `/mcp__helpdesk__clasificar` | Clasifica correos nuevos y propone respuestas a los molestos |
| `/mcp__helpdesk__molestos` | Propone 3 opciones de respuesta por cada cliente molesto |
| `/mcp__helpdesk__triage` | Revisa el histórico importado (entregado / en espera / sin responder) |

También acepta peticiones libres, por ejemplo *"propón respuestas para el ticket #123, el examen sale el viernes"*.

**Herramientas:**

| Herramienta | Qué hace |
|---|---|
| `get_pending_work` | Conteo de todo lo pendiente |
| `list_tickets` | Lista tickets por filtro o búsqueda |
| `get_ticket` | Un ticket con su hilo completo |
| `search_messages` | Búsqueda de texto en todos los correos |
| `get_guidelines` | Pautas, firma, SLA y plantillas |
| `get_triage_batch` + `save_triage` | Leer y guardar el estado de tickets importados |
| `get_classification_batch` + `save_classification` | Leer y guardar la clasificación de correos nuevos |
| `save_reply_options` | Guarda opciones de respuesta (no envía) |

**Automatizar sin API:** en una sesión de Claude Code abierta use `/loop 30m /mcp__helpdesk__clasificar`. Claude revisa cada 30 minutos mientras la sesión esté abierta.

**Importante:** sin `AI_PROVIDER`, los correos nuevos **no se clasifican solos**. Si nadie corre `/clasificar`, un cliente molesto aparece como "neutral". Hay dos consecuencias:
- Solo el filtro *Molestos* depende de esa clasificación. *Necesitan atención* y *Vencidos* funcionan igual.
- La protección "no enviar el correo de espera automático a molestos" solo cubre a los que ya estén clasificados.

## 6. Reglas del SLA

- **Día 0** = fecha del primer correo del solicitante (hora Bogotá). El vencimiento es el **décimo día hábil siguiente**, por ejemplo: solicitud el 24-nov-2026 → vence el 9-dic-2026 (8-dic es festivo).
- El correo de espera se envía **una sola vez** por ticket, con reserva atómica en la BD.
- No se envía si el ticket está entregado o cerrado.
- No se envía si **el cliente está molesto** y la opción "No enviar automático a clientes molestos" está activa. En ese caso queda en *Necesitan atención* para decidir a mano; hay un botón "Enviar correo de espera".
- Cambiar los días hábiles en Ajustes afecta solo a los tickets nuevos.

## 7. Agrupación de hilos

1. Por `In-Reply-To`/`References` contra los Message-ID guardados.
2. Si no hay coincidencia, por el mismo remitente + el asunto normalizado (sin `RE:`/`RV:`), dentro de ±90 días de la fecha del correo.
3. Si tampoco coincide, se crea un ticket nuevo. Las autorespuestas y los rebotes sueltos se ignoran.
4. Si una respuesta nuestra llega antes que el correo original (fuentes distintas), queda "huérfana" y se re-enlaza en la siguiente sincronización.

Si el solicitante responde un ticket entregado o cerrado, el ticket se reabre.

## Límites conocidos

- Los adjuntos salientes tienen un máximo de **~4 MB** por envío (límite de Vercel). Para archivos más grandes use el webmail; el envío se sincroniza al hilo desde Enviados.
- Hostinger limita los envíos SMTP por hora según el plan.
- Verifique SPF, DKIM y DMARC del dominio en cPanel → Email Deliverability.
- **Datos personales:** el contenido de los correos se procesa con la API de Anthropic. Valide esto con su política de tratamiento de datos (Ley 1581).

## Desarrollo

```bash
cp .env.example .env.local   # complete los valores
npm run dev
# probar sync manual:
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/sync
```
