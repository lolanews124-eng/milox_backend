const onlineUserIds = new Set<string>();

export function markUserOnline(userId: string): void {
  onlineUserIds.add(userId);
}

export function markUserOffline(userId: string): void {
  onlineUserIds.delete(userId);
}

export function isUserOnline(userId: string): boolean {
  return onlineUserIds.has(userId);
}

export function listOnlineUserIds(): string[] {
  return [...onlineUserIds];
}
