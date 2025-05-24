module.exports = {
  CID: {
    parse: (cid) => {
      // Mock validation for CID patterns - should be more strict
      if (!cid || typeof cid !== 'string') {
        throw new Error('Invalid CID');
      }
      
      // Valid v0 CIDs start with Qm and are 46 characters
      if (cid.startsWith('Qm') && cid.length === 46 && /^[A-Za-z0-9]+$/.test(cid)) {
        return { valid: true };
      }
      
      // Valid v1 CIDs start with baf and are longer
      if (cid.startsWith('bafy') && cid.length >= 59 && /^[a-z2-7]+$/.test(cid)) {
        return { valid: true };
      }
      
      throw new Error('Invalid CID');
    }
  }
};