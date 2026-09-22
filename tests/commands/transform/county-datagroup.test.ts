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

    it('should return layout_has_layout as an array, not a single object', () => {
      const relationshipFiles = ['relationship_layout_layout.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(Array.isArray(result.relationships.layout_has_layout)).toBe(true);
      expect(result.relationships.layout_has_layout).toHaveLength(1);
    });

    it('should return layout_has_utility as an array, not a single object', () => {
      const relationshipFiles = ['relationship_layout_utility.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(Array.isArray(result.relationships.layout_has_utility)).toBe(true);
      expect(result.relationships.layout_has_utility).toHaveLength(1);
    });

    it('should return layout_has_structure as an array, not a single object', () => {
      const relationshipFiles = ['relationship_layout_structure.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(Array.isArray(result.relationships.layout_has_structure)).toBe(
        true
      );
      expect(result.relationships.layout_has_structure).toHaveLength(1);
    });

    it('should return all layout relationships as arrays when multiple files exist', () => {
      const relationshipFiles = [
        'relationship_layout_layout_1.json',
        'relationship_layout_layout_2.json',
        'relationship_layout_utility_1.json',
        'relationship_layout_utility_2.json',
        'relationship_layout_structure_1.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(Array.isArray(result.relationships.layout_has_layout)).toBe(true);
      expect(Array.isArray(result.relationships.layout_has_utility)).toBe(true);
      expect(Array.isArray(result.relationships.layout_has_structure)).toBe(
        true
      );

      expect(result.relationships.layout_has_layout).toHaveLength(2);
      expect(result.relationships.layout_has_utility).toHaveLength(2);
      expect(result.relationships.layout_has_structure).toHaveLength(1);
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

    it('should include property_has_property_improvement when file contains property_improvement', () => {
      const relationshipFiles = ['relationship_property_improvement_1.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.property_has_property_improvement).toEqual([
        { '/': './relationship_property_improvement_1.json' },
      ]);
    });

    it('should handle multiple property_has_property_improvement relationships', () => {
      const relationshipFiles = [
        'relationship_property_improvement_1.json',
        'relationship_property_improvement_2.json',
        'relationship_property_improvement_3.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(
        result.relationships.property_has_property_improvement
      ).toHaveLength(3);
      expect(result.relationships.property_has_property_improvement).toEqual([
        { '/': './relationship_property_improvement_1.json' },
        { '/': './relationship_property_improvement_2.json' },
        { '/': './relationship_property_improvement_3.json' },
      ]);
    });

    it('should handle case-insensitive matching for property_improvement relationships', () => {
      const relationshipFiles = [
        'Relationship_Property_Improvement_1.json',
        'RELATIONSHIP_PROPERTY_IMPROVEMENT_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(
        result.relationships.property_has_property_improvement
      ).toHaveLength(2);
      expect(result.relationships.property_has_property_improvement).toEqual([
        { '/': './Relationship_Property_Improvement_1.json' },
        { '/': './RELATIONSHIP_PROPERTY_IMPROVEMENT_2.json' },
      ]);
    });

    it('should return property_has_property_improvement as an array, not a single object', () => {
      const relationshipFiles = ['relationship_property_improvement_1.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(
        Array.isArray(result.relationships.property_has_property_improvement)
      ).toBe(true);
      expect(
        result.relationships.property_has_property_improvement
      ).toHaveLength(1);
    });
  });

  describe('mailing address relationships', () => {
    it('should include person_has_mailing_address when file contains person, mailing_address, and relationship', () => {
      const relationshipFiles = [
        'relationship_person_1_has_mailing_address.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.person_has_mailing_address).toEqual([
        { '/': './relationship_person_1_has_mailing_address.json' },
      ]);
    });

    it('should include company_has_mailing_address when file contains company, mailing_address, and relationship', () => {
      const relationshipFiles = [
        'relationship_company_has_mailing_address_1.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.company_has_mailing_address).toEqual([
        { '/': './relationship_company_has_mailing_address_1.json' },
      ]);
    });

    it('should handle multiple person_has_mailing_address relationships', () => {
      const relationshipFiles = [
        'relationship_person_1_has_mailing_address.json',
        'relationship_person_2_has_mailing_address.json',
        'relationship_person_3_has_mailing_address.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.person_has_mailing_address).toHaveLength(3);
      expect(result.relationships.person_has_mailing_address).toEqual([
        { '/': './relationship_person_1_has_mailing_address.json' },
        { '/': './relationship_person_2_has_mailing_address.json' },
        { '/': './relationship_person_3_has_mailing_address.json' },
      ]);
    });

    it('should handle multiple company_has_mailing_address relationships', () => {
      const relationshipFiles = [
        'relationship_company_has_mailing_address_1.json',
        'relationship_company_has_mailing_address_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.company_has_mailing_address).toHaveLength(2);
      expect(result.relationships.company_has_mailing_address).toEqual([
        { '/': './relationship_company_has_mailing_address_1.json' },
        { '/': './relationship_company_has_mailing_address_2.json' },
      ]);
    });

    it('should handle both person and company mailing address relationships together', () => {
      const relationshipFiles = [
        'relationship_person_1_has_mailing_address.json',
        'relationship_person_2_has_mailing_address.json',
        'relationship_company_has_mailing_address_1.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.person_has_mailing_address).toHaveLength(2);
      expect(result.relationships.company_has_mailing_address).toHaveLength(1);
    });

    it('should handle case-insensitive matching for mailing address relationships', () => {
      const relationshipFiles = [
        'Relationship_Person_1_Has_Mailing_Address.json',
        'RELATIONSHIP_COMPANY_HAS_MAILING_ADDRESS_1.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.person_has_mailing_address).toEqual([
        { '/': './Relationship_Person_1_Has_Mailing_Address.json' },
      ]);
      expect(result.relationships.company_has_mailing_address).toEqual([
        { '/': './RELATIONSHIP_COMPANY_HAS_MAILING_ADDRESS_1.json' },
      ]);
    });

    it('should return person_has_mailing_address as an array, not a single object', () => {
      const relationshipFiles = [
        'relationship_person_1_has_mailing_address.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(
        Array.isArray(result.relationships.person_has_mailing_address)
      ).toBe(true);
      expect(result.relationships.person_has_mailing_address).toHaveLength(1);
    });

    it('should return company_has_mailing_address as an array, not a single object', () => {
      const relationshipFiles = [
        'relationship_company_has_mailing_address_1.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(
        Array.isArray(result.relationships.company_has_mailing_address)
      ).toBe(true);
      expect(result.relationships.company_has_mailing_address).toHaveLength(1);
    });

    it('should not include mailing address relationships when files are missing required keywords', () => {
      const relationshipFiles = [
        'relationship_person_1.json',
        'relationship_company_1.json',
        'mailing_address_only.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.person_has_mailing_address).toBeUndefined();
      expect(result.relationships.company_has_mailing_address).toBeUndefined();
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
        'relationship_person_1_has_mailing_address.json',
        'relationship_company_has_mailing_address_1.json',
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
      expect(result.relationships.person_has_mailing_address).toHaveLength(1);
      expect(result.relationships.company_has_mailing_address).toHaveLength(1);
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

  describe('tax jurisdiction and exemption relationships', () => {
    it('should include tax_has_tax_jurisdiction when file contains tax and jurisdiction', () => {
      const relationshipFiles = ['relationship_tax_jurisdiction.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.tax_has_tax_jurisdiction).toEqual([
        { '/': './relationship_tax_jurisdiction.json' },
      ]);
    });

    it('should include tax_jurisdiction_has_tax_exemption when file contains exemption', () => {
      const relationshipFiles = ['relationship_tax_exemption.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.tax_jurisdiction_has_tax_exemption).toEqual([
        { '/': './relationship_tax_exemption.json' },
      ]);
    });

    it('should include tax_jurisdiction_has_tax_exemption when file contains jurisdiction and exemption', () => {
      const relationshipFiles = [
        'relationship_tax_jurisdiction_exemption.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.tax_jurisdiction_has_tax_exemption).toEqual([
        { '/': './relationship_tax_jurisdiction_exemption.json' },
      ]);
    });

    it('should include tax_jurisdiction_has_tax_exemption when file contains property, jurisdiction, and exemption', () => {
      const relationshipFiles = [
        'relationship_property_tax_jurisdiction_exemption.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.tax_jurisdiction_has_tax_exemption).toEqual([
        { '/': './relationship_property_tax_jurisdiction_exemption.json' },
      ]);
      // Should NOT be in property_has_tax
      expect(result.relationships.property_has_tax).toBeUndefined();
    });

    it('should NOT include files with jurisdiction in property_has_tax', () => {
      const relationshipFiles = [
        'relationship_property_tax_2024.json',
        'relationship_property_tax_jurisdiction.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.property_has_tax).toEqual([
        { '/': './relationship_property_tax_2024.json' },
      ]);
      expect(result.relationships.tax_has_tax_jurisdiction).toEqual([
        { '/': './relationship_property_tax_jurisdiction.json' },
      ]);
    });

    it('should NOT include files with exemption in property_has_tax', () => {
      const relationshipFiles = [
        'relationship_property_tax_2024.json',
        'relationship_property_tax_exemption.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.property_has_tax).toEqual([
        { '/': './relationship_property_tax_2024.json' },
      ]);
      expect(result.relationships.tax_jurisdiction_has_tax_exemption).toEqual([
        { '/': './relationship_property_tax_exemption.json' },
      ]);
    });

    it('should handle multiple tax_has_tax_jurisdiction relationships', () => {
      const relationshipFiles = [
        'relationship_tax_jurisdiction_1.json',
        'relationship_tax_jurisdiction_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.tax_has_tax_jurisdiction).toHaveLength(2);
      expect(result.relationships.tax_has_tax_jurisdiction).toEqual([
        { '/': './relationship_tax_jurisdiction_1.json' },
        { '/': './relationship_tax_jurisdiction_2.json' },
      ]);
    });

    it('should handle multiple tax_jurisdiction_has_tax_exemption relationships', () => {
      const relationshipFiles = [
        'relationship_tax_exemption_1.json',
        'relationship_tax_exemption_2.json',
        'relationship_exemption_3.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(
        result.relationships.tax_jurisdiction_has_tax_exemption
      ).toHaveLength(3);
      expect(result.relationships.tax_jurisdiction_has_tax_exemption).toEqual([
        { '/': './relationship_tax_exemption_1.json' },
        { '/': './relationship_tax_exemption_2.json' },
        { '/': './relationship_exemption_3.json' },
      ]);
    });

    it('should handle case-insensitive matching for tax relationships', () => {
      const relationshipFiles = [
        'Relationship_Tax_Jurisdiction.json',
        'RELATIONSHIP_TAX_EXEMPTION.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.tax_has_tax_jurisdiction).toEqual([
        { '/': './Relationship_Tax_Jurisdiction.json' },
      ]);
      expect(result.relationships.tax_jurisdiction_has_tax_exemption).toEqual([
        { '/': './RELATIONSHIP_TAX_EXEMPTION.json' },
      ]);
    });

    it('should return tax_has_tax_jurisdiction as an array', () => {
      const relationshipFiles = ['relationship_tax_jurisdiction.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(Array.isArray(result.relationships.tax_has_tax_jurisdiction)).toBe(
        true
      );
      expect(result.relationships.tax_has_tax_jurisdiction).toHaveLength(1);
    });

    it('should return tax_jurisdiction_has_tax_exemption as an array', () => {
      const relationshipFiles = ['relationship_tax_exemption.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(
        Array.isArray(result.relationships.tax_jurisdiction_has_tax_exemption)
      ).toBe(true);
      expect(
        result.relationships.tax_jurisdiction_has_tax_exemption
      ).toHaveLength(1);
    });

    it('should handle all tax relationship types together', () => {
      const relationshipFiles = [
        'relationship_property_tax_2024.json',
        'relationship_property_tax_2025.json',
        'relationship_tax_jurisdiction_1.json',
        'relationship_tax_jurisdiction_2.json',
        'relationship_tax_exemption_1.json',
        'relationship_tax_exemption_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.property_has_tax).toHaveLength(2);
      expect(result.relationships.tax_has_tax_jurisdiction).toHaveLength(2);
      expect(
        result.relationships.tax_jurisdiction_has_tax_exemption
      ).toHaveLength(2);
    });

    it('should prioritize exemption over jurisdiction when both are present', () => {
      const relationshipFiles = [
        'relationship_tax_jurisdiction_exemption.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      // Should be in exemption, not jurisdiction
      expect(result.relationships.tax_jurisdiction_has_tax_exemption).toEqual([
        { '/': './relationship_tax_jurisdiction_exemption.json' },
      ]);
      expect(result.relationships.tax_has_tax_jurisdiction).toBeUndefined();
    });
  });

  describe('geometry relationships', () => {
    it('should include parcel_has_geometry when file contains parcel_geometry', () => {
      const relationshipFiles = ['relationship_parcel_geometry.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.parcel_has_geometry).toEqual([
        { '/': './relationship_parcel_geometry.json' },
      ]);
    });

    it('should include parcel_has_geometry when file contains parcel and geometry (but not property)', () => {
      const relationshipFiles = ['relationship_parcel_geometry.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.parcel_has_geometry).toEqual([
        { '/': './relationship_parcel_geometry.json' },
      ]);
    });

    it('should NOT include parcel_has_geometry when file contains property_geometry', () => {
      const relationshipFiles = ['relationship_property_geometry.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.parcel_has_geometry).toBeUndefined();
    });

    it('should include address_has_geometry when file contains address_geometry', () => {
      const relationshipFiles = ['relationship_address_geometry.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.address_has_geometry).toEqual({
        '/': './relationship_address_geometry.json',
      });
    });

    it('should include address_has_geometry when file contains address and geometry', () => {
      const relationshipFiles = ['relationship_address_geometry.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.address_has_geometry).toEqual({
        '/': './relationship_address_geometry.json',
      });
    });

    it('should include layout_has_geometry when file contains layout_geometry', () => {
      const relationshipFiles = ['relationship_layout_geometry_1.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_geometry).toEqual([
        { '/': './relationship_layout_geometry_1.json' },
      ]);
    });

    it('should include layout_has_geometry when file contains layout and geometry (but not property)', () => {
      const relationshipFiles = ['relationship_layout_geometry_1.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_geometry).toEqual([
        { '/': './relationship_layout_geometry_1.json' },
      ]);
    });

    it('should NOT include layout_has_geometry when file contains property_layout_geometry', () => {
      const relationshipFiles = ['relationship_property_layout_geometry.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_geometry).toBeUndefined();
    });

    it('should handle multiple layout_has_geometry relationships', () => {
      const relationshipFiles = [
        'relationship_layout_geometry_1.json',
        'relationship_layout_geometry_2.json',
        'relationship_layout_geometry_3.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.layout_has_geometry).toHaveLength(3);
      expect(result.relationships.layout_has_geometry).toEqual([
        { '/': './relationship_layout_geometry_1.json' },
        { '/': './relationship_layout_geometry_2.json' },
        { '/': './relationship_layout_geometry_3.json' },
      ]);
    });

    it('should handle case-insensitive matching for geometry relationships', () => {
      const relationshipFiles = [
        'Relationship_Parcel_Geometry.json',
        'RELATIONSHIP_ADDRESS_GEOMETRY.json',
        'relationship_Layout_Geometry_1.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.parcel_has_geometry).toEqual([
        { '/': './Relationship_Parcel_Geometry.json' },
      ]);
      expect(result.relationships.address_has_geometry).toEqual({
        '/': './RELATIONSHIP_ADDRESS_GEOMETRY.json',
      });
      expect(result.relationships.layout_has_geometry).toEqual([
        { '/': './relationship_Layout_Geometry_1.json' },
      ]);
    });

    it('should return layout_has_geometry as an array, not a single object', () => {
      const relationshipFiles = ['relationship_layout_geometry_1.json'];
      const result = createCountyDataGroup(relationshipFiles);

      expect(Array.isArray(result.relationships.layout_has_geometry)).toBe(
        true
      );
      expect(result.relationships.layout_has_geometry).toHaveLength(1);
    });

    it('should return parcel_has_geometry as an array and address_has_geometry as a single object', () => {
      const relationshipFiles = [
        'relationship_parcel_geometry.json',
        'relationship_address_geometry.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(Array.isArray(result.relationships.parcel_has_geometry)).toBe(
        true
      );
      expect(Array.isArray(result.relationships.address_has_geometry)).toBe(
        false
      );
      expect(result.relationships.parcel_has_geometry).toEqual([
        { '/': './relationship_parcel_geometry.json' },
      ]);
      expect(result.relationships.address_has_geometry).toEqual({
        '/': './relationship_address_geometry.json',
      });
    });

    it('should handle all three geometry relationships together', () => {
      const relationshipFiles = [
        'relationship_parcel_geometry.json',
        'relationship_address_geometry.json',
        'relationship_layout_geometry_1.json',
        'relationship_layout_geometry_2.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.parcel_has_geometry).toEqual([
        { '/': './relationship_parcel_geometry.json' },
      ]);
      expect(result.relationships.address_has_geometry).toEqual({
        '/': './relationship_address_geometry.json',
      });
      expect(result.relationships.layout_has_geometry).toHaveLength(2);
      expect(result.relationships.layout_has_geometry).toEqual([
        { '/': './relationship_layout_geometry_1.json' },
        { '/': './relationship_layout_geometry_2.json' },
      ]);
    });

    it('should handle multiple parcel_has_geometry relationships', () => {
      const relationshipFiles = [
        'relationship_parcel_geometry_1.json',
        'relationship_parcel_geometry_2.json',
        'relationship_parcel_geometry_3.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.parcel_has_geometry).toHaveLength(3);
      expect(result.relationships.parcel_has_geometry).toEqual([
        { '/': './relationship_parcel_geometry_1.json' },
        { '/': './relationship_parcel_geometry_2.json' },
        { '/': './relationship_parcel_geometry_3.json' },
      ]);
    });

    it('should not include geometry relationships when files are missing required keywords', () => {
      const relationshipFiles = [
        'parcel_only.json',
        'address_only.json',
        'layout_only.json',
        'geometry_only.json',
      ];
      const result = createCountyDataGroup(relationshipFiles);

      expect(result.relationships.parcel_has_geometry).toBeUndefined();
      expect(result.relationships.address_has_geometry).toBeUndefined();
      expect(result.relationships.layout_has_geometry).toBeUndefined();
    });

    it('should include geometry relationships in comprehensive test', () => {
      const relationshipFiles = [
        'relationship_property_address.json',
        'relationship_property_sales_1.json',
        'relationship_parcel_geometry.json',
        'relationship_address_geometry.json',
        'relationship_layout_geometry_1.json',
        'relationship_layout_geometry_2.json',
        'relationship_layout_layout.json',
      ];

      const result = createCountyDataGroup(relationshipFiles);

      expect(result.label).toBe('County');
      expect(result.relationships.property_has_address).toBeDefined();
      expect(result.relationships.property_has_sales_history).toHaveLength(1);
      expect(result.relationships.parcel_has_geometry).toBeDefined();
      expect(result.relationships.address_has_geometry).toBeDefined();
      expect(result.relationships.layout_has_geometry).toHaveLength(2);
      expect(result.relationships.layout_has_layout).toBeDefined();
    });
  });
});
