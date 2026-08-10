begin;

select plan(37);

select has_type('public', 'class_memberstack_snapshot_status', 'Memberstack snapshot states are closed and typed');
select has_table('public', 'class_memberstack_webhook_events', 'verified Memberstack deliveries have a dedupe ledger');
select has_table('public', 'class_memberstack_webhook_diagnostics', 'temporary webhook summaries have bounded retention');
select has_table('public', 'class_memberstack_admin_admissions', 'Memberstack Admin requests have a global admission gate');
select has_table('public', 'class_offer_authorization_checks', 'fresh Offer eligibility checks have minimal evidence');
select has_column('public', 'class_revvi_customers', 'subscription_status', 'Customers have a non-authoritative subscription snapshot');
select has_column('public', 'class_revvi_customers', 'memberstack_plan_ids', 'Customer snapshots preserve exact Memberstack plan IDs');
select has_column('public', 'class_revvi_customers', 'memberstack_last_synced_at', 'Customer snapshots record their sync time');
select has_column('public', 'class_revvi_customers', 'eligibility_override', 'Customers have an explicit pilot eligibility control');
select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'class_revvi_customers' and column_name = 'auth_user_id'),
  'YES',
  'Revvi Customers authenticated by Memberstack do not require a separate Supabase Auth identity'
);

insert into public.class_revvi_customers (
  id, auth_user_id, memberstack_customer_id
) values (
  '32000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'member-issue-32'
);

create function pg_temp.apply_memberstack_webhook(
  candidate_svix_id text,
  candidate_event_type public.class_memberstack_event_type,
  candidate_external_event_type text,
  candidate_memberstack_member_id text,
  candidate_subscription_status public.class_memberstack_snapshot_status,
  candidate_plan_ids text[],
  candidate_redacted_summary jsonb
)
returns boolean
language plpgsql
as $$
begin
  if not public.receive_class_memberstack_webhook(
    candidate_svix_id,
    candidate_event_type,
    candidate_external_event_type,
    candidate_memberstack_member_id
  ) then
    return false;
  end if;
  return public.process_class_memberstack_webhook(
    candidate_svix_id,
    candidate_subscription_status,
    candidate_plan_ids,
    candidate_redacted_summary
  );
end;
$$;

select is(
  (select bool_and(public.claim_class_memberstack_admin_admission())
   from generate_series(1, 20)),
  true,
  'the global gate admits at most the documented request budget with safety margin'
);
select is(
  public.claim_class_memberstack_admin_admission(),
  false,
  'a twenty-first Admin request in the same second fails closed'
);

select is(
  public.receive_class_memberstack_webhook(
    'msg-issue-32-received',
    'member.updated',
    'member.updated',
    'member-issue-32'
  ),
  true,
  'a verified delivery is durably received before external processing'
);
select is(
  (select status::text from public.class_memberstack_webhook_events
   where svix_id = 'msg-issue-32-received'),
  'received',
  'a pre-processing delivery remains visible and retryable'
);

select is(
  pg_temp.apply_memberstack_webhook(
    'msg-issue-32-1',
    'member.plan.updated',
    'member.plan.updated',
    'member-issue-32',
    'active',
    array['plan-z', 'plan-revvi', 'plan-revvi'],
    jsonb_build_object(
      'memberId', 'member-issue-32',
      'planId', 'plan-revvi',
      'planConnectionId', 'connection-32',
      'status', 'ACTIVE',
      'active', true
    )
  ),
  true,
  'a verified Memberstack delivery is applied once'
);
select is(
  (select subscription_status::text from public.class_revvi_customers where id = '32000000-0000-0000-0000-000000000001'),
  'active',
  'the local Customer snapshot records active subscription state'
);
select is(
  (select memberstack_plan_ids::text from public.class_revvi_customers where id = '32000000-0000-0000-0000-000000000001'),
  '{plan-revvi,plan-z}',
  'the local snapshot stores sorted exact distinct plan IDs'
);
select is(
  (select count(*)::int from public.class_memberstack_webhook_events where svix_id = 'msg-issue-32-1'),
  1,
  'the Svix delivery ID is durable'
);
select is(
  (select status::text from public.class_memberstack_webhook_events where svix_id = 'msg-issue-32-1'),
  'processed',
  'a known Customer delivery is marked processed'
);
select is(
  (select redacted_summary ->> 'planId' from public.class_memberstack_webhook_diagnostics),
  'plan-revvi',
  'only the allowlisted redacted webhook summary is retained'
);
select is(
  pg_temp.apply_memberstack_webhook(
    'msg-issue-32-1',
    'member.plan.updated',
    'member.plan.updated',
    'member-issue-32',
    'inactive',
    array[]::text[],
    jsonb_build_object('memberId', 'member-issue-32', 'status', 'CANCELED')
  ),
  false,
  'a duplicate verified Svix delivery is acknowledged without reapplying it'
);
select is(
  (select subscription_status::text from public.class_revvi_customers where id = '32000000-0000-0000-0000-000000000001'),
  'active',
  'a duplicate delivery cannot overwrite the first applied snapshot'
);
select throws_ok(
  $$select pg_temp.apply_memberstack_webhook(
      'msg-issue-32-secret',
      'member.updated',
      'member.updated',
      'member-issue-32',
      'unknown',
      array[]::text[],
      jsonb_build_object('token', 'must-not-persist')
    )$$,
  'invalid Memberstack webhook facts',
  'secret-bearing webhook fields fail the summary allowlist'
);
select is(
  pg_temp.apply_memberstack_webhook(
      'msg-issue-32-invented',
      'unknown',
      'member.plan.expired',
      'member-issue-32',
      'inactive',
      array[]::text[],
      '{}'::jsonb
  ),
  true,
  'an unknown verified event is durably accepted without authorizing anything'
);
select is(
  (select status::text from public.class_memberstack_webhook_events where svix_id = 'msg-issue-32-invented'),
  'ignored',
  'an undocumented Memberstack event fails closed as ignored'
);
select is(
  pg_temp.apply_memberstack_webhook(
      'msg-issue-32-created',
      'member.created',
      'member.created',
      'member-issue-32-created',
      'active',
      array['plan-revvi'],
      jsonb_build_object(
        'memberId', 'member-issue-32-created',
        'planId', 'plan-revvi',
        'status', 'ACTIVE',
        'active', true
      )
  ),
  true,
  'a verified member.created delivery onboards the Revvi Customer'
);
select is(
  (select count(*)::int
   from public.class_revvi_customers
   where memberstack_customer_id = 'member-issue-32-created'
     and auth_user_id is null
     and subscription_status = 'active'
     and memberstack_plan_ids = array['plan-revvi']),
  1,
  'the server-owned Customer identity is usable without browser identity fields'
);
select is(
  (select count(*)::int from cron.job where jobname = 'class-memberstack-diagnostics-retention'),
  1,
  'temporary Memberstack diagnostics have a scheduled deletion job'
);
select is(
  has_table_privilege('authenticated', 'public.class_memberstack_webhook_events', 'insert'),
  false,
  'browser sessions cannot fabricate Memberstack webhook events'
);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '10000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'app_metadata', json_build_object('memberstack_customer_id', 'member-issue-32')
  )::text,
  false
);
set role authenticated;

select is(
  (select subscription_status::text from public.class_revvi_customers where id = '32000000-0000-0000-0000-000000000001'),
  'active',
  'a verified Customer can read its own non-authoritative snapshot'
);
select is((select count(*)::int from public.class_memberstack_webhook_events), 0, 'Customers cannot read webhook operations records');
select is((select count(*)::int from public.class_memberstack_webhook_diagnostics), 0, 'Customers cannot read webhook diagnostics');
select is((select count(*)::int from public.class_offer_authorization_checks), 0, 'Customers cannot read server authorization evidence');

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '10000000-0000-0000-0000-000000000005',
    'role', 'authenticated',
    'app_metadata', json_build_object('platform_operations', true)
  )::text,
  false
);
select is((select count(*)::int from public.class_memberstack_webhook_events), 4, 'platform operations can inspect webhook processing state');
select is((select count(*)::int from public.class_memberstack_webhook_diagnostics), 3, 'platform operations can inspect bounded redacted diagnostics');
select is((select count(*)::int from public.class_offer_authorization_checks), 0, 'no authorization evidence exists until an eligible request is checked');

set role postgres;

select is(
  (select count(*)::int from public.class_memberstack_webhook_diagnostics where expires_at <= created_at + interval '48 hours'),
  3,
  'webhook diagnostics cannot outlive 48 hours'
);

select * from finish();
rollback;
