const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

/**
 * MongoDB Atlas Connectivity Check
 * This script verifies your connection to MongoDB Atlas from your local environment.
 * 
 * Instructions:
 * 1. Ensure you have a .env file with MONGODB_URI=your_connection_string
 * 2. Install dependencies: npm install mongodb dotenv
 * 3. Run script: node mongodbPing.js
 */

async function runCheck() {
    // 1. configuration: Load the URI from environment variables or fallback to a placeholder
    // Using process.env ensures we don't hardcode sensitive credentials.
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.error('❌ Error: MONGODB_URI is not defined in your environment variables or .env file.');
        process.exit(1);
    }

    // 2. initialization: Create a new MongoClient with the Stable API version
    // The ServerApiVersion help ensure your application stays compatible with future server updates.
    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        connectTimeoutMS: 5000, // Wait only 5 seconds for connection
    });

    console.log('⏳ Connecting to MongoDB Atlas...');

    try {
        // 3. connection: Establish the connection to the server
        await client.connect();

        // 4. verification: Send a 'ping' command to the admin database to verify the server is reachable
        // This is a lightweight command that doesn't read or write application data.
        await client.db("admin").command({ ping: 1 });
        
        console.log('✅ Success! You successfully connected to MongoDB Atlas.');
        console.log('📡 Ping response: Pong!');

    } catch (error) {
        // 5. error handling: Catch and report connection failures (e.g., firewall issues, wrong credentials)
        console.error('❌ Connection Failed!');
        console.error('Details:', error.message);
        
        if (error.message.includes('ECONNREFUSED')) {
            console.error('Tip: Check if your local machine is allowed in Atlas IP White-list.');
        } else if (error.message.includes('Authentication failed')) {
            console.error('Tip: Double-check your username and password in the connection string.');
        }
    } finally {
        // 6. cleanup: Close the client connection to release resources
        // It's vital to close connections in long-running applications or scripts.
        await client.close();
        console.log('🔌 Connection closed.');
    }
}

// Start the process
runCheck().catch(console.error);
