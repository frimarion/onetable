export const doyleQueries = {
  tournaments: 'doyle_tournaments?select=id,name,entry_fee,status,slots,date,room_id,created_at,stack,format&order=date.desc.nullslast,id.desc',
  rooms: 'rooms?select=room_id,state,version,branch&order=room_id.asc',
  players: 'doyle_players?select=id,name,full_name,tg_id,tg_username,photo_url,points,games_played,ko_count,registered_at,marketing_consent,bio&order=name.asc,id.asc',
  registrations: 'doyle_registrations?select=tournament_id,player_id,source,attendance,created_at&order=id.asc',
  results: 'doyle_tournament_results?select=tournament_id,player_id,place,points,place_points,ko_count&order=tournament_id.asc,player_id.asc',
  blueprints: 'tournament_blueprints?select=id,name,start_stack,late_reg_until_level,default_buy_in,default_registered,enables_seating,levels,sort_order&order=sort_order.asc,id.asc',
  notes: 'crm_player_notes?select=id,player_id,text,admin_email,created_at&order=created_at.desc&limit=500',
  tags: 'crm_player_tags?select=player_id,tag&limit=2000',
  debts: 'crm_player_debts?select=id,player_id,amount,reason,tournament_id,tournament_name,method,settled_at,created_at&order=created_at.desc&limit=1000',
  broadcasts: 'crm_broadcasts?select=id,message,filter,recipient_count,sent_count,failed_count,status,created_at&order=created_at.desc&limit=80',
} as const;

export type DoyleResource = keyof typeof doyleQueries;
export type DoyleOverlay = {
  playerMeta?: { player_id: string; stage: string; owner: string; phone: string; instagram: string; source: string }[];
  crmTasks?: { id: number; player_id: string; kind: string; title: string; assignee: string; due_at: number; completed_at: number | null; result: string; created_at: number }[];
  crmMessages?: { id: number; player_id: string; direction: string; channel: string; author: string; body: string; created_at: number }[];
  crmEvents?: { id: number; player_id: string; kind: string; actor: string; summary: string; created_at: number }[];
  ratingPresets?: { name: string; scheme: unknown }[];
};
export type DoyleRows = Record<DoyleResource, unknown[]> & DoyleOverlay;
export const optionalDoyleResources: ReadonlySet<DoyleResource> = new Set(['blueprints', 'notes', 'tags', 'debts', 'broadcasts']);
