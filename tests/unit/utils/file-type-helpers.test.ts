import { describe, it, expect } from 'vitest';
import { isImageFile } from '../../../src/utils/file-type-helpers.js';

describe('File Type Helpers', () => {
  describe('isImageFile', () => {
    it('should correctly identify image files', () => {
      expect(isImageFile('image.png')).toBe(true);
      expect(isImageFile('photo.jpg')).toBe(true);
      expect(isImageFile('picture.jpeg')).toBe(true);
      expect(isImageFile('animation.gif')).toBe(true);
      expect(isImageFile('icon.svg')).toBe(true);
      expect(isImageFile('banner.webp')).toBe(true);
      expect(isImageFile('IMAGE.PNG')).toBe(true); // Case insensitive
      expect(isImageFile('path/to/image.jpg')).toBe(true);
    });

    it('should correctly reject non-image files', () => {
      expect(isImageFile('document.pdf')).toBe(false);
      expect(isImageFile('index.html')).toBe(false);
      expect(isImageFile('data.json')).toBe(false);
      expect(isImageFile('script.js')).toBe(false);
      expect(isImageFile('style.css')).toBe(false);
      expect(isImageFile('image.txt')).toBe(false);
      expect(isImageFile('noextension')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle files with multiple dots in the name', () => {
      expect(isImageFile('my.photo.2024.jpg')).toBe(true);
    });

    it('should handle files with no extension', () => {
      expect(isImageFile('README')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(isImageFile('')).toBe(false);
    });

    it('should handle paths with special characters', () => {
      expect(isImageFile('./images/my-photo.jpg')).toBe(true);
    });
  });
});
