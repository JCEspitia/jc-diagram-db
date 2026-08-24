export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  saveBlobWithBrowser(blob, filename);
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
