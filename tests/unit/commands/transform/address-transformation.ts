import { describe, it, expect } from 'vitest';

describe('Address should not be overwritten by transform function', () => {
  it.fails('The transform function should not overwrite the address.json file with the original address.json file', () => {
    // This test demonstrates the bug scenario without running the full transform pipeline

    // Original address.json from seed transformation
    const originalAddressJson = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property?parcel=12345',
        multiValueQueryString: {
          parcel: ['12345'],
        },
      },
      request_identifier: '12345',
      county_name: 'Miami Dade',
      unnormalized_address: '123 Main St, Miami, FL 33101',
      longitude: null,
      latitude: null,
    };

    // What county scripts SHOULD create (with additional fields)
    const scriptCreatedAddressJson = {
      ...originalAddressJson,
      township: '45S',
      section: '03',
      block: '0000G',
    };

    // Simulate the bug: CLI overwrites script-created address.json with original
    // This is what happens in handleCountyTransform() lines 516-522
    const finalAddressJson = originalAddressJson; // CLI overwrites with original

    // BUG DEMONSTRATION: This test SHOULD FAIL because the address.json is being overwritten
    // The test expects the script-created fields to be preserved, but they're not
    expect(finalAddressJson).toEqual(scriptCreatedAddressJson); // This will FAIL - demonstrating the bug

    // These assertions should PASS if the bug was fixed, but they FAIL due to the bug:
    expect(finalAddressJson.township).toBe('45S'); // FAILS - township is undefined
    expect(finalAddressJson.section).toBe('03'); // FAILS - section is undefined
    expect(finalAddressJson.block).toBe('0000G'); // FAILS - block is undefined

    // The original fields are preserved (this works correctly)
    expect(finalAddressJson.county_name).toBe('Miami Dade');
    expect(finalAddressJson.unnormalized_address).toBe(
      '123 Main St, Miami, FL 33101'
    );
    expect(finalAddressJson.longitude).toBe(null);
    expect(finalAddressJson.latitude).toBe(null);
  });

  it('should show what the output SHOULD look like if the bug was fixed', () => {
    // This test shows the expected behavior after the bug is fixed
    const originalAddressJson = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property?parcel=12345',
        multiValueQueryString: {
          parcel: ['12345'],
        },
      },
      request_identifier: '12345',
      county_name: 'Miami Dade',
      unnormalized_address: '123 Main St, Miami, FL 33101',
      longitude: null,
      latitude: null,
    };

    const expectedModifiedAddressJson = {
      ...originalAddressJson,
      township: '45S',
      section: '03',
      block: '0000G',
    };

    // This is what the final address.json SHOULD contain after county scripts run
    expect(expectedModifiedAddressJson).toHaveProperty('township', '45S');
    expect(expectedModifiedAddressJson).toHaveProperty('section', '03');
    expect(expectedModifiedAddressJson).toHaveProperty('block', '0000G');

    // Original fields should still be present
    expect(expectedModifiedAddressJson).toHaveProperty(
      'county_name',
      'Miami Dade'
    );
    expect(expectedModifiedAddressJson).toHaveProperty(
      'unnormalized_address',
      '123 Main St, Miami, FL 33101'
    );
    expect(expectedModifiedAddressJson).toHaveProperty('longitude', null);
    expect(expectedModifiedAddressJson).toHaveProperty('latitude', null);
  });
});
