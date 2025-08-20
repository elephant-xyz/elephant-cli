import { describe, it, expect } from 'vitest';
import {
  isImageFile,
  isHtmlFile,
  isMediaFile,
} from '../../../src/utils/file-type-helpers.js';

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

  describe('isHtmlFile', () => {
    it('should correctly identify HTML files', () => {
      expect(isHtmlFile('index.html')).toBe(true);
      expect(isHtmlFile('page.htm')).toBe(true);
      expect(isHtmlFile('INDEX.HTML')).toBe(true); // Case insensitive
      expect(isHtmlFile('PAGE.HTM')).toBe(true);
      expect(isHtmlFile('path/to/index.html')).toBe(true);
      expect(isHtmlFile('nested/path/page.htm')).toBe(true);
    });

    it('should correctly reject non-HTML files', () => {
      expect(isHtmlFile('style.css')).toBe(false);
      expect(isHtmlFile('script.js')).toBe(false);
      expect(isHtmlFile('data.json')).toBe(false);
      expect(isHtmlFile('image.png')).toBe(false);
      expect(isHtmlFile('document.xml')).toBe(false);
      expect(isHtmlFile('template.hbs')).toBe(false);
      expect(isHtmlFile('noextension')).toBe(false);
    });
  });

  describe('isMediaFile', () => {
    it('should correctly identify media files (HTML and images)', () => {
      // HTML files
      expect(isMediaFile('index.html')).toBe(true);
      expect(isMediaFile('page.htm')).toBe(true);

      // Image files
      expect(isMediaFile('image.png')).toBe(true);
      expect(isMediaFile('photo.jpg')).toBe(true);
      expect(isMediaFile('picture.jpeg')).toBe(true);
      expect(isMediaFile('animation.gif')).toBe(true);
      expect(isMediaFile('icon.svg')).toBe(true);
      expect(isMediaFile('banner.webp')).toBe(true);

      // Mixed case
      expect(isMediaFile('INDEX.HTML')).toBe(true);
      expect(isMediaFile('IMAGE.PNG')).toBe(true);
    });

    it('should correctly reject non-media files', () => {
      expect(isMediaFile('data.json')).toBe(false);
      expect(isMediaFile('script.js')).toBe(false);
      expect(isMediaFile('style.css')).toBe(false);
      expect(isMediaFile('document.pdf')).toBe(false);
      expect(isMediaFile('readme.md')).toBe(false);
      expect(isMediaFile('config.yml')).toBe(false);
      expect(isMediaFile('noextension')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle files with multiple dots in the name', () => {
      expect(isImageFile('my.photo.2024.jpg')).toBe(true);
      expect(isHtmlFile('index.min.html')).toBe(true);
      expect(isMediaFile('logo.compressed.svg')).toBe(true);
    });

    it('should handle files with no extension', () => {
      expect(isImageFile('README')).toBe(false);
      expect(isHtmlFile('Makefile')).toBe(false);
      expect(isMediaFile('LICENSE')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(isImageFile('')).toBe(false);
      expect(isHtmlFile('')).toBe(false);
      expect(isMediaFile('')).toBe(false);
    });

    it('should handle paths with special characters', () => {
      expect(isImageFile('./images/my-photo.jpg')).toBe(true);
      expect(isHtmlFile('../pages/index.html')).toBe(true);
      expect(isMediaFile('../../assets/logo.png')).toBe(true);
    });
  });
});
