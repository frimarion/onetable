BEGIN;

CREATE TABLE IF NOT EXISTS public.onetable_room_commands (
  tournament_id bigint NOT NULL,
  request_id text NOT NULL,
  fingerprint text NOT NULL,
  PRIMARY KEY (tournament_id, request_id)
);
ALTER TABLE public.onetable_room_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.onetable_room_commands FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.onetable_save_doyle_command(
  p_tournament_id bigint, p_expected jsonb, p_version bigint,
  p_state jsonb, p_patch jsonb, p_attendance jsonb, p_request_id text, p_fingerprint text,
  p_new_room_id text, p_display_token text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  game public.doyle_tournaments%ROWTYPE;
  room public.rooms%ROWTYPE;
  prior text;
  target_room text;
BEGIN
  SELECT * INTO game FROM public.doyle_tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  SELECT fingerprint INTO prior FROM public.onetable_room_commands
    WHERE tournament_id = game.id AND request_id = p_request_id;
  IF FOUND THEN RETURN CASE WHEN prior = p_fingerprint THEN 'saved' ELSE 'duplicate' END; END IF;
  IF p_expected IS NULL THEN RETURN 'new'; END IF;

  IF NOT (to_jsonb(game) @> p_expected) THEN RETURN 'conflict'; END IF;
  IF game.status = 'past' THEN RETURN 'finished'; END IF;
  target_room := game.room_id;
  IF target_room IS NOT NULL THEN
    SELECT * INTO room FROM public.rooms WHERE room_id = target_room FOR UPDATE;
    IF NOT FOUND OR room.version IS DISTINCT FROM p_version THEN RETURN 'conflict'; END IF;
  ELSIF p_state IS NOT NULL THEN
    target_room := p_new_room_id;
    INSERT INTO public.rooms(room_id, state, branch, display_token)
      VALUES (target_room, p_state, game.city, p_display_token);
  END IF;

  IF p_attendance IS NOT NULL THEN
    UPDATE public.doyle_registrations SET attendance = p_attendance->>'status'
      WHERE tournament_id = game.id AND player_id = (p_attendance->>'id')::bigint;
    IF NOT FOUND AND p_state IS NULL THEN RETURN 'missing_player'; END IF;
  END IF;

  IF p_state IS NOT NULL AND game.room_id IS NOT NULL THEN
    UPDATE public.rooms SET state = p_state WHERE room_id = target_room;
  END IF;
  IF p_patch <> '{}'::jsonb OR target_room IS DISTINCT FROM game.room_id THEN
    UPDATE public.doyle_tournaments SET
      room_id = target_room,
      name = COALESCE(p_patch->>'name', name),
      date = CASE WHEN p_patch ? 'date' THEN (p_patch->>'date')::timestamptz ELSE date END,
      slots = COALESCE((p_patch->>'slots')::integer, slots),
      entry_fee = COALESCE((p_patch->>'entry_fee')::integer, entry_fee),
      stack = COALESCE((p_patch->>'stack')::integer, stack),
      format = COALESCE(p_patch->>'format', format),
      status = COALESCE(p_patch->>'status', status)
      WHERE id = game.id;
  END IF;

  INSERT INTO public.onetable_room_commands(tournament_id, request_id, fingerprint)
    VALUES (game.id, p_request_id, p_fingerprint);
  RETURN 'saved';
END;
$$;

REVOKE ALL ON FUNCTION public.onetable_save_doyle_command(bigint,jsonb,bigint,jsonb,jsonb,jsonb,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onetable_save_doyle_command(bigint,jsonb,bigint,jsonb,jsonb,jsonb,text,text,text,text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
