import { describe, it, expect } from 'vitest';
import { createCountyDataGroup } from '../../../src/commands/transform/county-datagroup.js';

describe('createCountyDataGroup', () => {
  describe('layout relationships', () => {
    it('should include layout_has_layout when file contains layout, layout, and relationship', () => {
      const relationshipFiles = ['relationship_layout_layout.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_layout).toEqual([
        { '/': './relationship_layout_layout.json' },
      ]);
    });

    it('should include layout_has_utility when file contains layout, utility, and relationship', () => {
      const relationshipFiles = ['relationship_layout_utility.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_utility).toEqual([
        { '/': './relationship_layout_utility.json' },
      ]);
    });

    it('should include layout_has_structure when file contains layout, structure, and relationship', () => {
      const relationshipFiles = ['relationship_layout_structure.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_structure).toEqual([
        { '/': './relationship_layout_structure.json' },
      ]);
    });

    it('should handle all three layout relationships together', () => {
      const relationshipFiles = [
        'relationship_layout_layout.json',
        'relationship_layout_utility.json',
        'relationship_layout_structure.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_layout).toEqual([
        { '/': './relationship_layout_layout.json' },
      ]);
      expect(result.relationships.layout_has_utility).toEqual([
        { '/': './relationship_layout_utility.json' },
      ]);
      expect(result.relationships.layout_has_structure).toEqual([
        { '/': './relationship_layout_structure.json' },
      ]);
    });

    it('should handle case-insensitive matching for layout relationships', () => {
      const relationshipFiles = [
        'Relationship_Layout_Layout.json',
        'RELATIONSHIP_LAYOUT_UTILITY.json',
        'relationship_Layout_Structure.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_layout).toEqual([
        { '/': './Relationship_Layout_Layout.json' },
      ]);
      expect(result.relationships.layout_has_utility).toEqual([
        { '/': './RELATIONSHIP_LAYOUT_UTILITY.json' },
      ]);
      expect(result.relationships.layout_has_structure).toEqual([
        { '/': './relationship_Layout_Structure.json' },
      ]);
    });

    it('should not include layout relationships when files are missing required keywords', () => {
      const relationshipFiles = [
        'layout_only.json',
        'utility_only.json',
        'structure_only.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_layout).toBeUndefined();
      expect(result.relationships.layout_has_utility).toBeUndefined();
      expect(result.relationships.layout_has_structure).toBeUndefined();
    });

    it('should handle multiple layout_has_layout relationships', () => {
      const relationshipFiles = [
        'relationship_layout_layout_1.json',
        'relationship_layout_layout_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_layout).toHaveLength(2);
      expect(result.relationships.layout_has_layout).toEqual([
        { '/': './relationship_layout_layout_1.json' },
        { '/': './relationship_layout_layout_2.json' },
      ]);
    });

    it('should handle multiple layout_has_utility relationships', () => {
      const relationshipFiles = [
        'relationship_layout_utility_1.json',
        'relationship_layout_utility_2.json',
        'relationship_layout_utility_3.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_utility).toHaveLength(3);
      expect(result.relationships.layout_has_utility).toEqual([
        { '/': './relationship_layout_utility_1.json' },
        { '/': './relationship_layout_utility_2.json' },
        { '/': './relationship_layout_utility_3.json' },
      ]);
    });

    it('should handle multiple layout_has_structure relationships', () => {
      const relationshipFiles = [
        'relationship_layout_structure_1.json',
        'relationship_layout_structure_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_structure).toHaveLength(2);
      expect(result.relationships.layout_has_structure).toEqual([
        { '/': './relationship_layout_structure_1.json' },
        { '/': './relationship_layout_structure_2.json' },
      ]);
    });
  });

  describe('deed and sales relationships', () => {
    it('should include deed_has_file when file contains deed, file, and relationship', () => {
      const relationshipFiles = ['relationship_deed_file_5.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.deed_has_file).toEqual([
        { '/': './relationship_deed_file_5.json' },
      ]);
    });

    it('should include sales_history_has_deed when file contains sales, deed, and relationship', () => {
      const relationshipFiles = ['relationship_sales_deed_4.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.sales_history_has_deed).toEqual([
        { '/': './relationship_sales_deed_4.json' },
      ]);
    });

    it('should include sales_history_has_person when file contains sales, person, and relationship', () => {
      const relationshipFiles = ['relationship_sales_person_1.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.sales_history_has_person).toEqual([
        { '/': './relationship_sales_person_1.json' },
      ]);
    });

    it('should include sales_history_has_company when file contains sales, company, and relationship', () => {
      const relationshipFiles = ['relationship_sales_company_1.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.sales_history_has_company).toEqual([
        { '/': './relationship_sales_company_1.json' },
      ]);
    });

    it('should handle multiple deed_has_file relationships', () => {
      const relationshipFiles = [
        'relationship_deed_file_1.json',
        'relationship_deed_file_2.json',
        'relationship_deed_file_3.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.deed_has_file).toHaveLength(3);
      expect(result.relationships.deed_has_file).toEqual([
        { '/': './relationship_deed_file_1.json' },
        { '/': './relationship_deed_file_2.json' },
        { '/': './relationship_deed_file_3.json' },
      ]);
    });

    it('should handle multiple sales_history_has_deed relationships', () => {
      const relationshipFiles = [
        'relationship_sales_deed_1.json',
        'relationship_sales_deed_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.sales_history_has_deed).toHaveLength(2);
      expect(result.relationships.sales_history_has_deed).toEqual([
        { '/': './relationship_sales_deed_1.json' },
        { '/': './relationship_sales_deed_2.json' },
      ]);
    });
  });

  describe('property relationships', () => {
    it('should include property_has_address for property_address files', () => {
      const relationshipFiles = ['relationship_property_address.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.property_has_address).toEqual({
        '/': './relationship_property_address.json',
      });
    });

    it('should include property_has_sales_history for property_sales files', () => {
      const relationshipFiles = [
        'relationship_property_sales_1.json',
        'relationship_property_sales_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.property_has_sales_history).toHaveLength(2);
      expect(result.relationships.property_has_sales_history).toEqual([
        { '/': './relationship_property_sales_1.json' },
        { '/': './relationship_property_sales_2.json' },
      ]);
    });

    it('should include property_has_file for property_file files', () => {
      const relationshipFiles = [
        'relationship_property_file_1.json',
        'relationship_property_file_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.property_has_file).toHaveLength(2);
      expect(result.relationships.property_has_file).toEqual([
        { '/': './relationship_property_file_1.json' },
        { '/': './relationship_property_file_2.json' },
      ]);
    });
  });

  describe('comprehensive relationship handling', () => {
    it('should handle a complete set of relationships from manatee example', () => {
      const relationshipFiles = [
        'relationship_property_address.json',
        'relationship_property_sales_1.json',
        'relationship_property_file_1.json',
        'relationship_deed_file_1.json',
        'relationship_sales_deed_1.json',
        'relationship_sales_person_1.json',
        'relationship_sales_company_1.json',
        'relationship_layout_layout.json',
        'relationship_layout_utility.json',
        'relationship_layout_structure.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      expect(result.label).toBe('County');
      expect(result.relationships.property_has_address).toBeDefined();
      expect(result.relationships.property_has_sales_history).toHaveLength(1);
      expect(result.relationships.property_has_file).toHaveLength(1);
      expect(result.relationships.deed_has_file).toHaveLength(1);
      expect(result.relationships.sales_history_has_deed).toHaveLength(1);
      expect(result.relationships.sales_history_has_person).toHaveLength(1);
      expect(result.relationships.sales_history_has_company).toHaveLength(1);
      expect(result.relationships.layout_has_layout).toBeDefined();
      expect(result.relationships.layout_has_utility).toBeDefined();
      expect(result.relationships.layout_has_structure).toBeDefined();
    });

    it('should not include person_has_property or company_has_property relationships', () => {
      const relationshipFiles = [
        'relationship_person_1_property.json',
        'relationship_company_1_property.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      // These should not be created anymore based on the requirements
      expect(result.relationships.person_has_property).toBeUndefined();
      expect(result.relationships.company_has_property).toBeUndefined();
    });

    it('should not create person_has_property with multiple person files', () => {
      const relationshipFiles = [
        'relationship_person_1_property.json',
        'relationship_person_2_property.json',
        'relationship_person_3_property.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.person_has_property).toBeUndefined();
      expect(Object.keys(result.relationships)).toHaveLength(0);
    });

    it('should not create company_has_property with multiple company files', () => {
      const relationshipFiles = [
        'relationship_company_1_property.json',
        'relationship_company_2_property.json',
        'relationship_company_3_property.json',
        'relationship_company_4_property.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.company_has_property).toBeUndefined();
      expect(Object.keys(result.relationships)).toHaveLength(0);
    });

    it('should not create person or company relationships even with mixed files', () => {
      const relationshipFiles = [
        'relationship_person_1_property.json',
        'relationship_company_1_property.json',
        'relationship_property_sales_1.json',
        'relationship_deed_file_1.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      // Person and company relationships should not exist
      expect(result.relationships.person_has_property).toBeUndefined();
      expect(result.relationships.company_has_property).toBeUndefined();

      // But other valid relationships should exist
      expect(result.relationships.property_has_sales_history).toHaveLength(1);
      expect(result.relationships.deed_has_file).toHaveLength(1);
    });

    it('should not create person or company relationships with case variations', () => {
      const relationshipFiles = [
        'Relationship_Person_1_Property.json',
        'RELATIONSHIP_COMPANY_1_PROPERTY.json',
        'relationship_Person_Property.json',
        'RELATIONSHIP_COMPANY_PROPERTY.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.person_has_property).toBeUndefined();
      expect(result.relationships.company_has_property).toBeUndefined();
    });

    it('should return empty relationships object when no valid files provided', () => {
      const relationshipFiles: string[] = [];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.label).toBe('County');
      expect(Object.keys(result.relationships)).toHaveLength(0);
    });

    it('should ignore non-relationship files', () => {
      const relationshipFiles = [
        'property.json',
        'person_1.json',
        'company_1.json',
        'deed_1.json',
        'file_1.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      expect(Object.keys(result.relationships)).toHaveLength(0);
    });
  });
});
