-- Apply separately after verifying the updated Web and desktop clients.
-- Reads continue through the existing owner-only policy.
begin;

revoke insert, update, delete, truncate on public.user_data from public, anon, authenticated;
revoke insert (user_id, data, updated_at, revision), update (user_id, data, updated_at, revision)
  on public.user_data from public, anon, authenticated;

commit;
