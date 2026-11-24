export type MemberRole = 'owner' | 'admin' | 'floor' | 'dealer';
export type StaffRole = Exclude<MemberRole, 'owner'>;

export const roleLabels: Record<MemberRole, string> = {
  owner: 'Владелец',
  admin: 'Менеджер',
  floor: 'Флор',
  dealer: 'Дилер',
};

export type ClubAccount = { id: string; email: string; name: string; role: MemberRole; tableNo: number | null };
export type ClubInvitation = { email: string; role: MemberRole; tableNo: number | null; expiresAt: number };
export type ClubAccounts = { members: ClubAccount[]; invitations: ClubInvitation[] };
