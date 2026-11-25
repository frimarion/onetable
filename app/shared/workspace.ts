export const CLUB_HEADER = 'x-onetable-club';
export const DOYLE_CLUB_ID = 'doyle';

export function workspacePath(clubId: string) {
  return '/clubs/' + encodeURIComponent(clubId);
}

export function workspaceClubId(path: string): string | undefined {
  return /^\/clubs\/([a-zA-Z0-9_-]+)\/?$/.exec(path)?.[1];
}
