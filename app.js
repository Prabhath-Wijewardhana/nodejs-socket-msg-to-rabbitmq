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

// Calculate CRC for response packet
function calculateCRC(data) {
    let crc = 0xFFFF;
    for (let byte of data) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    return crc & 0xFFFF;
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
    response[0] = 0x78;
    response[1] = 0x78;
    response[2] = 0x05;
    response[3] = 0x01;
    response[4] = data[10]; // Copy the serial number
    response[5] = data[11];

    const crc = calculateCRC(response.slice(0, 6));
    response[6] = (crc >> 8) & 0xFF; // CRC high byte
    response[7] = crc & 0xFF; // CRC low byte

    response[8] = 0x0D;
    response[9] = 0x0A;
    return response;
}

// Create TCP server
const server = net.createServer((socket) => {
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

// Start the server
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    connectRabbitMQ(); // Connect to RabbitMQ when the server starts
    connectMySQL(); // Connect to MySQL when the server starts
});
