export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  if (isTauriRuntime()) return saveBlobWithTauri(blob, filename);
  saveBlobWithBrowser(blob, filename);
  return true;
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in globalThis;
}

async function saveBlobWithTauri(blob: Blob, filename: string): Promise<boolean> {
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const extension = filename.split('.').at(-1) ?? '';
  const path = await save({
    defaultPath: filename,
    title: `Save ${filename}`,
    ...(extension
      ? { filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }] }
      : {}),
  });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

function saveBlobWithBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}
