import path from 'path';

/**
 * Check if a file is an image based on its extension
 */
export function isImageFile(filePath: string): boolean {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
  const ext = path.extname(filePath).toLowerCase();
  return imageExtensions.includes(ext);
}
