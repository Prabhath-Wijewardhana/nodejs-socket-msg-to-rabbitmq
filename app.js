const net = require('net');
const mysql = require('mysql2/promise');

const port = 4000; // TCP server port

let deviceIdMap = new Map();
// Database configuration
const dbConfig = {
    host: '68.183.225.237',
    user: 'prabath',
    password: '1w%e#R^14JW@0*6T',
    database: 'gto6'
};

let db;

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

// CRC16 Lookup Table
const crctab16 = [
    0x0000, 0x1189, 0x2312, 0x329b, 0x4624, 0x57ad, 0x6536, 0x74bf,
    0x8c48, 0x9dc1, 0xaf5a, 0xbed3, 0xca6c, 0xdbe5, 0xe97e, 0xf8f7,
    0x1081, 0x0108, 0x3393, 0x221a, 0x56a5, 0x472c, 0x75b7, 0x643e,
    0x9cc9, 0x8d40, 0xbfdb, 0xae52, 0xdaed, 0xcb64, 0xf9ff, 0xe876,
    0x2102, 0x308b, 0x0210, 0x1399, 0x6726, 0x76af, 0x4434, 0x55bd,
    0xad4a, 0xbcc3, 0x8e58, 0x9fd1, 0xeb6e, 0xfae7, 0xc87c, 0xd9f5,
    0x3183, 0x200a, 0x1291, 0x0318, 0x77a7, 0x662e, 0x54b5, 0x453c,
    0xbdcb, 0xac42, 0x9ed9, 0x8f50, 0xfbef, 0xea66, 0xd8fd, 0xc974,
    0x4204, 0x538d, 0x6116, 0x709f, 0x0420, 0x15a9, 0x2732, 0x36bb,
    0xce4c, 0xdfc5, 0xed5e, 0xfcd7, 0x8868, 0x99e1, 0xab7a, 0xbaf3,
    0x5285, 0x430c, 0x7197, 0x601e, 0x14a1, 0x0528, 0x37b3, 0x263a,
    0xdecd, 0xcf44, 0xfddf, 0xec56, 0x98e9, 0x8960, 0xbbfb, 0xaa72,
    0x6306, 0x728f, 0x4014, 0x519d, 0x2522, 0x34ab, 0x0630, 0x17b9,
    0xef4e, 0xfec7, 0xcc5c, 0xddd5, 0xa96a, 0xb8e3, 0x8a78, 0x9bf1,
    0x7387, 0x620e, 0x5095, 0x411c, 0x35a3, 0x242a, 0x16b1, 0x0738,
    0xffcf, 0xee46, 0xdcdd, 0xcd54, 0xb9eb, 0xa862, 0x9af9, 0x8b70,
    0x8408, 0x9581, 0xa71a, 0xb693, 0xc22c, 0xd3a5, 0xe13e, 0xf0b7,
    0x0840, 0x19c9, 0x2b52, 0x3adb, 0x4e64, 0x5fed, 0x6d76, 0x7cff,
    0x9489, 0x8500, 0xb79b, 0xa612, 0xd2ad, 0xc324, 0xf1bf, 0xe036,
    0x18c1, 0x0948, 0x3bd3, 0x2a5a, 0x5ee5, 0x4f6c, 0x7df7, 0x6c7e,
    0xa50a, 0xb483, 0x8618, 0x9791, 0xe32e, 0xf2a7, 0xc03c, 0xd1b5,
    0x2942, 0x38cb, 0x0a50, 0x1bd9, 0x6f66, 0x7eef, 0x4c74, 0x5dfd,
    0xb58b, 0xa402, 0x9699, 0x8710, 0xf3af, 0xe226, 0xd0bd, 0xc134,
    0x39c3, 0x284a, 0x1ad1, 0x0b58, 0x7fe7, 0x6e6e, 0x5cf5, 0x4d7c,
    0xc60c, 0xd785, 0xe51e, 0xf497, 0x8028, 0x91a1, 0xa33a, 0xb2b3,
    0x4a44, 0x5bcd, 0x6956, 0x78df, 0x0c60, 0x1de9, 0x2f72, 0x3efb,
    0xd68d, 0xc704, 0xf59f, 0xe416, 0x90a9, 0x8120, 0xb3bb, 0xa232,
    0x5ac5, 0x4b4c, 0x79d7, 0x685e, 0x1ce1, 0x0d68, 0x3ff3, 0x2e7a,
    0xe70e, 0xf687, 0xc41c, 0xd595, 0xa12a, 0xb0a3, 0x8238, 0x93b1,
    0x6b46, 0x7acf, 0x4854, 0x59dd, 0x2d62, 0x3ceb, 0x0e70, 0x1ff9,
    0xf78f, 0xe606, 0xd49d, 0xc514, 0xb1ab, 0xa022, 0x92b9, 0x8330,
    0x7bc7, 0x6a4e, 0x58d5, 0x495c, 0x3de3, 0x2c6a, 0x1ef1, 0x0f78
];

// Function to calculate CRC16 for length and serial number
function calculateCRC16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = (crc >> 8) ^ crctab16[(crc ^ data[i]) & 0xFF];
    }
    return (~crc) & 0xFFFF;
}

// Function to parse login message
function parseLoginMessage(data) {
    const imei = data.slice(4, 12).toString('hex');
    return { imei };
}

// Function to parse location message with protocol 12
function parseLocationMessage(data,deviceId) {
    const date = new Date(
        2000 + data[4],  // Year
        data[5] - 1,     // Month (0-11)
        data[6],         // Day
        data[7],         // Hour
        data[8],         // Minute
        data[9]          // Second
    );

    const gpsInfoLength = data[10] >> 4;
    const satellites = data[10] & 0x0F;

    const latitudeRaw = data.readUInt32BE(11);
    const longitudeRaw = data.readUInt32BE(15);
    const lat = (latitudeRaw / 30000.0) / 60.0;
    const lng = (longitudeRaw / 30000.0) / 60.0;

    const speed = data[21];
    const courseStatus = (data[22] << 8) | data[23];

    const status = {
        realTimeGPS: (courseStatus & 0x2000) !== 0, // bit 13 of courseStatus
        gpsLocated: (courseStatus & 0x1000) !== 0, // bit 12 of courseStatus
        longitude: (courseStatus & 0x0800) !== 0 ? 'W' : 'E', // bit 11 of courseStatus
        latitude: (courseStatus & 0x0400) !== 0 ? 'S' : 'N', // bit 10 of courseStatus
        course: courseStatus & 0x03FF // lower 10 bits for course
    };

    return { date, gpsInfoLength, satellites, lat, lng, speed, status, deviceId };
}

// Function to save location data to MySQL
async function saveLocationToDB(location) {
    if (db) {
        try {
            const query = 'INSERT INTO location_data (date, gps_info_length, satellites, latitude, longitude, speed, status, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
            const values = [location.date, location.gpsInfoLength, location.satellites, location.lat, location.lng, location.speed, JSON.stringify(location.status), location.deviceId];
            await db.execute(query, values);
            console.log('Location data saved to MySQL');
        } catch (error) {
            console.error('Failed to save location data to MySQL', error);
        }
    } else {
        console.error('MySQL connection is not available');
    }
}

// Function to handle login message and respond
function handleLogin(socket, data) {
    const parsedData = parseLoginMessage(data);
                deviceIdMap.set(socket, parsedData.imei);
    console.log(`Device logged in with IMEI: ${parsedData.imei}`);

    // Create the response without the CRC and stop bits
    const responseWithoutCRC = Buffer.from([
        0x78, 0x78, // Start bit
        0x05,       // Length
        0x01,       // Protocol number (Login response)
        data[12], data[13] // Serial number from the login message
    ]);

    // Calculate CRC16 for the response, which includes only length and serial number
    const crcData = responseWithoutCRC.slice(2, 6);
    const crc = calculateCRC16(crcData);
    const crcBuffer = Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);

    // Complete response with CRC and stop bits
    const response = Buffer.concat([responseWithoutCRC, crcBuffer, Buffer.from([0x0D, 0x0A])]);

    console.log(`Sending response: ${response.toString('hex')}`);
    socket.write(response);
}

// Function to handle location message and respond
function handleLocation(socket, data) {
const deviceId = deviceIdMap.get(socket);
    const parsedData = parseLocationMessage(data,deviceId);
    console.log(`Location Data: ${JSON.stringify(parsedData)}`);
    // Save location data to MySQL
    saveLocationToDB(parsedData);

    // Create the response without the CRC and stop bits
    const responseWithoutCRC = Buffer.from([
        0x78, 0x78, // Start bit
        0x05,       // Length
        0x12,       // Protocol number (Location response)
        data[10], data[11] // Serial number from the location message
    ]);

    // Calculate CRC16 for the response, which includes only length and serial number
    const crcData = responseWithoutCRC.slice(2, 6);
    const crc = calculateCRC16(crcData);
    const crcBuffer = Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);

    // Complete response with CRC and stop bits
    const response = Buffer.concat([responseWithoutCRC, crcBuffer, Buffer.from([0x0D, 0x0A])]);

    console.log(`Sending response: ${response.toString('hex')}`);
    socket.write(response);
}

// Create TCP server
const server = net.createServer((socket) => {
    console.log('Client connected');

    // Log data received from the client
    socket.on('data', (data) => {
        console.log(`Received: ${data.toString('hex')}`);

        if (data[3] === 0x01) {
            handleLogin(socket, data);
        } else if (data[3] === 0xa0) {
            handleLocation(socket, data);
        } else {
            console.log(`Received non-login/non-location message: ${data.toString('hex')}`);
        }
    });

    // Handle client disconnect
    socket.on('end', () => {
        console.log('Client disconnected');
    });

    // Handle errors
    socket.on('error', (err) => {
        console.error(`Socket error: ${err.message}`);
    });
});

// Start the server and connect to MySQL
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    connectMySQL(); // Connect to MySQL when the server starts
});
