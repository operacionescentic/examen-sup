-- ============================================================
-- Importación histórica + fuente Gmail + triage IA
-- ============================================================

-- Mensajes huérfanos (respuesta procesada antes que el correo original): se re-enlazan después
alter table public.messages alter column ticket_id drop not null;
create index messages_orphans_idx on public.messages (created_at) where ticket_id is null;

-- Adjuntos históricos: se guarda solo metadata (sin archivo) para no llenar Storage
alter table public.attachments alter column storage_path drop not null;

-- Tickets importados del histórico y su revisión (triage) por IA
alter table public.tickets
  add column imported boolean not null default false,
  add column triaged_at timestamptz,
  add column triage jsonb;

create index tickets_untriaged_idx on public.tickets (id) where imported and triaged_at is null;

-- El SLA solo actúa sobre tickets cuyo vencimiento sea >= esta fecha (evita correos masivos al histórico)
insert into public.settings (key, value)
values ('sla_start_date', to_jsonb(to_char((now() at time zone 'America/Bogota')::date, 'YYYY-MM-DD')))
on conflict (key) do nothing;
