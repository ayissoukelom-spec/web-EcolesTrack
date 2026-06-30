import fetch from 'node-fetch';

const test = async () => {
  // Start server in background
  const serverProcess = require('child_process').spawn('npm', ['run', 'dev'], {
    cwd: 'd:\\Projet AYISSOU\\web ecoles',
    stdio: 'pipe',
  });

  // Give server time to start
  await new Promise(r => setTimeout(r, 3000));

  try {
    // Test with valid bulletin
    console.log('Testing PDF endpoint with valid bulletin...');
    const response = await fetch('http://localhost:5173/api/bulletins/11/pdf', {
      headers: {
        'Cookie': 'session=...' // Will need valid session
      }
    });

    if (response.ok) {
      const buffer = await response.buffer();
      console.log('✅ PDF downloaded successfully');
      console.log(`   Size: ${buffer.length} bytes`);
      console.log(`   Header: ${buffer.toString('utf8', 0, 4)}`);
    } else {
      console.log(`❌ HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.log(text);
    }
  } catch (err) {
    console.error('Error:', (err as any).message);
  } finally {
    serverProcess.kill();
  }
};

test();
