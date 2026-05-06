do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'SCRAPE_WORKER_TOKEN' limit 1;
  if v_id is not null then
    perform vault.update_secret(v_id, 'lov_worker_7f3a91c4e8b24d6f9a1c5e8b3d7f2a91');
  else
    perform vault.create_secret('lov_worker_7f3a91c4e8b24d6f9a1c5e8b3d7f2a91', 'SCRAPE_WORKER_TOKEN', 'Token for scrape-worker');
  end if;
end $$;