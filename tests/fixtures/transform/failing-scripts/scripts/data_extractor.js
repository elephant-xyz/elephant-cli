console.log('about to fail');
throw new Error(JSON.stringify({ type: 'error', message: 'Unknown enum value Barn.', path: 'property.property_type' }));
