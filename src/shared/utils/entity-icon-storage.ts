export function iconUrlToStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/entity-icons/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

export async function deleteEntityIcon(
  supabase: { storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<{ error: unknown }> } } },
  iconUrl: string | null | undefined
): Promise<void> {
  const path = iconUrlToStoragePath(iconUrl);
  if (!path) return;
  const { error } = await supabase.storage.from('entity-icons').remove([path]);
  if (error) {
    console.error('deleteEntityIcon failed', error);
  }
}
