export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Check for valid protocols
    const validProtocols = [
      'http:',
      'https:',
      'ipfs:',
      'file:',
      'mailto:',
      'tel:',
    ];
    if (!validProtocols.includes(parsed.protocol)) {
      return false;
    }
    // For http/https, validate hostname
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // Check for valid hostname
      if (parsed.hostname === '' || parsed.hostname.includes(' ')) {
        return false;
      }
      // Check for incomplete IP addresses
      if (
        /^\d+\.\d+\.\d+\.?$/.test(parsed.hostname) ||
        /^\d+\.\d+\.?$/.test(parsed.hostname)
      ) {
        return false;
      }
      // Check for incomplete domains
      if (parsed.hostname.endsWith('.')) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
