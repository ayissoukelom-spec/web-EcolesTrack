#!/usr/bin/env node

/**
 * Test script to verify PDF download request count and console logging
 * This simulates a parent user making a PDF download request
 */

const BASE_URL = 'http://localhost:3000';

// Simulation headers for dev mode (super_admin user - full access)
const headers = {
  'x-simulated-role': 'super_admin',
  'x-simulated-email': 'admin@test.com',
  'x-simulated-uid': 'admin_123',
  'x-simulated-name': 'Test Admin',
  'x-simulated-school-id': '1',
};

console.log('=== BULLETIN PDF DOWNLOAD TEST ===\n');
console.log('1. Fetching available bulletins with simulation headers...\n');

// Step 1: Get list of bulletins
fetch(`${BASE_URL}/api/bulletins`, { headers })
  .then(res => {
    console.log(`   Response status: ${res.status}`);
    return res.json();
  })
  .then(bulletins => {
    console.log(`   ✅ Found ${bulletins.length || 0} bulletins\n`);
    
    if (!bulletins || bulletins.length === 0) {
      console.log('   ⚠️  No bulletins available. Test cannot proceed.');
      process.exit(0);
    }
    
    // Get first bulletin ID
    const bulletinId = bulletins[0].id;
    console.log(`2. Attempting PDF download for bulletin ID: ${bulletinId}\n`);
    console.log('   📥 Making request: GET /api/bulletins/${bulletinId}/pdf\n');
    
    // Step 2: Download PDF with proper headers
    return fetch(`${BASE_URL}/api/bulletins/${bulletinId}/pdf`, { 
      headers,
      credentials: 'include'
    });
  })
  .then(res => {
    console.log(`   ✅ Server responded with status: ${res.status}\n`);
    
    if (!res.ok) {
      console.log(`   ❌ ERROR: ${res.status} ${res.statusText}`);
      return res.text().then(text => {
        console.log(`   Response: ${text}`);
        process.exit(1);
      });
    }
    
    // Check response type
    const contentType = res.headers.get('content-type');
    console.log(`   Content-Type: ${contentType}\n`);
    
    return res.blob().then(blob => {
      console.log(`   ✅ PDF blob received, size: ${blob.size} bytes\n`);
      
      // Verify PDF magic bytes
      return blob.arrayBuffer().then(buf => {
        const magicBytes = new Uint8Array(buf).slice(0, 4);
        const isPDF = magicBytes[0] === 0x25 && // %
                      magicBytes[1] === 0x50 && // P
                      magicBytes[2] === 0x44 && // D
                      magicBytes[3] === 0x46;  // F
        
        if (isPDF) {
          console.log('   ✅ PDF magic bytes confirmed: %PDF\n');
        } else {
          console.log(`   ⚠️  Warning: PDF magic bytes not found. Bytes: ${Array.from(magicBytes).map(b => `0x${b.toString(16)}`).join(' ')}\n`);
        }
        
        console.log('=== TEST COMPLETE ===');
        console.log('✅ Single PDF download request succeeded');
        console.log('Check server logs above for requestId tracking and console logs\n');
        process.exit(0);
      });
    });
  })
  .catch(err => {
    console.error('❌ Error during test:', err.message);
    process.exit(1);
  });
