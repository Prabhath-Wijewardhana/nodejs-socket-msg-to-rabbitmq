const net = require('net');
const amqp = require('amqplib');
const mysql = require('mysql2/promise');

const port = 4000; // TCP server port
const rabbitMQUrl = 'amqp://admin:bthXwgxDoXf85xd@rabbitmq.parallaxtec.dev'; // URL to your RabbitMQ server with authentication
const queue = 'locationQueue'; // Name of the RabbitMQ queue

const dbConfig = {
    host: '68.183.225.237',
    user: 'prabath',
    password: '1w%e#R^14JW@0*6T',
    database: 'gto6'
};

let channel;
let connection;
let db;
let deviceIdMap = new Map(); // Map to store device ID based on socket connection
let server; // TCP server instance

// Connect to MySQL
async function connectMySQL() {
    try {
        db = await mysql.createConnection(dbConfig);
        console.log('Connected to MySQL');
    } catch (error) {
        console.error('Failed to connect to MySQL:', error.message);
        console.error('Full error:', error);
        setTimeout(connectMySQL, 5000); // Retry after 5 seconds
    }
}

// Connect to RabbitMQ
async function connectRabbitMQ() {
    try {
        console.log('Connecting to RabbitMQ');
        connection = await amqp.connect(rabbitMQUrl);
        console.log('Connection established');

        connection.on('error', (err) => {
            console.error('RabbitMQ connection error', err);
            channel = null;
            setTimeout(connectRabbitMQ, 5000); // Retry connection
        });

        connection.on('close', () => {
            console.log('RabbitMQ connection closed');
            channel = null;
            setTimeout(connectRabbitMQ, 5000); // Retry connection
        });

        channel = await connection.createChannel();
        console.log('Channel created');
        await channel.assertQueue(queue);
        console.log('Queue asserted');
    } catch (error) {
        console.error('Failed to connect to RabbitMQ', error);
        setTimeout(connectRabbitMQ, 5000); // Retry after 5 seconds
    }
}

// Close and restart connections
function restartConnections() {
    if (connection) {
        connection.close();
        connection = null;
    }
    if (db) {
        db.end();
        db = null;
    }
    server.close(() => {
        console.log('Server closed');
        createServer();
    });
    connectRabbitMQ();
    connectMySQL();
    console.log('Connections restarted');
}

// Send data to RabbitMQ and MySQL
async function sendToRabbitMQ(data) {
    if (channel) {
        try {
            await channel.sendToQueue(queue, Buffer.from(data));
            console.log(`Message sent to ${queue}: ${data}`);
        } catch (error) {
            console.error('Failed to send message to RabbitMQ', error);
        }
    } else {
        console.error('RabbitMQ channel is not available');
    }

    // Save to MySQL
    if (db) {
        try {
            const parsedData = JSON.parse(data);
            const { date, gpsInfoLength, satellites, lat, lng, speed, status, deviceId } = parsedData;
            const query = 'INSERT INTO location_data (date, gps_info_length, satellites, latitude, longitude, speed, status, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
            const values = [date, gpsInfoLength, satellites, lat, lng, speed, JSON.stringify(status), deviceId];
            await db.execute(query, values);
            console.log('Data saved to MySQL');
        } catch (error) {
            console.error('Failed to save data to MySQL', error);
        }
    }
}

// CRC calculation function
const crctab16 = [
    0x0000, 0x1189, 0x2312, 0x329B, 0x4624, 0x57AD, 0x6536, 0x74BF, 0x8C48, 0x9DC1, 0xAF5A, 0xBED3, 0xCA6C, 0xDBE5, 0xE97E, 0xF8F7,
    0x1081, 0x0108, 0x3393, 0x221A, 0x56A5, 0x472C, 0x75B7, 0x643E, 0x9CC9, 0x8D40, 0xBFDB, 0xAE52, 0xDAED, 0xCB64, 0xF9FF, 0xE876,
    0x2102, 0x308B, 0x0210, 0x1399, 0x6726, 0x76AF, 0x4434, 0x55BD, 0xAD4A, 0xBCC3, 0x8E58, 0x9FD1, 0xEB6E, 0xFAE7, 0xC87C, 0xD9F5,
    0x3183, 0x200A, 0x1291, 0x0318, 0x77A7, 0x662E, 0x54B5, 0x453C, 0xBDCB, 0xAC42, 0x9ED9, 0x8F50, 0xFBEF, 0xEA66, 0xD8FD, 0xC974,
    0x4204, 0x538D, 0x6116, 0x709F, 0x0420, 0x15A9, 0x2732, 0x36BB, 0xCE4C, 0xDFC5, 0xED5E, 0xFCD7, 0x8868, 0x99E1, 0xAB7A, 0xBAF3,
    0x5285, 0x430C, 0x7197, 0x601E, 0x14A1, 0x0528, 0x37B3, 0x263A, 0xDECD, 0xCF44, 0xFDDF, 0xEC56, 0x98E9, 0x8960, 0xBBFB, 0xAA72,
    0x6306, 0x728F, 0x4014, 0x519D, 0x2522, 0x34AB, 0x0630, 0x17B9, 0xEF4E, 0xFEC7, 0xCC5C, 0xDDD5, 0xA96A, 0xB8E3, 0x8A78, 0x9BF1,
    0x7387, 0x620E, 0x5095, 0x411C, 0x35A3, 0x242A, 0x16B1, 0x0738, 0xFFCF, 0xEE46, 0xDCDD, 0xCD54, 0xB9EB, 0xA862, 0x9AF9, 0x8B70,
    0x8408, 0x9581, 0xA71A, 0xB693, 0xC22C, 0xD3A5, 0xE13E, 0xF0B7, 0x0840, 0x19C9, 0x2B52, 0x3ADB, 0x4E64, 0x5FED, 0x6D76, 0x7CFF,
    0x9489, 0x8500, 0xB79B, 0xA612, 0xD2AD, 0xC324, 0xF1BF, 0xE036, 0x18C1, 0x0948, 0x3BD3, 0x2A5A, 0x5EE5, 0x4F6C, 0x7DF7, 0x6C7E,
    0xA50A, 0xB483, 0x8618, 0x9791, 0xE32E, 0xF2A7, 0xC03C, 0xD1B5, 0x2942, 0x38CB, 0x0A50, 0x1BD9, 0x6F66, 0x7EEF, 0x4C74, 0x5DFD,
    0xB58B, 0xA402, 0x9699, 0x8710, 0xF3AF, 0xE226, 0xD0BD, 0xC134, 0x39C3, 0x284A, 0x1AD1, 0x0B58, 0x7FE7, 0x6E6E, 0x5CF5, 0x4D7C,
    0xC60C, 0xD785, 0xE51E, 0xF497, 0x8028, 0x91A1, 0xA33A, 0xB2B3, 0x4A44, 0x5BCD, 0x6956, 0x78DF, 0x0C60, 0x1DE9, 0x2F72, 0x3EFB,
    0xD68D, 0xC704, 0xF59F, 0xE416, 0x90A9, 0x8120, 0xB3BB, 0xA232, 0x5AC5, 0x4B4C, 0x79D7, 0x685E, 0x1CE1, 0x0D68, 0x3FF3, 0x2E7A,
    0xE70E, 0xF687, 0xC41C, 0xD595, 0xA12A, 0xB0A3, 0x8238, 0x93B1, 0x6B46, 0x7ACF, 0x4854, 0x59DD, 0x2D62, 0x3CEB, 0x0E70, 0x1FF9,
    0xF78F, 0xE606, 0xD49D, 0xC514, 0xB1AB, 0xA022, 0x92B9, 0x8330, 0x7BC7, 0x6A4E, 0x58D5, 0x495C, 0x3DE3, 0x2C6A, 0x1EF1, 0x0F78
];

function calculateCRC(data) {
    let fcs = 0xFFFF; // Initialize

    for (let i = 0; i < data.length; i++) {
        fcs = (fcs >> 8) ^ crctab16[(fcs ^ data[i]) & 0xFF];
    }

    return (~fcs) & 0xFFFF; // Negated result
}

// Parse GT06 login packet
function parseLoginPacket(data) {
    return data.slice(4, 12).toString('hex'); // Example: Extracting device ID from login packet
}

// Parse GT06 location packet
function parseLocationPacket(data, deviceId) {
    const date = new Date(
        2000 + data[4],
        data[5] - 1,
        data[6],
        data[7],
        data[8],
        data[9]
    );

    const gpsInfoLengthAndSatellites = data[10];
    const gpsInfoLength = gpsInfoLengthAndSatellites >> 4; // First 4 bits
    const satellites = gpsInfoLengthAndSatellites & 0x0F; // Last 4 bits

    const latValue = (data.readUInt32BE(11) / 30000.0) / 60.0;
    const lngValue = (data.readUInt32BE(15) / 30000.0) / 60.0;

    const lat = latValue.toFixed(6);
    const lng = lngValue.toFixed(6);

    const speed = data[21];
    const courseStatus = (data[22] << 8) | data[23];

    const status = {
        realTimeGPS: (courseStatus & 0x2000) !== 0, // Example: bit 13 of courseStatus
        gpsLocated: (courseStatus & 0x1000) !== 0, // Example: bit 12 of courseStatus
        longitude: (courseStatus & 0x0800) !== 0 ? 'W' : 'E', // Example: bit 11 of courseStatus
        latitude: (courseStatus & 0x0400) !== 0 ? 'S' : 'N', // Example: bit 10 of courseStatus
        course: courseStatus & 0x03FF // lower 10 bits for course
    };

    return { date, gpsInfoLength, satellites, lat, lng, speed, status, deviceId };
}

// Check if the packet is a location packet
function isLocationPacket(data) {
    return data.length >= 26 && data[0] === 0x78 && data[1] === 0x78 && data[3] === 0x22;
}

// Check if the packet is a status packet
function isStatusPacket(data) {
    return data.length >= 24 && data[0] === 0x78 && data[1] === 0x78 && data[3] === 0x13;
}

function isLoginPacket(data) {
    // GT06 login packet starts with 0x78 0x78 and has a specific structure
    return data.length >= 16 && data[0] === 0x78 && data[1] === 0x78 && data[3] === 0x01;
}

function createLoginResponse(data) {
    const response = Buffer.alloc(10);
    response[0] = 0x78; // Start bit 1
    response[1] = 0x78; // Start bit 2
    response[2] = 0x80; // Length of the response
    response[3] = 0x01; // Protocol number (login response)
    response[4] = data[12]; // Serial number high byte
    response[5] = data[13]; // Serial number low byte

    console.log(`Response before CRC: ${response.toString('hex')}`);

    const crc = calculateCRC(response.slice(0, 6)); // Calculate CRC for the first 6 bytes
    response[6] = (crc >> 8) & 0xFF; // CRC high byte
    response[7] = crc & 0xFF; // CRC low byte

    response[8] = 0x0D; // Stop bit 1
    response[9] = 0x0A; // Stop bit 2

    console.log(`Final response: ${response.toString('hex')}`);
    return response;
}

// Create TCP server
function createServer() {
    server = net.createServer((socket) => {
        console.log('Client connected');

        // Log data received from the client
        socket.on('data', (data) => {
            if (isLoginPacket(data)) {
                const deviceId = parseLoginPacket(data);
                deviceIdMap.set(socket, deviceId);
                const response = createLoginResponse(data);
                socket.write(response);
                console.log(`Received: ${data.toString('hex')}`);
                console.log('Login packet received, response sent');
                console.log(`Device ID: ${deviceId}`);
            } else if (isLocationPacket(data)) {
                const deviceId = deviceIdMap.get(socket);
                const location = parseLocationPacket(data, deviceId);
                console.log(`Device ID: ${location.deviceId}`);
                console.log(`Date: ${location.date}`);
                console.log(`GPS Info Length: ${location.gpsInfoLength}`);
                console.log(`Satellites: ${location.satellites}`);
                console.log(`Latitude: ${location.lat}`);
                console.log(`Longitude: ${location.lng}`);
                console.log(`Speed: ${location.speed}`);
                console.log(`Status: ${JSON.stringify(location.status)}`);
                sendToRabbitMQ(JSON.stringify(location));
                console.log(`Received: ${data.toString('hex')}`);
                console.log(`Location packet received: ${JSON.stringify(location)}`);
            } else if (isStatusPacket(data)) {
                const status = parseStatus(data.slice(24, 28));
                console.log(`Status: ${JSON.stringify(status)}`);
                sendToRabbitMQ(JSON.stringify(status));
                console.log(`Status packet received: ${JSON.stringify(status)}`);
            } else {
                console.log(`Received: ${data.toString('hex')}`);
            }
        });

        // Handle client disconnect
        socket.on('end', () => {
            console.log('Client disconnected');
            deviceIdMap.delete(socket); // Remove device ID when client disconnects
        });

        // Handle errors
        socket.on('error', (err) => {
            console.error(`Socket error: ${err.message}`);
            deviceIdMap.delete(socket); // Remove device ID on error
        });
    });

    server.listen(port, () => {
        console.log(`Server is listening on port ${port}`);
        connectRabbitMQ(); // Connect to RabbitMQ when the server starts
        connectMySQL(); // Connect to MySQL when the server starts
    });

    server.on('error', (err) => {
        console.error('Server error:', err);
        setTimeout(createServer, 5000); // Retry server creation after 5 seconds
    });
}

// Close and restart the server
function restartServer() {
    if (server) {
        server.close(() => {
            console.log('Server closed');
            createServer();
        });
    }
}

// Start the server
createServer();

// Restart connections every 10 minutes
setInterval(restartConnections, 10 * 60 * 1000);

// Restart the server every 10 minutes
setInterval(restartServer, 10 * 60 * 1000);
