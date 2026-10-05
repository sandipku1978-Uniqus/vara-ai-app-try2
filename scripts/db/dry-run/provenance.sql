-- Prove the stored registry and anon provenance RPC equal repository identity.
begin;
set local dryrun.version = :'version';
set local dryrun.count = :'count';
set local dryrun.checksum = :'checksum';
set local dryrun.algorithm = :'algorithm';
set local role anon;
do $$ declare expected jsonb; actual jsonb; begin
  expected := jsonb_build_object('schemaVersion',current_setting('dryrun.version'),
    'schemaMigrationCount',current_setting('dryrun.count')::int,
    'schemaChainChecksum',current_setting('dryrun.checksum'),
    'schemaChecksumAlgorithm',current_setting('dryrun.algorithm'));
  select jsonb_build_object('schemaVersion',version,'schemaMigrationCount',migration_count,
    'schemaChainChecksum',chain_checksum,'schemaChecksumAlgorithm',checksum_algorithm)
    into actual from public.urc_schema_version where singleton;
  if actual is distinct from expected then raise exception 'registry mismatch: % expected %',actual,expected; end if;
  if public.urc_schema_provenance() is distinct from expected then raise exception 'anon provenance mismatch'; end if;
end $$;
rollback;
