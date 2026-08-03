alter type public.booking_completion_mode add value if not exists 'mindbody_checkout';

create or replace function public.is_approved_non_sensitive_checkout_request(request jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(request) = 'object'
    and request ?& array['ClientId', 'AppointmentId', 'TransactionIds', 'PaymentAuthenticationCallbackUrl', 'PaymentInfo', 'Test']
    and request - array['ClientId', 'AppointmentId', 'TransactionIds', 'PaymentAuthenticationCallbackUrl', 'PaymentInfo', 'Test'] = '{}'::jsonb
    and request ->> 'ClientId' = '$REVVI_CLIENT_ID'
    and request ->> 'AppointmentId' = '$REVVI_APPOINTMENT_ID'
    and request ->> 'TransactionIds' = '$REVVI_TRANSACTION_IDS'
    and request ->> 'PaymentAuthenticationCallbackUrl' = '$REVVI_CALLBACK_URL'
    and jsonb_typeof(request -> 'PaymentInfo') = 'object'
    and (request -> 'PaymentInfo') - array['PaymentMethodId'] = '{}'::jsonb
    and jsonb_typeof(request -> 'PaymentInfo' -> 'PaymentMethodId') = 'number'
    and jsonb_typeof(request -> 'Test') = 'boolean';
$$;

create table public.business_checkout_config (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  payment_mode text not null check (payment_mode in ('approved_non_sensitive')),
  checkout_request jsonb not null check (public.is_approved_non_sensitive_checkout_request(checkout_request)),
  validation_evidence_ref text not null check (length(trim(validation_evidence_ref)) > 0),
  validated_at timestamptz not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_checkout_config_set_updated_at
before update on public.business_checkout_config
for each row execute function public.set_provider_updated_at();

create trigger business_checkout_config_immutable_owner
before update on public.business_checkout_config
for each row execute function public.prevent_business_reassignment();

alter table public.business_checkout_config enable row level security;
revoke all on public.business_checkout_config from anon, authenticated;
grant select on public.business_checkout_config to service_role;

alter table public.booking_attempts
  add column mindbody_checkout_transaction_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(mindbody_checkout_transaction_ids) = 'array'),
  add column mindbody_checkout_sale_id text,
  add column checkout_operation_claimed_at timestamptz,
  add column sca_resume_token uuid not null default gen_random_uuid();
