-- ============================================================
-- Helpdesk examenes@centicsas.com.co — esquema inicial
-- ============================================================

-- ---------- Tipos ----------
create type public.ticket_status as enum ('abierto', 'en_proceso', 'entregado', 'cerrado');
create type public.ticket_sentiment as enum ('neutral', 'molesto', 'muy_molesto');
create type public.message_direction as enum ('in', 'out');

-- ---------- Utilidad: updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Usuarios permitidos (allowlist) ----------
create table public.allowed_users (
  email text primary key check (email = lower(email)),
  name text,
  role text not null default 'agent' check (role in ('admin', 'agent')),
  created_at timestamptz not null default now()
);

-- ¿El usuario autenticado está en la allowlist?
create or replace function public.is_agent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;

-- ---------- Tickets ----------
create table public.tickets (
  id bigint generated always as identity primary key,
  requester_email text not null,
  requester_name text,
  subject text not null default '',
  normalized_subject text not null default '',
  status public.ticket_status not null default 'abierto',
  sentiment public.ticket_sentiment not null default 'neutral',
  urgency smallint not null default 1 check (urgency between 1 and 3),
  intent text,
  ai_summary text,
  needs_attention boolean not null default true,
  requested_at timestamptz not null,
  due_date date not null,               -- fecha en que se cumplen N días hábiles (America/Bogota)
  wait_sent_at timestamptz,             -- cuándo se envió el correo de espera
  delivered_at timestamptz,             -- cuándo se entregó el examen
  closed_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tickets_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

create index tickets_last_message_idx on public.tickets (last_message_at desc);
create index tickets_requester_subject_idx on public.tickets (requester_email, normalized_subject);
create index tickets_status_idx on public.tickets (status);
-- Candidatos al correo de espera (consulta diaria del cron SLA)
create index tickets_sla_pending_idx on public.tickets (due_date)
  where wait_sent_at is null and delivered_at is null;

-- ---------- Mensajes ----------
create table public.messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets (id) on delete cascade,
  direction public.message_direction not null,
  message_id text not null unique,      -- header Message-ID
  in_reply_to text,
  references_ids text[] not null default '{}',
  from_email text not null,
  from_name text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text not null default '',
  text_body text not null default '',
  html_body text,
  sent_at timestamptz not null,
  mailbox text,                         -- carpeta IMAP de origen (null = enviado desde la app)
  imap_uid bigint,
  is_auto boolean not null default false,   -- autorespuesta / rebote / correo automático
  sent_by text,                         -- email del agente o 'sistema:sla'
  classified_at timestamptz,
  search tsvector generated always as (
    to_tsvector('spanish', coalesce(subject, '') || ' ' || coalesce(text_body, ''))
  ) stored,
  created_at timestamptz not null default now()
);

create index messages_ticket_idx on public.messages (ticket_id, sent_at);
create index messages_search_idx on public.messages using gin (search);
create index messages_unclassified_idx on public.messages (created_at)
  where classified_at is null and direction = 'in' and is_auto = false;

-- ---------- Adjuntos ----------
create table public.attachments (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  filename text not null,
  content_type text,
  size_bytes integer,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index attachments_message_idx on public.attachments (message_id);

-- ---------- Sugerencias de respuesta (IA / MCP) ----------
create table public.reply_suggestions (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets (id) on delete cascade,
  source text not null default 'ai' check (source in ('ai', 'mcp')),
  analysis text not null default '',
  options jsonb not null default '[]',  -- [{title, tone, subject, body}]
  recommended_index smallint,
  escalate boolean not null default false,
  used_index smallint,
  created_at timestamptz not null default now()
);

create index reply_suggestions_ticket_idx on public.reply_suggestions (ticket_id, created_at desc);

-- ---------- Plantillas ----------
create table public.templates (
  id bigint generated always as identity primary key,
  key text not null unique,
  name text not null,
  subject text not null default '',
  body text not null,
  updated_at timestamptz not null default now()
);

create trigger templates_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

-- ---------- Configuración ----------
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------- Estado de sincronización IMAP ----------
create table public.sync_state (
  mailbox text primary key,
  uid_validity bigint,
  last_uid bigint not null default 0,
  last_run_at timestamptz,
  last_error text
);

-- ---------- Bitácora ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  ticket_id bigint references public.tickets (id) on delete cascade,
  actor text not null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_log_ticket_idx on public.audit_log (ticket_id, created_at desc);

-- ---------- Locks para crons (evita ejecuciones solapadas) ----------
create table public.job_locks (
  name text primary key,
  locked_until timestamptz not null
);

create or replace function public.try_job_lock(p_name text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  got boolean;
begin
  insert into public.job_locks as l (name, locked_until)
  values (p_name, now() + make_interval(secs => p_seconds))
  on conflict (name) do update
    set locked_until = excluded.locked_until
    where l.locked_until < now()
  returning true into got;
  return coalesce(got, false);
end;
$$;

create or replace function public.release_job_lock(p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.job_locks where name = p_name;
$$;

revoke execute on function public.try_job_lock(text, integer) from public, anon, authenticated;
revoke execute on function public.release_job_lock(text) from public, anon, authenticated;

-- ============================================================
-- RLS: el servidor usa service_role (bypass). Agentes autenticados
-- en allowlist pueden leer/escribir como defensa en profundidad.
-- ============================================================
alter table public.allowed_users enable row level security;
alter table public.tickets enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.reply_suggestions enable row level security;
alter table public.templates enable row level security;
alter table public.settings enable row level security;
alter table public.sync_state enable row level security;
alter table public.audit_log enable row level security;
alter table public.job_locks enable row level security;

create policy "agents read allowlist" on public.allowed_users
  for select to authenticated using ((select public.is_agent()));

create policy "agents all tickets" on public.tickets
  for all to authenticated using ((select public.is_agent())) with check ((select public.is_agent()));
create policy "agents all messages" on public.messages
  for all to authenticated using ((select public.is_agent())) with check ((select public.is_agent()));
create policy "agents all attachments" on public.attachments
  for all to authenticated using ((select public.is_agent())) with check ((select public.is_agent()));
create policy "agents all suggestions" on public.reply_suggestions
  for all to authenticated using ((select public.is_agent())) with check ((select public.is_agent()));
create policy "agents all templates" on public.templates
  for all to authenticated using ((select public.is_agent())) with check ((select public.is_agent()));
create policy "agents all settings" on public.settings
  for all to authenticated using ((select public.is_agent())) with check ((select public.is_agent()));
create policy "agents read sync" on public.sync_state
  for select to authenticated using ((select public.is_agent()));
create policy "agents read audit" on public.audit_log
  for select to authenticated using ((select public.is_agent()));
-- job_locks: sin políticas → solo service_role.

-- ---------- Storage: bucket privado de adjuntos ----------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- ============================================================
-- Datos semilla
-- ============================================================
insert into public.settings (key, value) values
  ('sla_business_days', '10'),
  ('sla_auto_send', 'true'),
  ('sla_skip_angry', 'true'),
  ('signature', '"Cordialmente,\nÁrea de Exámenes\nCENTIC S.A.S.\nexamenes@centicsas.com.co"'),
  ('response_guidelines', to_jsonb($g$
Eres el asistente del área de Exámenes de CENTIC S.A.S. Redactas respuestas a correos de personas que solicitaron sus resultados de examen.

TONO
- Español de Colombia, trato de "usted", cordial, claro y breve.
- Ante molestia: reconocer la incomodidad primero, sin excusas largas ni culpar a terceros.

REGLAS
- El tiempo de entrega de resultados es de hasta 10 días hábiles desde la solicitud.
- No prometer fechas exactas ni resultados que no estén confirmados en los datos del ticket.
- No compartir resultados ni datos personales por este medio si la identidad no está clara.
- Si la persona menciona acciones legales, Superintendencia, tutela o derecho de petición: marcar escalamiento y responder de forma formal.
- No inventar nombres de funcionarios, teléfonos ni enlaces.

DATOS DE CONTACTO PERMITIDOS
- Correo: examenes@centicsas.com.co
$g$::text))
on conflict (key) do nothing;

insert into public.templates (key, name, subject, body) values
  ('espera',
   'Correo de espera (10 días hábiles)',
   'Re: {{asunto}}',
   $t$Buen día, {{nombre}}:

Le escribimos respecto a su solicitud del {{fecha_solicitud}} (ticket #{{ticket}}).

Queremos informarle que su examen aún se encuentra en proceso. Lamentamos la demora y le confirmamos que estamos gestionando su caso para entregarle los resultados a la mayor brevedad posible. Le notificaremos por este mismo medio en cuanto estén disponibles.

Agradecemos su paciencia y comprensión.

{{firma}}$t$),
  ('entrega',
   'Entrega de resultados',
   'Re: {{asunto}}',
   $t$Buen día, {{nombre}}:

Adjunto encontrará los resultados de su examen correspondientes a la solicitud del {{fecha_solicitud}}.

Si tiene alguna inquietud, puede responder a este correo.

{{firma}}$t$),
  ('acuse',
   'Acuse de recibido',
   'Re: {{asunto}}',
   $t$Buen día, {{nombre}}:

Hemos recibido su solicitud (ticket #{{ticket}}). El tiempo de respuesta es de hasta {{dias_habiles}} días hábiles.

{{firma}}$t$)
on conflict (key) do nothing;
