import path from 'path';

/**
 * Check if a file is an image based on its extension
 */
export function isImageFile(filePath: string): boolean {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
  const ext = path.extname(filePath).toLowerCase();
  return imageExtensions.includes(ext);
}

/**
 * Check if a file is an HTML file based on its extension
 */
export function isHtmlFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

/**
 * Check if a file is a media file (HTML or image)
 */
export function isMediaFile(filePath: string): boolean {
  return isHtmlFile(filePath) || isImageFile(filePath);
}
